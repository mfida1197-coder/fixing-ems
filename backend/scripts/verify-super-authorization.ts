import assert from "assert/strict";
import bcrypt from "bcrypt";
import { pool } from "../src/db";
import { requireSuperPassword } from "../src/middleware/auth";
import { superAuthorizedUntil, revokeSuperAuthorization, clearSuperAuthorizations } from "../src/security/superPassword";
async function main() {
  const hash = await bcrypt.hash("test-super-password", 4);
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  (pool as any).execute = async (sql: string) => {
    if (sql.includes("COUNT")) return [[{ count: 0 }]];
    if (sql.includes("SELECT super_password_hash")) return [[{ super_password_hash: hash }]];
    return [{ affectedRows: 1 }];
  };
  let calls = 0;
  const next = (error?: unknown) => { if (error) throw error; calls++; };
  const req = (user = 1, session = "session-a", password?: string, role = "admin") => ({ user: { id: user, role, mode: role === "admin" ? "admin" : "employee", sessionKey: session }, headers: password ? { "x-super-password": password } : {}, ip: null });
  const res = () => ({ code: 200, payload: null as any, status(code: number) { this.code = code; return this; }, json(value: unknown) { this.payload = value; return this; } });
  try {
    let response = res(); await requireSuperPassword(req() as any, response as any, next); assert.equal(response.payload.code, "SUPER_PASSWORD_REQUIRED");
    await requireSuperPassword(req(1, "session-a", "test-super-password") as any, res() as any, next);
    const until = superAuthorizedUntil(1, "session-a"); assert.equal(until, now + 600000);
    now += 9 * 60000; await requireSuperPassword(req() as any, res() as any, next); assert.equal(superAuthorizedUntil(1, "session-a"), until);
    response = res(); await requireSuperPassword(req(2, "session-b") as any, response as any, next); assert.equal(response.code, 403);
    response = res(); await requireSuperPassword(req(1, "another-device") as any, response as any, next); assert.equal(response.code, 403);
    response = res(); await requireSuperPassword(req(1, "session-a", undefined, "employee") as any, response as any, next); assert.equal(response.code, 403);
    now = until!; response = res(); await requireSuperPassword(req() as any, response as any, next); assert.equal(response.payload.code, "SUPER_PASSWORD_REQUIRED");
    response = res(); await requireSuperPassword(req(1, "session-a", "wrong") as any, response as any, next); assert.equal(response.code, 401); assert.equal(superAuthorizedUntil(1, "session-a"), null);
    await requireSuperPassword(req(1, "session-a", "test-super-password") as any, res() as any, next);
    revokeSuperAuthorization("session-a"); assert.equal(superAuthorizedUntil(1, "session-a"), null);
    response = res(); await requireSuperPassword(req(1, "new-login") as any, response as any, next); assert.equal(response.code, 403);
    assert.equal(calls, 3);
    console.log("PASS: correct/wrong verification, fixed ten-minute expiry, non-sliding reuse, per-user/device/mode isolation, logout/new-session isolation and protected-action enforcement.");
  } finally { Date.now = originalNow; clearSuperAuthorizations(); await pool.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
