import bcrypt from "bcrypt";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../src/db";

const BASE_URL = process.env.API_URL || "http://localhost:4000/api";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`PASS: ${message}`);
}

async function request(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json().catch(() => null) as any;
  return { status: response.status, body };
}

async function login(email: string, password: string) {
  return request("/auth/login", { method: "POST", body: { email, password } });
}

async function main() {
  const suffix = Date.now();
  const employeeCode = `P4A-${suffix}`;
  const email = `phase4-api-${suffix}@example.test`;
  const password = `P4-${suffix}-safe`;
  let employeeId: number | null = null;
  let userId: number | null = null;
  let employeeRoleId: number | null = null;

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const connection = await pool.getConnection();
    try {
      const [roleRows] = await connection.execute<RowDataPacket[]>(
        "SELECT id, name FROM roles WHERE name IN ('employee', 'admin') AND is_active = 1",
      );
      employeeRoleId = Number(roleRows.find((row) => row.name === "employee")?.id);
      const adminRoleId = Number(roleRows.find((row) => row.name === "admin")?.id);
      check(employeeRoleId > 0 && adminRoleId > 0, "active EMS employee/admin roles are available");

      const [employeeInsert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO employees
           (employee_code, full_name, email, designation, joining_date, employment_type, status)
         VALUES (?, 'Phase 4 API Verification', ?, 'Verifier', '2026-01-01', 'contract', 'active')`,
        [employeeCode, email],
      );
      employeeId = employeeInsert.insertId;
      const [userInsert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO users
           (role_id, full_name, email, employee_id, password_hash, is_active)
         VALUES (?, 'Phase 4 API Verification', ?, ?, ?, 1)`,
        [employeeRoleId, email, employeeId, passwordHash],
      );
      userId = userInsert.insertId;
      await connection.execute(
        `INSERT INTO employee_attendance_settings
           (employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes)
         VALUES (?, 'remote', 0, 0)`,
        [employeeId],
      );
    } finally {
      connection.release();
    }

    const unauthenticated = await request("/attendance/me/current");
    check(unauthenticated.status === 401, "attendance endpoints reject unauthenticated requests");

    const employeeLogin = await login(email, password);
    check(employeeLogin.status === 200 && employeeLogin.body.user.mode === "employee", "employee login uses employee mode");
    const employeeToken = employeeLogin.body.token as string;
    const ownState = await request("/attendance/me/current", { token: employeeToken });
    check(ownState.status === 200 && ownState.body.attendanceMode === "remote", "employee can read own attendance state");
    const invalidCoordinates = await request("/attendance/me/check-in", {
      method: "POST",
      token: employeeToken,
      body: { coordinates: { latitude: 999, longitude: 0 } },
    });
    check(
      invalidCoordinates.status === 400 && invalidCoordinates.body.code === "INVALID_GPS_COORDINATES",
      "API validates supplied coordinates even for remote mode without creating attendance",
    );
    const idorAttempt = await request(`/attendance/employees/${employeeId}/current`, { token: employeeToken });
    check(idorAttempt.status === 403, "employee cannot use admin employee-id attendance reads");
    const oversizedRange = await request(
      "/attendance/me/history?from=2024-01-01&to=2026-01-01",
      { token: employeeToken },
    );
    check(
      oversizedRange.status === 400 && oversizedRange.body.code === "DATE_RANGE_TOO_LARGE",
      "history API rejects unbounded date ranges",
    );
    const tamperedToken = `${employeeToken.slice(0, -1)}${employeeToken.endsWith("a") ? "b" : "a"}`;
    const tampered = await request("/attendance/me/current", { token: tamperedToken });
    check(tampered.status === 401, "tampered role/session token is rejected");

    const [adminRoleRows] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM roles WHERE name = 'admin' AND is_active = 1 LIMIT 1",
    );
    await pool.execute("UPDATE users SET role_id = ? WHERE id = ?", [adminRoleRows[0].id, userId]);

    const staleToken = await request("/attendance/me/current", { token: employeeToken });
    check(staleToken.status === 403, "role change invalidates stale employee-mode access until mode selection");
    const dualLoginForEmployee = await login(email, password);
    check(
      dualLoginForEmployee.status === 200
        && dualLoginForEmployee.body.user.requires_mode_selection === true,
      "promoted Admin receives the Phase 2 mode-selection gate",
    );
    const employeeMode = await request("/auth/select-mode", {
      method: "POST",
      token: dualLoginForEmployee.body.token,
      body: { mode: "employee" },
    });
    check(employeeMode.status === 200, "promoted Admin can select Employee mode");
    const employeeModeSelf = await request("/attendance/me/current", { token: employeeMode.body.token });
    const employeeModeAdminRead = await request(`/attendance/employees/${employeeId}/current`, {
      token: employeeMode.body.token,
    });
    check(
      employeeModeSelf.status === 200 && employeeModeAdminRead.status === 403,
      "promoted Admin in Employee mode behaves only as the linked employee",
    );

    const dualLoginForAdmin = await login(email, password);
    const adminMode = await request("/auth/select-mode", {
      method: "POST",
      token: dualLoginForAdmin.body.token,
      body: { mode: "admin" },
    });
    check(adminMode.status === 200, "promoted Admin can select Admin mode");
    const adminRead = await request(`/attendance/employees/${employeeId}/current`, {
      token: adminMode.body.token,
    });
    const adminSelfAction = await request("/attendance/me/current", { token: adminMode.body.token });
    check(adminRead.status === 200, "Admin mode can read an authorized employee attendance view");
    check(
      adminSelfAction.status === 403 && adminSelfAction.body.code === "EMPLOYEE_MODE_REQUIRED",
      "Admin mode cannot use employee self-service attendance actions",
    );

    const [attendanceRows] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM attendance_sessions WHERE employee_id = ?",
      [employeeId],
    );
    check(Number(attendanceRows[0].count) === 0, "API authorization verification created no attendance history");
  } finally {
    if (userId !== null && employeeRoleId !== null) {
      await pool.execute("UPDATE users SET role_id = ? WHERE id = ?", [employeeRoleId, userId]);
    }
    if (employeeId !== null) {
      await pool.execute(
        `DELETE b FROM attendance_breaks b
         JOIN attendance_sessions s ON s.id = b.attendance_session_id
         WHERE s.employee_id = ?`,
        [employeeId],
      );
      await pool.execute("DELETE FROM attendance_sessions WHERE employee_id = ?", [employeeId]);
      await pool.execute("DELETE FROM leave_requests WHERE employee_id = ?", [employeeId]);
      await pool.execute("DELETE FROM employee_attendance_settings WHERE employee_id = ?", [employeeId]);
    }
    if (userId !== null) {
      await pool.execute("DELETE FROM audit_logs WHERE user_id = ?", [userId]);
      await pool.execute("DELETE FROM super_password_attempts WHERE user_id = ?", [userId]);
      await pool.execute("DELETE FROM reveal_attempts WHERE user_id = ?", [userId]);
    }
    if (userId !== null) await pool.execute("DELETE FROM users WHERE id = ?", [userId]);
    if (employeeId !== null) await pool.execute("DELETE FROM employees WHERE id = ?", [employeeId]);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
