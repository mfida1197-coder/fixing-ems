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
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/pdf")) {
    return { status: response.status, contentType, bytes: new Uint8Array(await response.arrayBuffer()), body: null };
  }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  return { status: response.status, contentType, bytes: null, body };
}

async function login(email: string, password: string) {
  return request("/auth/login", { method: "POST", body: { email, password } });
}

async function main() {
  const suffix = Date.now();
  const adminEmail = `phase9-admin-${suffix}@example.test`;
  const superEmail = `phase9-super-${suffix}@example.test`;
  const password = `P9-${suffix}-safe`;
  const originalOrganization = await getOrganizationAttendanceSettings();
  let employeeId: number | null = null;
  let adminUserId: number | null = null;
  let superUserId: number | null = null;

  try {
    const hash = await bcrypt.hash(password, 12);
    const [roles] = await pool.execute<RowDataPacket[]>(
      "SELECT id, name FROM roles WHERE name IN ('employee', 'admin', 'super_admin') AND is_active = 1",
    );
    const roleId = (name: string) => Number(roles.find((row) => row.name === name)?.id);
    const employeeRoleId = roleId("employee");
    const adminRoleId = roleId("admin");
    const superRoleId = roleId("super_admin");
    check(employeeRoleId > 0 && adminRoleId > 0 && superRoleId > 0, "report API security roles are available");
    const [employee] = await pool.execute<ResultSetHeader>(
      `INSERT INTO employees
         (employee_code, full_name, email, designation, joining_date, employment_type, status)
       VALUES (?, 'Phase 9 API Admin', ?, 'Verifier', '2026-01-01', 'contract', 'active')`,
      [`P9-API-${suffix}`, adminEmail],
    );
    employeeId = employee.insertId;
    const [adminUser] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (role_id, full_name, email, employee_id, password_hash, is_active)
       VALUES (?, 'Phase 9 API Admin', ?, ?, ?, TRUE)`,
      [employeeRoleId, adminEmail, employeeId, hash],
    );
    adminUserId = adminUser.insertId;
    await pool.execute(
      `INSERT INTO employee_attendance_settings
         (employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes)
       VALUES (?, 'remote', 0, 0)`, [employeeId],
    );
    const [superUser] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (role_id, full_name, email, password_hash, is_active)
       VALUES (?, 'Phase 9 API Super Admin', ?, ?, TRUE)`,
      [superRoleId, superEmail, hash],
    );
    superUserId = superUser.insertId;
    const reportPath = "/attendance/reports/preview?from=2098-01-01&to=2098-01-02&employmentStatus=active";
    const pdfPath = "/attendance/reports/attendance.pdf?from=2098-01-01&to=2098-01-02&employmentStatus=active";

    check((await request(reportPath)).status === 401, "attendance report preview rejects unauthenticated requests");
    const employeeLogin = await login(adminEmail, password);
    const employeeToken = String(employeeLogin.body?.token);
    check((await request(reportPath, { token: employeeToken })).status === 403, "normal Employee cannot preview attendance reports");
    check((await request(pdfPath, { token: employeeToken })).status === 403, "normal Employee cannot download attendance reports");
    check((await request("/attendance/settings/organization", { method: "PUT", token: employeeToken, body: { officeLatitude: 31.5, officeLongitude: 74.3, allowedRadiusMeters: 100 } })).status === 403, "normal Employee cannot modify organization GPS settings");

    await pool.execute("UPDATE users SET role_id = ? WHERE id = ?", [adminRoleId, adminUserId]);
    const promotedLogin = await login(adminEmail, password);
    const selectionToken = String(promotedLogin.body?.token);
    const employeeMode = await request("/auth/select-mode", { method: "POST", token: selectionToken, body: { mode: "employee" } });
    const employeeModeToken = String(employeeMode.body?.token);
    check((await request(reportPath, { token: employeeModeToken })).status === 403, "promoted Admin in Employee mode cannot preview reports");
    check((await request(pdfPath, { token: employeeModeToken })).status === 403, "promoted Admin in Employee mode cannot download reports");
    check((await request("/attendance/settings/organization", { method: "PUT", token: employeeModeToken, body: { officeLatitude: 31.5, officeLongitude: 74.3, allowedRadiusMeters: 100 } })).status === 403, "promoted Admin in Employee mode cannot modify GPS settings");

    const adminLogin = await login(adminEmail, password);
    const adminMode = await request("/auth/select-mode", { method: "POST", token: String(adminLogin.body?.token), body: { mode: "admin" } });
    const adminToken = String(adminMode.body?.token);
    check((await request(reportPath, { token: adminToken })).status === 200, "promoted Admin in Admin mode can preview reports");
    check((await request("/attendance/reports/preview?from=2098-02-01&to=2098-01-01", { token: adminToken })).status === 400, "report API rejects reversed date ranges");
    check((await request("/attendance/reports/preview?from=2098-01-01&to=2099-02-01", { token: adminToken })).status === 400, "report API rejects unbounded date ranges");
    check((await request("/attendance/reports/preview?from=2098-01-01&to=2098-01-01&employeeId=not-an-id", { token: adminToken })).status === 400, "report API rejects invalid employee identifiers");
    const adminPdf = await request(pdfPath, { token: adminToken });
    check(adminPdf.status === 200 && adminPdf.contentType.includes("application/pdf") && adminPdf.bytes?.subarray(0, 4).toString() === "37,80,68,70", "Admin mode downloads a real PDF");
    const [adminAudits] = await pool.execute<RowDataPacket[]>(
      "SELECT changes_json FROM audit_logs WHERE user_id = ? AND entity_type = 'attendance_report' ORDER BY id DESC",
      [adminUserId],
    );
    const adminMetadata = typeof adminAudits[0]?.changes_json === "string"
      ? JSON.parse(adminAudits[0].changes_json) as Record<string, unknown>
      : adminAudits[0]?.changes_json as Record<string, unknown> | undefined;
    check(adminAudits.length === 1 && adminMetadata?.employee_filter === "all" && adminMetadata?.report_type === "attendance", "Admin PDF generation creates one audit event with safe filter metadata");
    check((await request("/dashboard/activity", { token: adminToken })).status === 403, "Admin report permission does not expose Recent Activity");

    const beforeGpsAudit = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE user_id = ? AND entity_type = 'organization_attendance_settings'",
      [adminUserId],
    ).then(([rows]) => Number(rows[0].count));
    check(beforeGpsAudit === 0, "fetching/filling GPS coordinates without a save request creates no configuration audit event");
    check((await request("/attendance/settings/organization", { method: "PUT", token: adminToken, body: { officeLatitude: 31.5204, officeLongitude: 74.3587, allowedRadiusMeters: 135 } })).status === 200, "Admin mode can save manual GPS coordinates and radius in metres");
    const persistedGps = await request("/attendance/settings/organization", { token: adminToken });
    check(persistedGps.status === 200 && persistedGps.body?.officeLatitude === 31.5204 && persistedGps.body?.officeLongitude === 74.3587 && persistedGps.body?.allowedRadiusMeters === 135, "saved GPS settings reload with the exact coordinates and radius");
    check((await request("/attendance/settings/organization", { method: "PUT", token: adminToken, body: { officeLatitude: 91, officeLongitude: 74.3, allowedRadiusMeters: 100 } })).status === 400, "GPS settings reject invalid latitude");
    check((await request("/attendance/settings/organization", { method: "PUT", token: adminToken, body: { officeLatitude: 31.5, officeLongitude: 181, allowedRadiusMeters: 100 } })).status === 400, "GPS settings reject invalid longitude");
    check((await request("/attendance/settings/organization", { method: "PUT", token: adminToken, body: { officeLatitude: 31.5, officeLongitude: 74.3, allowedRadiusMeters: 0 } })).status === 400, "GPS settings reject a zero radius");
    check((await request("/attendance/settings/organization", { method: "PUT", token: adminToken, body: { officeLatitude: 31.5, officeLongitude: 74.3, allowedRadiusMeters: -10 } })).status === 400, "GPS settings reject a negative radius");
    check((await request("/attendance/settings/organization", { method: "PUT", token: adminToken, body: { officeLatitude: 31.5, officeLongitude: 74.3, allowedRadiusMeters: "invalid" } })).status === 400, "GPS settings reject a non-numeric radius");
    const afterGpsAudit = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE user_id = ? AND entity_type = 'organization_attendance_settings'",
      [adminUserId],
    ).then(([rows]) => Number(rows[0].count));
    check(afterGpsAudit === 1, "saving changed GPS settings creates the existing configuration audit event exactly once");

    const superLogin = await login(superEmail, password);
    const superToken = String(superLogin.body?.token);
    check((await request(reportPath, { token: superToken })).status === 200, "Super Admin can preview attendance reports");
    const superPdf = await request(pdfPath, { token: superToken });
    check(superPdf.status === 200 && superPdf.contentType.includes("application/pdf"), "Super Admin can download attendance reports");
    const activity = await request("/dashboard/activity", { token: superToken });
    const activities = Array.isArray(activity.body?.activity) ? activity.body.activity as Array<Record<string, unknown>> : [];
    check(activity.status === 200 && activities.some((item) => item.entity_type === "attendance_report"), "Super Admin can see report audit activity through the existing Recent Activity endpoint");
  } finally {
    await pool.execute(
      `UPDATE organization_attendance_settings
       SET office_timezone = ?, office_latitude = ?, office_longitude = ?, allowed_radius_meters = ?, updated_by = ?
       WHERE id = 1`,
      [originalOrganization.officeTimezone, originalOrganization.officeLatitude, originalOrganization.officeLongitude, originalOrganization.allowedRadiusMeters, originalOrganization.updatedBy],
    );
    for (const id of [adminUserId, superUserId]) {
      if (id !== null) {
        await pool.execute("DELETE FROM audit_logs WHERE user_id = ?", [id]);
        await pool.execute("DELETE FROM super_password_attempts WHERE user_id = ?", [id]);
        await pool.execute("DELETE FROM reveal_attempts WHERE user_id = ?", [id]);
      }
    }
    if (employeeId !== null) {
      await pool.execute("DELETE FROM employee_attendance_settings WHERE employee_id = ?", [employeeId]);
    }
    if (adminUserId !== null) await pool.execute("DELETE FROM users WHERE id = ?", [adminUserId]);
    if (superUserId !== null) await pool.execute("DELETE FROM users WHERE id = ?", [superUserId]);
    if (employeeId !== null) await pool.execute("DELETE FROM employees WHERE id = ?", [employeeId]);
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
