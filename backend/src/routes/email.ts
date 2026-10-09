import { Router } from "express";
import crypto from "crypto";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { pool } from "../db";
import { audit } from "../audit";
import { AuthedRequest, requireAuth, requirePermission, requireRole, requireSelectedMode } from "../middleware/auth";
import { decrypt, encrypt, emailAccounts, emailValid, googleJson, oauthConfig, senderSlot, sendEmail, tokenExchange } from "../email/gmail";
import { notifyEmailSent } from "../employees/portalNotifications";

const router = Router();
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const cookieName = "ems_email_oauth";
const attachmentTypes: Record<string, string[]> = { "application/pdf": ["pdf"], "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"] };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 }, fileFilter: (_req, file, done) => {
  const extension = file.originalname.split(".").pop()?.toLowerCase() || "";
  if (!attachmentTypes[file.mimetype]?.includes(extension)) return done(new Error("Unsupported attachment"));
  done(null, true);
} });

// Start in a top-level popup so the HttpOnly binding works across frontend/API domains.
router.get("/oauth/start", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  try {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error();
    const [rows] = await pool.execute("SELECT oauth_verifier_encrypted FROM company_email_accounts WHERE oauth_state_hash = ? AND oauth_expires_at > UTC_TIMESTAMP()", [hash(state)]);
    const pending = (rows as Array<{ oauth_verifier_encrypted: Buffer }>)[0];
    if (!pending) throw new Error();
    const config = oauthConfig();
    const verifier = decrypt(pending.oauth_verifier_encrypted);
    res.cookie(`${cookieName}_${hash(state).slice(0, 12)}`, state, { httpOnly: true, secure: new URL(config.redirectUri).protocol === "https:", sameSite: "lax", maxAge: 600_000, path: "/api/email/oauth/callback" });
    const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: "openid email https://www.googleapis.com/auth/gmail.send", access_type: "offline", prompt: "consent select_account", state, code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  } catch { res.status(400).send("Email authorization expired. Return to Settings and try again."); }
});
// OAuth callback uses a one-time state plus an HttpOnly browser binding; no EMS JWT in URLs.
router.get("/oauth/callback", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  try {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const bindingName = `${cookieName}_${hash(state).slice(0, 12)}`;
    const cookie = req.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith(`${bindingName}=`))?.slice(bindingName.length + 1);
    if (!state || !cookie || hash(cookie) !== hash(state) || !code) throw new Error();
    const connection = await pool.getConnection();
    let pending: { slot: "primary" | "secondary"; oauth_verifier_encrypted: Buffer; oauth_user_id: number };
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT slot, oauth_verifier_encrypted, oauth_user_id FROM company_email_accounts WHERE oauth_state_hash = ? AND oauth_expires_at > UTC_TIMESTAMP() FOR UPDATE", [hash(state)]);
      pending = (rows as typeof pending[])[0];
      if (!pending) throw new Error();
      await connection.execute("UPDATE company_email_accounts SET oauth_state_hash = NULL, oauth_expires_at = NULL, oauth_verifier_encrypted = NULL WHERE slot = ?", [pending.slot]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    const [users] = await pool.execute("SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.is_active = TRUE AND r.name IN ('admin', 'super_admin') AND r.is_active = TRUE", [pending.oauth_user_id]);
    if (!(users as object[]).length) throw new Error();
    const tokens = await tokenExchange({ grant_type: "authorization_code", code, redirect_uri: oauthConfig().redirectUri, code_verifier: decrypt(pending.oauth_verifier_encrypted) });
    if (typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string" || !String(tokens.scope).split(" ").includes("https://www.googleapis.com/auth/gmail.send")) throw new Error();
    const identity = await googleJson("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (identity.email_verified !== true || typeof identity.email !== "string" || !emailValid(identity.email)) throw new Error();
    const [saved] = await pool.execute("UPDATE company_email_accounts SET email = ?, refresh_token_encrypted = ?, status = 'connected', oauth_user_id = NULL WHERE slot = ? AND oauth_user_id = ? AND oauth_state_hash IS NULL", [identity.email, encrypt(tokens.refresh_token), pending.slot, pending.oauth_user_id]);
    if ((saved as { affectedRows: number }).affectedRows !== 1) throw new Error();
    await audit(pending.oauth_user_id, "update", "company_email_account", null, { slot: pending.slot, action: "connected", email: identity.email }, req.ip ?? null);
    res.clearCookie(bindingName, { path: "/api/email/oauth/callback" });
    res.type("html").send("<p>Company email connected successfully. Close this window and refresh Company Email Accounts in Settings.</p>");
  } catch { res.status(400).type("html").send("<p>Email connection could not be completed. Return to Settings and try again.</p>"); }
});

router.use(requireAuth, requireSelectedMode, requirePermission("email:send"));
router.get("/accounts", async (_req, res) => {
  try { res.json({ accounts: await emailAccounts() }); }
  catch { res.status(503).json({ error: "Company email settings are unavailable" }); }
});
router.get("/recipients", async (_req, res) => {
  try {
  const [clients] = await pool.execute("SELECT id, company_name AS name, email FROM clients WHERE status = 'active' ORDER BY company_name");
  const [employees] = await pool.execute("SELECT id, full_name AS name, email FROM employees WHERE status <> 'inactive' ORDER BY full_name");
  res.json({ clients, employees });
  } catch { res.status(503).json({ error: "Email recipients are unavailable" }); }
});
router.post("/accounts/:slot/connect", requireRole("admin", "super_admin"), async (req: AuthedRequest, res) => {
  try {
    const slot = senderSlot(req.params.slot);
    const config = oauthConfig();
    const state = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(48).toString("base64url");
    await pool.execute("UPDATE company_email_accounts SET oauth_state_hash = ?, oauth_verifier_encrypted = ?, oauth_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), oauth_user_id = ? WHERE slot = ?", [hash(state), encrypt(verifier), req.user!.id, slot]);
    const launchUrl = new URL(config.redirectUri);
    launchUrl.pathname = launchUrl.pathname.replace(/\/callback$/, "/start");
    launchUrl.search = new URLSearchParams({ state }).toString();
    res.json({ authorization_url: launchUrl.toString() });
  } catch { res.status(400).json({ error: "Unable to start Google authorization. Check the server's Google OAuth configuration." }); }
});
router.delete("/accounts/:slot", requireRole("admin", "super_admin"), async (req: AuthedRequest, res) => {
  try {
    const slot = senderSlot(req.params.slot);
    await pool.execute("UPDATE company_email_accounts SET email = NULL, refresh_token_encrypted = NULL, status = 'not_connected', oauth_state_hash = NULL, oauth_verifier_encrypted = NULL, oauth_expires_at = NULL, oauth_user_id = NULL WHERE slot = ?", [slot]);
    await audit(req.user!.id, "update", "company_email_account", null, { slot, action: "disconnected" }, req.ip ?? null);
    res.json({ ok: true });
  } catch { res.status(400).json({ error: "Unable to disconnect account" }); }
});
router.post("/send", rateLimit({ windowMs: 60_000, max: 10, message: { error: "Please wait before sending more emails" } }), (req, res, next) => upload.single("attachment")(req, res, error => error ? res.status(400).json({ error: error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? "Attachment must be 10 MB or smaller" : "Unsupported or invalid attachment" }) : next()), async (req, res) => {
  try {
    const slot = senderSlot(req.body.senderAccount);
    let to = String(req.body.to || "").trim();
    const kind = req.body.recipientType;
    let resolvedRecipient: { kind: "client" | "employee"; id: number } | null = null;
    if (kind === "client" || kind === "employee") {
      const id = Number(req.body.recipientId);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Select a recipient" });
      const [rows] = await pool.execute(kind === "client" ? "SELECT email FROM clients WHERE id = ? AND status = 'active'" : "SELECT email FROM employees WHERE id = ? AND status <> 'inactive'", [id]);
      to = (rows as Array<{ email: string }>)[0]?.email || "";
      if (to) resolvedRecipient = { kind, id };
    } else if (kind !== "manual") return res.status(400).json({ error: "Invalid recipient type" });
    if (!emailValid(to)) return res.status(400).json({ error: "Recipient email is not available or invalid" });
    if (req.file) {
      const data = req.file.buffer;
      const mime = req.file.mimetype;
      const valid = mime === "application/pdf" ? data.subarray(0, 5).toString() === "%PDF-"
        : mime === "image/jpeg" ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
        : mime === "image/png" ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : mime === "image/webp" ? data.subarray(0,4).toString() === "RIFF" && data.subarray(8,12).toString() === "WEBP"
        : data.subarray(0,4).equals(Buffer.from([80,75,3,4]));
      if (!valid || !data.length) return res.status(400).json({ error: "Attachment contents do not match its file type" });
    }
    await sendEmail(slot, to, String(req.body.subject || ""), String(req.body.message || ""), req.file ? { name: req.file.originalname, mime: req.file.mimetype, buffer: req.file.buffer } : undefined);
    if (resolvedRecipient) {
      try { await notifyEmailSent(resolvedRecipient.kind, resolvedRecipient.id); }
      catch { console.error("Email sent; recipient notification could not be saved"); }
    }
    res.json({ message: "Email sent successfully." });
  } catch (error) { res.status(400).json({ error: error instanceof Error && /^(Selected company|Company email|Choose Primary|Enter a valid)/.test(error.message) ? error.message : "Email could not be sent. Check the account connection and try again." }); }
});
export default router;
