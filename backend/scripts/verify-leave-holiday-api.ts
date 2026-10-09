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
  const body = await response.json().catch(() => null) as Record<string, any> | null;
  return { status: response.status, body };
}

async function login(email: string, password: string) {
  return request("/auth/login", { method: "POST", body: { email, password } });
}

async function selectMode(token: string, mode: "employee" | "admin") {
  return request("/auth/select-mode", { method: "POST", token, body: { mode } });
}

async function main() {
  const suffix = Date.now();
  const email = `phase6-dual-${suffix}@example.test`;
  const superEmail = `phase6-super-${suffix}@example.test`;
  const password = `P6-${suffix}-safe`;
  let employeeId: number | null = null;
  let userId: number | null = null;
  let superUserId: number | null = null;
  let employeeRoleId: number | null = null;
  let adminRoleId: number | null = null;
  let leaveId: number | null = null;
  let holidayId: number | null = null;

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [roleRows] = await pool.execute<RowDataPacket[]>(
      "SELECT id, name FROM roles WHERE name IN ('employee', 'admin', 'super_admin') AND is_active = 1",
    );
    const role = (name: string) => Number(roleRows.find((row) => row.name === name)?.id);
    employeeRoleId = role("employee");
    adminRoleId = role("admin");
    const superRoleId = role("super_admin");
    check(employeeRoleId > 0 && adminRoleId > 0 && superRoleId > 0, "active role foundation is available");

    const [employeeInsert] = await pool.execute<ResultSetHeader>(
      `INSERT INTO employees
         (employee_code, full_name, email, designation, joining_date, employment_type, status)
       VALUES (?, 'Phase 6 API Employee', ?, 'Verifier', '2026-01-01', 'contract', 'active')`,
      [`P6-API-${suffix}`, email],
    );
    employeeId = employeeInsert.insertId;
    const [userInsert] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (role_id, full_name, email, employee_id, password_hash, is_active)
       VALUES (?, 'Phase 6 API Employee', ?, ?, ?, TRUE)`,
      [employeeRoleId, email, employeeId, passwordHash],
    );
    userId = userInsert.insertId;
    await pool.execute(
      `INSERT INTO employee_attendance_settings
         (employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes)
       VALUES (?, 'remote', 0, 0)`,
      [employeeId],
    );
    const [superInsert] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (role_id, full_name, email, password_hash, is_active)
       VALUES (?, 'Phase 6 API Super Admin', ?, ?, TRUE)`,
      [superRoleId, superEmail, passwordHash],
    );
    superUserId = superInsert.insertId;

    const unauthenticated = await request("/leaves/me");
    check(unauthenticated.status === 401, "leave endpoints reject unauthenticated requests");
    const employeeLogin = await login(email, password);
    check(employeeLogin.status === 200 && employeeLogin.body?.user.mode === "employee", "normal employee logs in directly to Employee mode");
    const employeeToken = String(employeeLogin.body?.token);
    const create = await request("/leaves/me", {
      method: "POST",
      token: employeeToken,
      body: {
        employeeId: employeeId! + 999_999,
        leaveType: "full_day",
        startDate: "2096-04-01",
        endDate: "2096-04-01",
        reason: "API ownership verification",
        status: "approved",
      },
    });
    leaveId = Number(create.body?.id);
    check(
      create.status === 201
        && create.body?.employeeId === employeeId
        && create.body?.status === "pending",
      "employee identity and pending status are server-authoritative",
    );
    const ownList = await request("/leaves/me", { token: employeeToken });
    check(ownList.status === 200 && ownList.body?.requests.length === 1, "employee can list only own leave requests");
    const employeeManage = await request("/leaves?status=pending", { token: employeeToken });
    const employeeDecision = await request(`/leaves/${leaveId}/approve`, { method: "PATCH", token: employeeToken });
    const employeeHoliday = await request("/holidays", { token: employeeToken });
    check(
      employeeManage.status === 403 && employeeDecision.status === 403 && employeeHoliday.status === 403,
      "normal employee cannot manage leave decisions or holidays",
    );

    await pool.execute("UPDATE users SET role_id = ? WHERE id = ?", [adminRoleId, userId]);
    const freshDualEmployeeLogin = await login(email, password);
    check(freshDualEmployeeLogin.body?.user.requires_mode_selection === true, "promoted Admin receives the mode-selection gate");
    const employeeMode = await selectMode(String(freshDualEmployeeLogin.body?.token), "employee");
    const promotedOwn = await request("/leaves/me", { token: String(employeeMode.body?.token) });
    const promotedManage = await request("/leaves", { token: String(employeeMode.body?.token) });
    const promotedHoliday = await request("/holidays", { token: String(employeeMode.body?.token) });
    check(
      promotedOwn.status === 200 && promotedManage.status === 403 && promotedHoliday.status === 403,
      "promoted Admin in Employee mode remains self-service only",
    );

    const freshDualAdminLogin = await login(email, password);
    const adminMode = await selectMode(String(freshDualAdminLogin.body?.token), "admin");
    const adminToken = String(adminMode.body?.token);
    const adminSelfCreate = await request("/leaves/me", {
      method: "POST",
      token: adminToken,
      body: { leaveType: "full_day", startDate: "2096-04-02", endDate: "2096-04-02" },
    });
    const adminList = await request("/leaves?status=pending", { token: adminToken });
    const approve = await request(`/leaves/${leaveId}/approve`, { method: "PATCH", token: adminToken });
    const conflictingDecision = await request(`/leaves/${leaveId}/reject`, { method: "PATCH", token: adminToken });
    check(adminSelfCreate.status === 403, "Admin mode cannot use employee self-service leave routes");
    check(adminList.status === 200 && approve.status === 200 && approve.body?.status === "approved", "Admin mode can review and approve pending leave");
    check(conflictingDecision.status === 409, "API blocks a conflicting second leave decision");

    const holiday = await request("/holidays", {
      method: "POST",
      token: adminToken,
      body: { holidayDate: "2096-04-03", name: "Phase 6 API Holiday" },
    });
    holidayId = Number(holiday.body?.id);
    const updatedHoliday = await request(`/holidays/${holidayId}`, {
      method: "PUT",
      token: adminToken,
      body: { holidayDate: "2096-04-04", name: "Phase 6 API Holiday Updated" },
    });
    check(holiday.status === 201 && updatedHoliday.status === 200, "Admin mode can create and edit configured holidays");
    const adminActivity = await request("/dashboard/activity", { token: adminToken });
    check(adminActivity.status === 403, "Recent Activity remains unavailable to Admin mode");

    const superLogin = await login(superEmail, password);
    const superToken = String(superLogin.body?.token);
    const superLeave = await request("/leaves?status=approved", { token: superToken });
    const superHolidays = await request("/holidays", { token: superToken });
    const superActivity = await request("/dashboard/activity", { token: superToken });
    check(
      superLeave.status === 200 && superHolidays.status === 200 && superActivity.status === 200,
      "Super Admin can manage Phase 6 records and retains Recent Activity access",
    );
    const deletedHoliday = await request(`/holidays/${holidayId}`, { method: "DELETE", token: superToken });
    check(deletedHoliday.status === 200, "Super Admin can delete a configured holiday");
    holidayId = null;
  } finally {
    if (holidayId !== null) await pool.execute("DELETE FROM holidays WHERE id = ?", [holidayId]);
    if (employeeId !== null) {
      await pool.execute("DELETE FROM leave_requests WHERE employee_id = ?", [employeeId]);
      await pool.execute("DELETE FROM employee_attendance_settings WHERE employee_id = ?", [employeeId]);
    }
    for (const id of [userId, superUserId]) {
      if (id !== null) {
        await pool.execute("DELETE FROM audit_logs WHERE user_id = ?", [id]);
        await pool.execute("DELETE FROM super_password_attempts WHERE user_id = ?", [id]);
        await pool.execute("DELETE FROM reveal_attempts WHERE user_id = ?", [id]);
      }
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
