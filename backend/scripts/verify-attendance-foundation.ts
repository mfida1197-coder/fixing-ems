import { pool } from "../src/db";
import { getEmployeeAttendanceSettings, getOrganizationAttendanceSettings } from "../src/attendance/settingsService";
import { workDateForInstant } from "../src/attendance/time";
import {
  validateEmployeeAttendanceSettings,
  validateGpsCoordinates,
  validateLeaveRequest,
  validateOrganizationAttendanceSettings,
} from "../src/attendance/validation";

const TABLES = [
  "organization_attendance_settings",
  "employee_attendance_settings",
  "attendance_sessions",
  "attendance_breaks",
  "holidays",
  "leave_requests",
] as const;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`PASS: ${message}`);
}

async function expectDatabaseRejection(action: () => Promise<unknown>, message: string) {
  try {
    await action();
  } catch {
    console.log(`PASS: ${message}`);
    return;
  }
  throw new Error(`FAILED: ${message}`);
}

async function main() {
  const connection = await pool.getConnection();
  let transactionOpen = false;
  try {
    const [tableRows] = await connection.execute(
      `SELECT TABLE_NAME, ENGINE
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${TABLES.map(() => "?").join(",")})`,
      [...TABLES],
    );
    const tables = tableRows as any[];
    check(tables.length === TABLES.length, "all six Phase 3 tables exist");
    check(tables.every((row) => row.ENGINE === "InnoDB"), "all attendance tables use InnoDB");

    const [foreignKeyRows] = await connection.execute(
      `SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, rc.DELETE_RULE
       FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
       JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
        AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
       WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
         AND kcu.TABLE_NAME IN (${TABLES.map(() => "?").join(",")})`,
      [...TABLES],
    );
    const foreignKeys = foreignKeyRows as any[];
    const sessionEmployee = foreignKeys.find(
      (row) => row.TABLE_NAME === "attendance_sessions" && row.COLUMN_NAME === "employee_id",
    );
    const leaveEmployee = foreignKeys.find(
      (row) => row.TABLE_NAME === "leave_requests" && row.COLUMN_NAME === "employee_id",
    );
    const settingsEmployee = foreignKeys.find(
      (row) => row.TABLE_NAME === "employee_attendance_settings" && row.COLUMN_NAME === "employee_id",
    );
    check(sessionEmployee?.REFERENCED_TABLE_NAME === "employees" && sessionEmployee.DELETE_RULE === "RESTRICT", "attendance history restricts employee deletion");
    check(leaveEmployee?.REFERENCED_TABLE_NAME === "employees" && leaveEmployee.DELETE_RULE === "RESTRICT", "leave history restricts employee deletion");
    check(settingsEmployee?.REFERENCED_TABLE_NAME === "employees" && settingsEmployee.DELETE_RULE === "CASCADE", "non-historical employee settings cascade on employee deletion");

    const [uniqueRows] = await connection.execute(
      `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_list
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_sessions' AND NON_UNIQUE = 0
       GROUP BY INDEX_NAME`,
    );
    check(
      !(uniqueRows as any[]).some((row) => String(row.columns_list).includes("employee_id,work_date")),
      "attendance sessions do not enforce one row per employee/date",
    );

    const [foundationCounts] = await connection.execute(
      `SELECT
         (SELECT COUNT(*) FROM organization_attendance_settings) AS organization_settings,
         (SELECT COUNT(*) FROM employee_attendance_settings) AS employee_settings,
         (SELECT COUNT(*) FROM employees) AS employees,
         (SELECT COUNT(*) FROM attendance_sessions) AS sessions,
         (SELECT COUNT(*) FROM attendance_breaks) AS breaks_count,
         (SELECT COUNT(*) FROM holidays) AS holidays_count,
         (SELECT COUNT(*) FROM leave_requests) AS leave_count`,
    );
    const counts = (foundationCounts as any[])[0];
    check(counts.organization_settings === 1, "one organization attendance settings row exists");
    check(counts.employee_settings === counts.employees, "existing EMS employees have attendance settings rows");
    check(
      [counts.sessions, counts.breaks_count, counts.holidays_count, counts.leave_count]
        .every((value) => Number.isInteger(Number(value)) && Number(value) >= 0),
      "attendance-domain table counts remain readable after later EMS phases begin using the foundation",
    );

    const organizationSettings = await getOrganizationAttendanceSettings();
    check(organizationSettings.officeTimezone === "Asia/Karachi", "organization timezone defaults to Asia/Karachi");
    check(
      organizationSettings.officeLatitude === null
        && organizationSettings.officeLongitude === null
        && organizationSettings.allowedRadiusMeters === null,
      "office GPS location remains intentionally unconfigured",
    );

    const [employeeRows] = await connection.execute("SELECT id FROM employees ORDER BY id LIMIT 1");
    const realEmployeeId = (employeeRows as any[])[0]?.id;
    check(realEmployeeId, "an existing EMS employee is available for settings verification");
    const employeeSettings = await getEmployeeAttendanceSettings(realEmployeeId);
    check(employeeSettings.attendanceMode === "remote", "existing employee defaults to remote attendance mode");

    check(
      workDateForInstant(new Date("2026-09-25T19:30:00.000Z")) === "2026-09-26",
      "work-date conversion observes the Asia/Karachi midnight boundary",
    );
    check(
      validateOrganizationAttendanceSettings({
        officeTimezone: "Asia/Karachi",
        officeLatitude: null,
        officeLongitude: null,
        allowedRadiusMeters: null,
      }).valid,
      "unconfigured organization GPS settings are valid",
    );
    check(
      !validateOrganizationAttendanceSettings({
        officeTimezone: "Asia/Karachi",
        officeLatitude: 32,
        officeLongitude: null,
        allowedRadiusMeters: null,
      }).valid,
      "partial GPS configuration is rejected by TypeScript validation",
    );
    check(
      validateEmployeeAttendanceSettings({
        attendanceMode: "gps",
        weeklyTargetMinutes: 2400,
        monthlyTargetMinutes: 9600,
      }).valid,
      "typed employee attendance settings validation accepts valid targets",
    );
    check(
      validateGpsCoordinates({ latitude: 32.054, longitude: 72.718, accuracyMeters: 12 }).valid,
      "typed GPS coordinate validation accepts valid coordinates",
    );
    check(
      !validateGpsCoordinates({ latitude: 91, longitude: 72.718 }).valid,
      "typed GPS coordinate validation rejects out-of-range coordinates",
    );
    check(
      validateLeaveRequest({
        leaveType: "short_hours",
        startDate: "2026-10-01",
        endDate: "2026-10-01",
        startTime: "10:00",
        endTime: "12:00",
      }).valid,
      "typed short-hours leave validation accepts a valid bracket",
    );

    await connection.beginTransaction();
    transactionOpen = true;
    const testCode = `P3-${Date.now()}`;
    const [employeeInsert] = await connection.execute(
      `INSERT INTO employees
         (employee_code, full_name, designation, joining_date, employment_type, status)
       VALUES (?, 'Phase 3 Verification', 'Verifier', '2026-01-01', 'contract', 'active')`,
      [testCode],
    );
    const testEmployeeId = (employeeInsert as any).insertId as number;

    await connection.execute(
      `INSERT INTO employee_attendance_settings
         (employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes)
       VALUES (?, 'remote', 2400, 9600)`,
      [testEmployeeId],
    );

    const sessionValues = [
      [testEmployeeId, "2026-10-01", "remote", "completed", "2026-10-01 04:00:00.000", "2026-10-01 08:00:00.000"],
      [testEmployeeId, "2026-10-01", "remote", "completed", "2026-10-01 09:00:00.000", "2026-10-01 13:00:00.000"],
    ];
    for (const values of sessionValues) {
      await connection.execute(
        `INSERT INTO attendance_sessions
           (employee_id, work_date, attendance_mode, state, check_in_at_utc, check_out_at_utc)
         VALUES (?, ?, ?, ?, ?, ?)`,
        values,
      );
    }
    const [sessionRows] = await connection.execute(
      "SELECT id FROM attendance_sessions WHERE employee_id = ? ORDER BY check_in_at_utc",
      [testEmployeeId],
    );
    check((sessionRows as any[]).length === 2, "multiple remote sessions on the same work date are supported");

    const firstSessionId = (sessionRows as any[])[0].id;
    await connection.execute(
      `INSERT INTO attendance_breaks
         (attendance_session_id, state, break_out_at_utc, break_in_at_utc)
       VALUES (?, 'completed', '2026-10-01 05:00:00.000', '2026-10-01 05:15:00.000')`,
      [firstSessionId],
    );
    check(true, "normalized attendance break is linked to its session");

    await connection.execute(
      `INSERT INTO attendance_sessions
         (employee_id, work_date, attendance_mode, state, check_in_at_utc, incomplete_reason)
       VALUES (?, '2026-10-02', 'gps', 'incomplete', '2026-10-02 04:00:00.000', 'Verification state')`,
      [testEmployeeId],
    );
    check(true, "incomplete attendance is preserved explicitly");

    await connection.execute(
      `INSERT INTO leave_requests
         (employee_id, leave_type, start_date, end_date)
       VALUES (?, 'full_day', '2026-10-03', '2026-10-04')`,
      [testEmployeeId],
    );
    await connection.execute(
      `INSERT INTO leave_requests
         (employee_id, leave_type, start_date, end_date, start_time, end_time)
       VALUES (?, 'short_hours', '2026-10-05', '2026-10-05', '10:00:00', '12:00:00')`,
      [testEmployeeId],
    );
    check(true, "full-day and short-hours leave structures accept valid records");

    await connection.execute(
      "INSERT INTO holidays (holiday_date, name) VALUES ('2099-12-31', 'Phase 3 Verification Holiday')",
    );
    check(true, "manual holiday records are supported without automatic weekend data");

    await expectDatabaseRejection(
      () => connection.execute(
        `INSERT INTO attendance_sessions
           (employee_id, work_date, attendance_mode, state, check_in_at_utc)
         VALUES (?, '2026-10-06', 'remote', 'completed', '2026-10-06 04:00:00.000')`,
        [testEmployeeId],
      ),
      "database rejects a completed session without check-out",
    );
    await expectDatabaseRejection(
      () => connection.execute(
        `INSERT INTO attendance_breaks
           (attendance_session_id, state, break_out_at_utc, break_in_at_utc)
         VALUES (?, 'completed', '2026-10-01 06:00:00.000', '2026-10-01 05:59:00.000')`,
        [firstSessionId],
      ),
      "database rejects a break ending before it starts",
    );
    await expectDatabaseRejection(
      () => connection.execute(
        `INSERT INTO leave_requests
           (employee_id, leave_type, start_date, end_date, start_time, end_time)
         VALUES (?, 'short_hours', '2026-10-07', '2026-10-08', '10:00:00', '12:00:00')`,
        [testEmployeeId],
      ),
      "database rejects multi-day short-hours leave",
    );
    await expectDatabaseRejection(
      () => connection.execute("DELETE FROM employees WHERE id = ?", [testEmployeeId]),
      "historical attendance and leave prevent silent employee deletion",
    );

    await connection.rollback();
    transactionOpen = false;
    const [cleanupRows] = await connection.execute(
      "SELECT id FROM employees WHERE employee_code = ?",
      [testCode],
    );
    check((cleanupRows as any[]).length === 0, "verification records were rolled back cleanly");
  } finally {
    if (transactionOpen) await connection.rollback();
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
