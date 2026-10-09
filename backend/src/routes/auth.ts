import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { revokeSuperAuthorization } from "../security/superPassword";
import rateLimit from "express-rate-limit";
import { pool } from "../db";
import { audit } from "../audit";
import { requireAuth, AuthedRequest, SessionMode } from "../middleware/auth";

const router = Router();
router.post("/logout", requireAuth, (req: AuthedRequest, res) => { revokeSuperAuthorization(req.user!.sessionKey); res.json({ ok: true }); });

type SessionUser = {
  id: number;
  full_name: string;
  email: string | null;
  cnic: string | null;
  employee_id: number | null;
  client_id: number | null;
  role: string;
};

function signSessionToken(user: SessionUser, mode: SessionMode, modeSelected: boolean) {
  return jwt.sign(
    {
      sub: user.id,
      jti: randomUUID(),
      system_role: user.role,
      mode,
      mode_selected: modeSelected,
      employee_id: user.employee_id,
      client_id: user.client_id,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? "8h" } as jwt.SignOptions,
  );
}

function publicSessionUser(user: SessionUser, mode: SessionMode) {
  return {
    id: user.id,
    name: user.full_name,
    email: user.email,
    cnic: user.cnic,
    role: user.role,
    system_role: user.role,
    employee_id: user.employee_id,
    client_id: user.client_id,
    mode,
    requires_mode_selection: mode === "selection_required",
  };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many attempts. Try again in 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/login", loginLimiter, async (req, res) => {
  const { email, username, password } = req.body ?? {};
  const identifier = String(email || username || "").trim();

  if (!identifier || !password) {
    return res.status(400).json({ error: "Username/email and password are required" });
  }

  // Extract clean digits if the identifier contains numeric CNIC format
  const digits = identifier.replace(/\D/g, "");

  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name, u.email, u.cnic, u.employee_id, u.client_id, u.password_hash, u.is_active,
            r.name AS role, r.is_active AS role_active
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE (u.email = ? OR (u.cnic IS NOT NULL AND u.cnic = ?) OR u.cnic = ?)
     LIMIT 1`,
    [identifier, digits, identifier]
  );
  const user = (rows as any[])[0];

  // Same error for wrong credentials — never reveal which part was wrong
  const invalid = () => res.status(401).json({ error: "Invalid username/email or password" });

  if (!user || !user.is_active || !user.role_active) return invalid();
  if (user.role === "client") {
    const [clients] = await pool.execute("SELECT status FROM clients WHERE id = ? LIMIT 1", [user.client_id]);
    if ((clients as any[])[0]?.status !== "active") return invalid();
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return invalid();

  await pool.execute("UPDATE users SET last_login_at = NOW() WHERE id = ?", [user.id]);
  await audit(user.id, "login", "user", user.id, null, req.ip ?? null);

  const requiresModeSelection = user.role === "admin" && Boolean(user.employee_id);
  const mode: SessionMode = requiresModeSelection
    ? "selection_required"
      : user.role === "employee"
      ? "employee"
      : user.role === "client"
        ? "client"
      : "admin";
  const token = signSessionToken(user, mode, !requiresModeSelection);

  return res.json({
    token,
    user: publicSessionUser(user, mode),
  });
});

router.post("/select-mode", requireAuth, async (req: AuthedRequest, res) => {
  if (req.user!.mode !== "selection_required" || req.user!.mode_selected) {
    return res.status(409).json({ error: "A mode can only be selected immediately after a fresh login" });
  }

  const requestedMode = req.body?.mode;
  if (requestedMode !== "employee" && requestedMode !== "admin") {
    return res.status(400).json({ error: "Mode must be employee or admin" });
  }

  const [rows] = await pool.execute(
      `SELECT u.id, u.full_name, u.email, u.cnic, u.employee_id, u.client_id, u.is_active,
            r.name AS role, r.is_active AS role_active
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = ?
     LIMIT 1`,
    [req.user!.id],
  );
  const user = (rows as any[])[0];
  if (!user || !user.is_active || !user.role_active) {
    return res.status(401).json({ error: "Account is no longer active" });
  }
  if (user.role !== "admin" || !user.employee_id) {
    return res.status(403).json({ error: "This account does not have dual Employee/Admin access" });
  }

  const token = signSessionToken(user, requestedMode, true);
  return res.json({ token, user: publicSessionUser(user, requestedMode) });
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  // If user has employee_id or is an employee, fetch fresh details
  if (req.user?.id) {
    const [rows] = await pool.execute(
      `SELECT u.id, u.full_name, u.email, u.cnic, u.employee_id, u.client_id, r.name AS role, r.is_active AS role_active
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ? LIMIT 1`,
      [req.user.id]
    );
    const u = (rows as any[])[0];
    if (u?.role_active) {
      let mode: SessionMode;
      if (u.role === "admin" && u.employee_id) {
        const tokenRoleChanged = req.user!.system_role !== u.role;
        mode = !req.user!.mode_selected || tokenRoleChanged
          ? "selection_required"
          : req.user!.mode === "employee"
            ? "employee"
            : "admin";
      } else {
        mode = u.role === "employee" ? "employee" : u.role === "client" ? "client" : "admin";
      }
      return res.json({
        user: publicSessionUser(u, mode),
      });
    }
  }
  return res.status(401).json({ error: "Account is no longer active" });
});

export default router;
