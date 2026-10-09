import crypto from "crypto";
import { pool } from "../db";
import { encrypt, decrypt } from "../crypto";

export type SenderSlot = "primary" | "secondary";
export type EmailAttachment = { name: string; mime: string; buffer: Buffer };
export const emailValid = (value: string) => value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
export function senderSlot(value: unknown): SenderSlot {
  if (value !== "primary" && value !== "secondary") throw new Error("Choose Primary or Secondary account");
  return value;
}
export function oauthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Google email authorization is not configured");
  return { clientId, clientSecret, redirectUri };
}
export async function googleJson(url: string, options: RequestInit) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error("Google email service is unavailable. Reconnect the account or try again.");
  return data;
}
export async function tokenExchange(params: Record<string, string>) {
  const config = oauthConfig();
  return googleJson("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }),
  });
}
export async function emailAccounts() {
  const [rows] = await pool.execute("SELECT slot, email, status FROM company_email_accounts ORDER BY FIELD(slot,'primary','secondary')");
  return rows;
}
export async function sendEmail(slot: SenderSlot, to: string, subject: string, message: string, attachment?: EmailAttachment) {
  if (!emailValid(to) || !subject.trim() || subject.length > 200 || /[\r\n]/.test(subject) || message.length > 50_000) throw new Error("Enter a valid recipient, subject, and message");
  const [rows] = await pool.execute("SELECT email, refresh_token_encrypted, status FROM company_email_accounts WHERE slot = ?", [slot]);
  const account = (rows as Array<{ email: string; refresh_token_encrypted: Buffer | null; status: string }>)[0];
  if (!account?.refresh_token_encrypted || account.status !== "connected") throw new Error("Selected company email account is not connected. Ask Super Admin to connect it.");
  let accessToken: string;
  try {
    const tokens = await tokenExchange({ grant_type: "refresh_token", refresh_token: decrypt(account.refresh_token_encrypted) });
    if (typeof tokens.access_token !== "string") throw new Error();
    accessToken = tokens.access_token;
  } catch {
    await pool.execute("UPDATE company_email_accounts SET status = 'reconnect_required' WHERE slot = ? AND refresh_token_encrypted = ?", [slot, account.refresh_token_encrypted]);
    throw new Error("Company email authorization needs reconnecting. Ask Super Admin to reconnect it.");
  }
  const boundary = `ems_${crypto.randomBytes(18).toString("hex")}`;
  const bodyEncoded = Buffer.from(message).toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
  const lines = [`From: ${account.email}`, `To: ${to}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", bodyEncoded];
  if (attachment) {
    const safeName = attachment.name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120) || "attachment";
    lines.push(`--${boundary}`, `Content-Type: ${attachment.mime}; name="${safeName}"`, `Content-Disposition: attachment; filename="${safeName}"`, "Content-Transfer-Encoding: base64", "", attachment.buffer.toString("base64").match(/.{1,76}/g)?.join("\r\n") || "");
  }
  lines.push(`--${boundary}--`, "");
  await googleJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: Buffer.from(lines.join("\r\n")).toString("base64url") }) });
}
export async function notifyEmployeeRequest(employeeId: number, requestType: string) {
  try {
    const [employees] = await pool.execute("SELECT full_name FROM employees WHERE id = ?", [employeeId]);
    const [accounts] = await pool.execute("SELECT email FROM company_email_accounts WHERE slot = 'primary' AND status = 'connected'");
    const name = (employees as Array<{ full_name: string }>)[0]?.full_name;
    const to = (accounts as Array<{ email: string }>)[0]?.email;
    if (name && to) await sendEmail("primary", to, "Employee Request Submitted", `Employee: ${name}\nRequest Type: ${requestType}`);
  } catch { console.warn("[email] Employee request notification could not be delivered"); }
}
export { encrypt, decrypt };
