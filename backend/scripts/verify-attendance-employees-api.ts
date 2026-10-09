import bcrypt from "bcrypt";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getOrganizationAttendanceSettings } from "../src/attendance/settingsService";
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
  const email = `phase8-dual-${suffix}@example.test`;
  const superEmail = `phase8-super-${suffix}@example.test`;
  const password = `P8-${suffix}-safe`;
  const originalOrganization = await getOrganizationAttendanceSettings();
  let employeeId: number | null = null;
  let userId: number | null = null;
  let superUserId: number | null = null;

  try {
    const hash = await bcrypt.hash(password, 12);
    const [roles] = await pool.execute<RowDataPacket[]>(
      "SELECT id, name FROM roles WHERE name IN ('employee', 'admin', 'super_admin') AND is_active = 1",
    );
    const role = (name: string) => Number(roles.find((row) => row.name === name)?.id);
    const employeeRoleId = role("employee");
    const adminRoleId = role("admin");
    const superRoleId = role("super_admin");
    check(employeeRoleId > 0 && adminRoleId > 0 && superRoleId > 0, "Phase 8 API security roles are available");
    const [employee] = await pool.execute<ResultSetHeader>(
      `INSERT INTO employees
         (employee_code, full_name, email, designation, joining_date, employment_type, status)
       VALUES (?, 'Phase 8 API Employee', ?, 'Verifier', '2026-01-01', 'contract', 'active')`,
      [`P8-API-${suffix}`, email],
    );
    employeeId = employee.insertId;
    const [user] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (role_id, full_name, email, employee_id, password_hash, is_active)
       VALUES (?, 'Phase 8 API Employee', ?, ?, ?, TRUE)`,
      [employeeRoleId, email, employeeId, hash],
    );
    userId = user.insertId;
    await pool.execute(
      `INSERT INTO employee_attendance_settings
         (employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes)
       VALUES (?, 'remote', 0, 0)`, [employeeId],
    );
    const [superUser] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (role_id, full_name, email, password_hash, is_active)
       VALUES (?, 'Phase 8 API Super Admin', ?, ?, TRUE)`, [superRoleId, superEmail, hash],
    );
    superUserId = superUser.insertId;

    check((await request("/attendance/employees")).status === 401, "attendance employee directory rejects unauthenticated requests");
    const employeeLogin = await login(email, password);
    const employeeToken = String(employeeLogin.body?.token);
    check((await request("/attendance/employees", { token: employeeToken })).status === 403, "normal Employee cannot access Attendance Employees");
    check((await request(`/attendance/employees/${employeeId}/settings`, { method: "PUT", token: employeeToken, body: { attendanceMode: "gps", weeklyTargetMinutes: 60, monthlyTargetMinutes: 240 } })).status === 403, "normal Employee cannot update attendance settings");

    await pool.execute("UPDATE users SET role_id = ? WHERE id = ?", [adminRoleId, userId]);
    const employeeModeLogin = await login(email, password);
    const employeeMode = await request("/auth/select-mode", { method: "POST", token: String(employeeModeLogin.body?.token), body: { mode: "employee" } });
    const employeeModeToken = String(employeeMode.body?.token);
    check((await request("/attendance/employees", { token: employeeModeToken })).status === 403, "promoted Admin in Employee mode cannot access Attendance Employees");
    check((await request(`/attendance/employees/${employeeId}/settings`, { method: "PUT", token: employeeModeToken, body: { attendanceMode: "gps", weeklyTargetMinutes: 60, monthlyTargetMinutes: 240 } })).status === 403, "promoted Admin in Employee mode cannot update attendance settings");

    const adminLogin = await login(email, password);
    const adminMode = await request("/auth/select-mode", { method: "POST", token: String(adminLogin.body?.token), body: { mode: "admin" } });
    const adminToken = String(adminMode.body?.token);
    const directory = await request("/attendance/employees", { token: adminToken });
    check(directory.status === 200 && Array.isArray(directory.body?.employees), "Admin mode can access the typed attendance employee directory");
    check((await request(`/attendance/employees/${employeeId}/profile`, { token: adminToken })).status === 200, "Admin mode can access an individual attendance profile");
    const updated = await request(`/attendance/employees/${employeeId}/settings`, {
      method: "PUT", token: adminToken,
      body: { attendanceMode: "gps", weeklyTargetMinutes: 2400, monthlyTargetMinutes: 9600 },
    });
    check(updated.status === 200 && updated.body?.attendanceMode === "gps", "Admin mode can update employee attendance mode and minute targets");
    check((await request(`/attendance/employees/${employeeId}/settings`, { method: "PUT", token: adminToken, body: { attendanceMode: "remote", weeklyTargetMinutes: -1, monthlyTargetMinutes: 0 } })).status === 400, "API rejects invalid employee attendance targets");
    check((await request("/attendance/settings/organization", { method: "PUT", token: adminToken, body: { officeLatitude: 31.5204, officeLongitude: 74.3587, allowedRadiusMeters: 125 } })).status === 200, "Admin mode can configure organization GPS settings");
    check((await request("/attendance/settings/organization", { method: "PUT", token: adminToken, body: { officeLatitude: 91, officeLongitude: 0, allowedRadiusMeters: 100 } })).status === 400, "API rejects invalid organization GPS settings");
    check((await request("/dashboard/activity", { token: adminToken })).status === 403, "Admin attendance settings access does not expose Recent Activity");

    const superLogin = await login(superEmail, password);
    const superToken = String(superLogin.body?.token);
    check((await request("/attendance/employees", { token: superToken })).status === 200, "Super Admin can access Attendance Employees");
    check((await request(`/attendance/employees/${employeeId}/settings`, { method: "PUT", token: superToken, body: { attendanceMode: "remote", weeklyTargetMinutes: 0, monthlyTargetMinutes: 0 } })).status === 200, "Super Admin can manage attendance settings");
    check((await request("/dashboard/activity", { token: superToken })).status === 200, "Super Admin retains Recent Activity access");
  } finally {
    await pool.execute(
      `UPDATE organization_attendance_settings
       SET office_timezone = ?, office_latitude = ?, office_longitude = ?, allowed_radius_meters = ?, updated_by = ?
       WHERE id = 1`,
      [originalOrganization.officeTimezone, originalOrganization.officeLatitude, originalOrganization.officeLongitude, originalOrganization.allowedRadiusMeters, originalOrganization.updatedBy],
    );
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

main().catch((error) => { console.error(error); process.exitCode = 1; });
