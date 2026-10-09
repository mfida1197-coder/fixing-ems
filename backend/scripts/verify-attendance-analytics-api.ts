import bcrypt from "bcrypt";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../src/db";

const BASE_URL = process.env.API_URL || "http://localhost:4000/api";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`PASS: ${message}`);
}

async function request(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  return { status: response.status, body };
}

async function login(email: string, password: string) {
  return request("/auth/login", { method: "POST", body: { email, password } });
}

async function main() {
  const suffix = Date.now();
  const employeeEmail = `phase7-dual-${suffix}@example.test`;
  const superEmail = `phase7-super-${suffix}@example.test`;
  const password = `P7-${suffix}-safe`;
  let employeeId: number | null = null;
  let userId: number | null = null;
  let superUserId: number | null = null;
  let employeeRoleId: number | null = null;

  try {
    const hash = await bcrypt.hash(password, 12);
    const [roles] = await pool.execute<RowDataPacket[]>(
      "SELECT id, name FROM roles WHERE name IN ('employee', 'admin', 'super_admin') AND is_active = 1",
    );
    const role = (name: string) => Number(roles.find((row) => row.name === name)?.id);
    employeeRoleId = role("employee");
    const adminRoleId = role("admin");
    const superRoleId = role("super_admin");
    check(employeeRoleId > 0 && adminRoleId > 0 && superRoleId > 0, "analytics security roles are available");

    const [employee] = await pool.execute<ResultSetHeader>(
      `INSERT INTO employees
         (employee_code, full_name, email, designation, joining_date, employment_type, status)
       VALUES (?, 'Phase 7 API Employee', ?, 'Verifier', '2026-01-01', 'contract', 'active')`,
      [`P7-API-${suffix}`, employeeEmail],
    );
    employeeId = employee.insertId;
    const [user] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (role_id, full_name, email, employee_id, password_hash, is_active)
       VALUES (?, 'Phase 7 API Employee', ?, ?, ?, TRUE)`,
      [employeeRoleId, employeeEmail, employeeId, hash],
    );
    userId = user.insertId;
    await pool.execute(
      `INSERT INTO employee_attendance_settings
         (employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes)
       VALUES (?, 'remote', 0, 0)`,
      [employeeId],
    );
    const [superUser] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (role_id, full_name, email, password_hash, is_active)
       VALUES (?, 'Phase 7 API Super Admin', ?, ?, TRUE)`,
      [superRoleId, superEmail, hash],
    );
    superUserId = superUser.insertId;

    check((await request("/attendance/dashboard")).status === 401, "analytics endpoint rejects unauthenticated requests");
    const employeeLogin = await login(employeeEmail, password);
    const employeeToken = String(employeeLogin.body?.token);
    check((await request("/attendance/dashboard", { token: employeeToken })).status === 403, "normal employee cannot access attendance analytics");

    await pool.execute("UPDATE users SET role_id = ? WHERE id = ?", [adminRoleId, userId]);
    const employeeModeLogin = await login(employeeEmail, password);
    const employeeMode = await request("/auth/select-mode", {
      method: "POST", token: String(employeeModeLogin.body?.token), body: { mode: "employee" },
    });
    check((await request("/attendance/dashboard", { token: String(employeeMode.body?.token) })).status === 403, "promoted Admin in Employee mode cannot access analytics");

    const adminModeLogin = await login(employeeEmail, password);
    const adminMode = await request("/auth/select-mode", {
      method: "POST", token: String(adminModeLogin.body?.token), body: { mode: "admin" },
    });
    const adminToken = String(adminMode.body?.token);
    const dashboard = await request("/attendance/dashboard?period=30", { token: adminToken });
    check(
      dashboard.status === 200
        && typeof dashboard.body?.kpis === "object"
        && typeof dashboard.body?.timeline === "object",
      "promoted Admin in Admin mode receives typed analytics",
    );
    check((await request("/attendance/dashboard?period=999", { token: adminToken })).status === 400, "invalid overview period is rejected");
    check((await request("/attendance/dashboard?date=not-a-date", { token: adminToken })).status === 400, "invalid dashboard date is rejected");
    check((await request("/dashboard/activity", { token: adminToken })).status === 403, "Admin analytics access does not expose Recent Activity");

    const superLogin = await login(superEmail, password);
    const superToken = String(superLogin.body?.token);
    check((await request("/attendance/dashboard?period=180", { token: superToken })).status === 200, "Super Admin can access attendance analytics");
    check((await request("/dashboard/activity", { token: superToken })).status === 200, "Super Admin retains Recent Activity access");
  } finally {
    for (const id of [userId, superUserId]) {
      if (id !== null) {
        await pool.execute("DELETE FROM audit_logs WHERE user_id = ?", [id]);
        await pool.execute("DELETE FROM super_password_attempts WHERE user_id = ?", [id]);
        await pool.execute("DELETE FROM reveal_attempts WHERE user_id = ?", [id]);
      }
    }
    if (employeeId !== null) {
      await pool.execute("DELETE FROM employee_attendance_settings WHERE employee_id = ?", [employeeId]);
    }
    if (userId !== null) await pool.execute("DELETE FROM users WHERE id = ?", [userId]);
    if (superUserId !== null) await pool.execute("DELETE FROM users WHERE id = ?", [superUserId]);
    if (employeeId !== null) await pool.execute("DELETE FROM employees WHERE id = ?", [employeeId]);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
