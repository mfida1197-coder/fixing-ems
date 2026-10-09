import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { AttendanceEmployeeAdminService } from "../src/attendance/employeeAdminService";
import {
  getEmployeeAttendanceSettings,
  getOrganizationAttendanceSettings,
  updateEmployeeAttendanceSettings,
  updateOrganizationAttendanceSettings,
} from "../src/attendance/settingsService";
import { pool } from "../src/db";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`PASS: ${message}`);
}

async function expectFailure(action: () => Promise<unknown>, message: string) {
  let failed = false;
  try { await action(); } catch { failed = true; }
  check(failed, message);
}

async function main() {
  const now = new Date("2096-04-16T07:00:00.000Z");
  const service = new AttendanceEmployeeAdminService(pool, () => new Date(now));
  const suffix = Date.now();
  const employeeIds: number[] = [];
  let actorId = 0;
  let baselineAuditId = 0;
  let originalOrganization = await getOrganizationAttendanceSettings();

  try {
    const [actors] = await pool.execute<RowDataPacket[]>(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'super_admin' AND u.is_active = TRUE LIMIT 1`,
    );
    actorId = Number(actors[0]?.id);
    check(actorId > 0, "authorized settings actor is available");
    const [auditBaseline] = await pool.execute<RowDataPacket[]>("SELECT COALESCE(MAX(id), 0) AS id FROM audit_logs");
    baselineAuditId = Number(auditBaseline[0].id);

    for (const [key, name, mode, status] of [
      ["A", "Phase 8 GPS", "gps", "active"],
      ["B", "Phase 8 Remote", "remote", "active"],
      ["C", "Phase 8 Leave", "remote", "active"],
      ["D", "Phase 8 No Attendance", "gps", "active"],
      ["E", "Phase 8 Historical", "remote", "resigned"],
    ] as const) {
      const [insert] = await pool.execute<ResultSetHeader>(
        `INSERT INTO employees
           (employee_code, full_name, designation, joining_date, employment_type, status)
         VALUES (?, ?, 'Phase 8 Verifier', '2096-01-01', 'contract', ?)`,
        [`P8-${key}-${suffix}`, name, status],
      );
      employeeIds.push(insert.insertId);
      await pool.execute(
        `INSERT INTO employee_attendance_settings
           (employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes)
         VALUES (?, ?, 2400, 9600)`,
        [insert.insertId, mode],
      );
    }
    const [gps, remote, leaveEmployee, noAttendance, historical] = employeeIds;
    const [gpsSession] = await pool.execute<ResultSetHeader>(
      `INSERT INTO attendance_sessions
         (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc, check_out_at_utc)
       VALUES (?, '2096-04-16', 'Asia/Karachi', 'gps', 'completed',
               '2096-04-16 04:00:00.000', '2096-04-16 12:00:00.000')`, [gps],
    );
    for (const [outAt, inAt] of [
      ["2096-04-16 06:00:00.000", "2096-04-16 06:20:00.000"],
      ["2096-04-16 08:30:00.000", "2096-04-16 09:00:00.000"],
      ["2096-04-16 10:45:00.000", "2096-04-16 11:00:00.000"],
    ]) await pool.execute(
      `INSERT INTO attendance_breaks (attendance_session_id, state, break_out_at_utc, break_in_at_utc)
       VALUES (?, 'completed', ?, ?)`, [gpsSession.insertId, outAt, inAt],
    );
    for (const [checkIn, checkOut] of [
      ["2096-04-16 04:00:00.000", "2096-04-16 06:30:00.000"],
      ["2096-04-16 07:15:00.000", "2096-04-16 09:45:00.000"],
      ["2096-04-16 10:10:00.000", "2096-04-16 12:30:00.000"],
    ]) await pool.execute(
      `INSERT INTO attendance_sessions
         (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc, check_out_at_utc)
       VALUES (?, '2096-04-16', 'Asia/Karachi', 'remote', 'completed', ?, ?)`, [remote, checkIn, checkOut],
    );
    await pool.execute(
      `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, status)
       VALUES (?, 'full_day', '2096-04-16', '2096-04-16', 'approved')`, [leaveEmployee],
    );
    await pool.execute(
      `INSERT INTO attendance_sessions
         (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc, check_out_at_utc)
       VALUES (?, '2096-04-15', 'Asia/Karachi', 'remote', 'completed',
               '2096-04-15 04:00:00.000', '2096-04-15 12:00:00.000')`, [historical],
    );

    const directory = await service.getDirectory("2096-04-16");
    const fixtures = directory.employees.filter((employee) => employee.employeeCode.startsWith("P8-"));
    check(fixtures.length === 5 && new Set(fixtures.map((employee) => employee.employeeId)).size === 5, "directory returns each fixture employee exactly once");
    const find = (key: string) => fixtures.find((employee) => employee.employeeCode.startsWith(`P8-${key}-`));
    check(find("A")?.attendanceState === "present" && find("A")?.selectedDateWorkedSeconds === 24_900, "GPS employee has one break-adjusted present day");
    check(find("B")?.attendanceState === "present" && find("B")?.selectedDateWorkedSeconds === 26_400, "remote employee aggregates three separate sessions once");
    check(find("C")?.attendanceState === "leave", "approved leave remains distinct in the directory");
    check(find("D")?.attendanceState === "pending", "current-day GPS employee without attendance is pending rather than prematurely absent");
    check(find("E")?.employmentStatus === "resigned" && find("E")?.hasAttendanceHistory, "inactive employee remains inspectable with historical attendance");

    const gpsProfile = await service.getProfileOverview(gps, "2096-04-16");
    const remoteProfile = await service.getProfileOverview(remote, "2096-04-16");
    check(gpsProfile.selectedDay.sessions.length === 1 && gpsProfile.selectedDay.sessions[0].session.breaks.length === 3, "GPS profile preserves one session with three child breaks");
    check(remoteProfile.selectedDay.sessions.length === 3 && remoteProfile.selectedDay.totalWorkedSeconds === 26_400, "remote profile preserves three sessions and the backend total");

    const [historyBefore] = await pool.execute<RowDataPacket[]>(
      "SELECT id, attendance_mode, check_in_at_utc, check_out_at_utc FROM attendance_sessions WHERE employee_id = ? ORDER BY id",
      [remote],
    );
    await updateEmployeeAttendanceSettings(remote, { attendanceMode: "gps", weeklyTargetMinutes: 2700, monthlyTargetMinutes: 10_800 }, actorId, null);
    let settings = await getEmployeeAttendanceSettings(remote);
    check(settings.attendanceMode === "gps" && settings.weeklyTargetMinutes === 2700 && settings.monthlyTargetMinutes === 10_800, "Remote to GPS mode and target update persist in minutes");
    await updateEmployeeAttendanceSettings(remote, { attendanceMode: "remote", weeklyTargetMinutes: 2400, monthlyTargetMinutes: 9600 }, actorId, null);
    settings = await getEmployeeAttendanceSettings(remote);
    check(settings.attendanceMode === "remote", "GPS to Remote mode update persists");
    const [historyAfter] = await pool.execute<RowDataPacket[]>(
      "SELECT id, attendance_mode, check_in_at_utc, check_out_at_utc FROM attendance_sessions WHERE employee_id = ? ORDER BY id",
      [remote],
    );
    check(JSON.stringify(historyAfter) === JSON.stringify(historyBefore), "mode and target changes do not rewrite attendance history");
    await expectFailure(
      () => updateEmployeeAttendanceSettings(remote, { attendanceMode: "remote", weeklyTargetMinutes: -1, monthlyTargetMinutes: 1 }, actorId, null),
      "invalid attendance target is rejected",
    );

    await updateOrganizationAttendanceSettings({
      officeTimezone: "Asia/Karachi", officeLatitude: 31.5204,
      officeLongitude: 74.3587, allowedRadiusMeters: 150,
    }, actorId, null);
    const organization = await getOrganizationAttendanceSettings();
    check(organization.officeLatitude === 31.5204 && organization.officeLongitude === 74.3587 && organization.allowedRadiusMeters === 150, "valid organization GPS settings persist");
    await expectFailure(() => updateOrganizationAttendanceSettings({ officeTimezone: "Asia/Karachi", officeLatitude: 91, officeLongitude: 0, allowedRadiusMeters: 100 }, actorId, null), "invalid latitude is rejected");
    await expectFailure(() => updateOrganizationAttendanceSettings({ officeTimezone: "Asia/Karachi", officeLatitude: 0, officeLongitude: 181, allowedRadiusMeters: 100 }, actorId, null), "invalid longitude is rejected");
    await expectFailure(() => updateOrganizationAttendanceSettings({ officeTimezone: "Asia/Karachi", officeLatitude: 0, officeLongitude: 0, allowedRadiusMeters: 100_001 }, actorId, null), "invalid radius is rejected");

    const [audits] = await pool.execute<RowDataPacket[]>(
      `SELECT entity_type FROM audit_logs WHERE user_id = ?
       AND entity_type IN ('employee_attendance_settings', 'organization_attendance_settings')
       AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)`, [actorId],
    );
    check(audits.some((row) => row.entity_type === "employee_attendance_settings") && audits.some((row) => row.entity_type === "organization_attendance_settings"), "attendance configuration changes are audited");
    check(noAttendance > 0, "directory no-attendance fixture remains valid");
  } finally {
    if (actorId > 0) {
      await updateOrganizationAttendanceSettings({
        officeTimezone: originalOrganization.officeTimezone,
        officeLatitude: originalOrganization.officeLatitude,
        officeLongitude: originalOrganization.officeLongitude,
        allowedRadiusMeters: originalOrganization.allowedRadiusMeters,
      }, actorId, null).catch(() => undefined);
      await pool.execute(
        `DELETE FROM audit_logs
         WHERE id > ? AND user_id = ?
           AND entity_type IN ('employee_attendance_settings', 'organization_attendance_settings')`,
        [baselineAuditId, actorId],
      );
    }
    if (employeeIds.length) {
      await pool.query(`DELETE b FROM attendance_breaks b JOIN attendance_sessions s ON s.id = b.attendance_session_id WHERE s.employee_id IN (?)`, [employeeIds]);
      await pool.query("DELETE FROM attendance_sessions WHERE employee_id IN (?)", [employeeIds]);
      await pool.query("DELETE FROM leave_requests WHERE employee_id IN (?)", [employeeIds]);
      await pool.query("DELETE FROM employee_attendance_settings WHERE employee_id IN (?)", [employeeIds]);
      await pool.query("DELETE FROM employees WHERE id IN (?)", [employeeIds]);
    }
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
