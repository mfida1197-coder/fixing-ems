import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { pool } from "../src/db";
import employees from "../src/routes/employees";
import { requireAuth, requirePermission, requireSuperPassword } from "../src/middleware/auth";

async function main() {
  const originalConnection = pool.getConnection, originalExecute = pool.execute;
  let role = "admin", committed = false;
  const writes: string[] = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => { committed = true; }, rollback: async () => {}, release: () => {},
    execute: async (sql: string) => {
      if (sql.includes("FROM employees")) return [[{ id: 9, linked_user_id: 11, current_role: role }]];
      if (sql.includes("FROM roles")) return [[{ id: 3 }]];
      writes.push(sql); return [{ affectedRows: 1 }];
    },
  };
  (pool as any).getConnection = async () => connection;
  try {
    const route = (employees as any).stack.find((layer: any) => layer.route?.path === "/:id/demote").route;
    assert.equal(route.stack[1].handle, requireSuperPassword);
    let status = 200;
    const response: any = { status: (code: number) => { status = code; return response; }, json: () => response };
    await route.stack[0].handle({ user: { role: "admin", mode_selected: true } }, response, () => { throw new Error("Admin authorization unexpectedly allowed"); });
    assert.equal(status, 403);
    status = 200;
    await route.stack.at(-1).handle({ params: { id: "9" }, user: { id: 1 }, ip: null }, response, (error: unknown) => { if (error) throw error; });
    assert.ok(committed); assert.equal(status, 200);
    assert.equal(writes.length, 2);
    assert.ok(writes[0].startsWith("UPDATE users SET role_id")); assert.ok(writes[1].includes("audit_logs"));
    role = "super_admin"; status = 200;
    await route.stack.at(-1).handle({ params: { id: "9" }, user: { id: 1 } }, response, () => {});
    assert.equal(status, 409); assert.equal(writes.length, 2);
    (pool as any).execute = async () => [[{ id: 11, full_name: "Demoted", role: "employee", is_active: true, role_active: true, employee_id: 9, client_id: null }]];
    const token = jwt.sign({ role: "admin", system_role: "admin", mode: "admin", mode_selected: true }, process.env.JWT_SECRET!, { subject: "11" });
    const request: any = { headers: { authorization: `Bearer ${token}` } };
    let authenticated = false;
    await requireAuth(request, response, () => { authenticated = true; });
    assert.ok(authenticated); assert.equal(request.user.role, "employee");
    status = 200;
    requirePermission("employees:manage")(request, response, () => { throw new Error("Stale Admin token retained permission"); });
    assert.equal(status, 403);
    console.log("PASS: Super Admin-only management, shared Super Password middleware, role-only update/audit, Super Admin safety and stale Admin JWT denial. Mocked writes only.");
  } finally { pool.getConnection = originalConnection; pool.execute = originalExecute; await pool.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
