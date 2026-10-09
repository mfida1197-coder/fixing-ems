import bcrypt from "bcrypt";
import { pool } from "../db";
import { audit } from "../audit";

const MAX_FAILED_ATTEMPTS = 3;
const authorizations = new Map<string, { userId: number; until: number }>();
export function superAuthorizedUntil(userId: number, sessionKey: string, now = Date.now()): number | null {
  const grant = authorizations.get(sessionKey);
  if (!grant || grant.userId !== userId || grant.until <= now) { authorizations.delete(sessionKey); return null; }
  return grant.until;
}
export function grantSuperAuthorization(userId: number, sessionKey: string, now = Date.now()): number {
  for (const [key, value] of authorizations) if (value.until <= now) authorizations.delete(key);
  const until = now + 10 * 60 * 1000;
  authorizations.set(sessionKey, { userId, until }); return until;
}
export function revokeSuperAuthorization(sessionKey: string) { authorizations.delete(sessionKey); }
export function clearSuperAuthorizations() { authorizations.clear(); }

export class SuperPasswordError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function verifySuperPassword(
  userId: number,
  password: string,
  ip: string | null,
): Promise<void> {
  if (!password) {
    throw new SuperPasswordError("Super Password is required", 403);
  }

  const [failedRows] = await pool.execute(
    `SELECT COUNT(*) AS count
     FROM super_password_attempts
     WHERE user_id = ? AND success = FALSE AND created_at > NOW() - INTERVAL 15 MINUTE`,
    [userId],
  );
  if (Number((failedRows as any[])[0]?.count ?? 0) >= MAX_FAILED_ATTEMPTS) {
    throw new SuperPasswordError("Too many failed attempts. Try again in 15 minutes", 429);
  }

  const [rows] = await pool.execute(
    "SELECT super_password_hash FROM system_security_settings WHERE id = 1 LIMIT 1",
  );
  const hash = (rows as any[])[0]?.super_password_hash;
  if (!hash) {
    throw new SuperPasswordError("Super Password is not configured", 503);
  }

  const valid = await bcrypt.compare(password, hash);
  await pool.execute(
    "INSERT INTO super_password_attempts (user_id, success, ip_address) VALUES (?, ?, ?)",
    [userId, valid, ip],
  );

  if (!valid) {
    await audit(userId, "super_password_failed", "system_security", 1, null, ip);
    throw new SuperPasswordError("Incorrect Super Password", 401);
  }

  await audit(userId, "super_password_verified", "system_security", 1, null, ip);
}
