import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { AttendanceEmployeeAdminService } from "../src/attendance/employeeAdminService";
import { AttendanceService } from "../src/attendance/attendanceService";
import { AttendanceAnalyticsService } from "../src/attendance/analyticsService";
import { finalizeAttendanceStatusRange } from "../src/attendance/finalization";
import { pool } from "../src/db";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`PASS: ${message}`);
}

async function main() {
  const now = new Date("2099-05-12T07:00:00.000Z");
  const pastDate = "2099-05-10";
  const holidayDate = "2099-05-11";
  const today = "2099-05-12";
  const futureDate = "2099-05-13";
  const suffix = Date.now();
  const employeeIds: number[] = [];
  let holidayId: number | null = null;
  try {
    for (const name of ["No attendance", "Forgot checkout", "Completed", "On leave", "Open today"]) {
      const [result] = await pool.execute<ResultSetHeader>(
        `INSERT INTO employees (employee_code, full_name, designation, joining_date, employment_type, status)
         VALUES (?, ?, 'Attendance verifier', '2099-01-01', 'contract', 'active')`,
        [`P10-${employeeIds.length}-${suffix}`, name],
      );
      employeeIds.push(result.insertId);
      await pool.execute(
        "INSERT INTO employee_attendance_settings (employee_id, attendance_mode) VALUES (?, 'remote')",
        [result.insertId],
      );
    }
    const [, incomplete, completed, leaveEmployee, openToday] = employeeIds;
    await pool.execute(
      `INSERT INTO attendance_sessions (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc)
       VALUES (?, ?, 'Asia/Karachi', 'remote', 'open', '2099-05-10 04:00:00.000')`,
      [incomplete, pastDate],
    );
    await pool.execute(
      `INSERT INTO attendance_sessions (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc, check_out_at_utc)
       VALUES (?, ?, 'Asia/Karachi', 'remote', 'completed', '2099-05-10 04:00:00.000', '2099-05-10 12:00:00.000')`,
      [completed, pastDate],
    );
    await pool.execute(
      `INSERT INTO attendance_sessions (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc, check_out_at_utc)
       VALUES (?, ?, 'Asia/Karachi', 'remote', 'completed', '2099-05-12 04:00:00.000', '2099-05-12 06:00:00.000')`,
      [completed, today],
    );
    await pool.execute(
      `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, status)
       VALUES (?, 'full_day', ?, ?, 'approved')`,
      [leaveEmployee, pastDate, pastDate],
    );
    await pool.execute(
      `INSERT INTO attendance_sessions (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc)
       VALUES (?, ?, 'Asia/Karachi', 'remote', 'open', '2099-05-12 04:00:00.000')`,
      [openToday, today],
    );
    const [holiday] = await pool.execute<ResultSetHeader>(
      "INSERT INTO holidays (holiday_date, name) VALUES (?, 'Attendance status verifier holiday')",
      [holidayDate],
    );
    holidayId = holiday.insertId;

    await finalizeAttendanceStatusRange(pool, pastDate, holidayDate, now);
    const [stored] = await pool.query<RowDataPacket[]>(
      "SELECT employee_id, work_date, status FROM attendance_day_statuses WHERE employee_id IN (?) AND work_date = ?",
      [employeeIds, pastDate],
    );
    const storedStatus = new Map(stored.map((row) => [Number(row.employee_id), String(row.status)]));
    check(storedStatus.get(employeeIds[0]) === "absent", "past date without a check-in persists absent");
    check(storedStatus.get(incomplete) === "absent", "forgotten checkout persists absent in the database");
    check(storedStatus.get(completed) === "present", "completed past attendance persists present");
    check(storedStatus.get(leaveEmployee) === "leave", "approved full-day leave persists leave instead of absent");
    const [incompleteRows] = await pool.execute<RowDataPacket[]>(
      "SELECT state, check_in_at_utc, check_out_at_utc FROM attendance_sessions WHERE employee_id = ? AND work_date = ?",
      [incomplete, pastDate],
    );
    check(incompleteRows[0]?.state === "incomplete" && incompleteRows[0]?.check_in_at_utc && incompleteRows[0]?.check_out_at_utc === null,
      "forgotten checkout preserves check-in evidence without fabricating checkout");

    const directory = await new AttendanceEmployeeAdminService(pool, () => new Date(now)).getDirectory(pastDate);
    const states = new Map(directory.employees.map((employee) => [employee.employeeId, employee.attendanceState]));
    check(states.get(employeeIds[0]) === "absent" && states.get(incomplete) === "absent", "directory emits persisted absent status for missing and incomplete past attendance");
    check(states.get(completed) === "present" && states.get(leaveEmployee) === "leave", "directory preserves present and leave statuses");
    const dashboard = await new AttendanceAnalyticsService(pool, () => new Date(now)).getDashboard(pastDate, 7);
    const activeAbsentCount = directory.employees.filter((employee) => employee.employmentStatus === "active" && employee.attendanceState === "absent").length;
    check(dashboard.kpis.todayAbsent === activeAbsentCount, "selected-date Absent KPI count agrees with the directory filter");

    const service = new AttendanceService(pool, () => new Date(now));
    const todayCalendar = await service.getCalendar(openToday, today, today, now);
    const noCheckInTodayCalendar = await service.getCalendar(employeeIds[0], today, today, now);
    const futureCalendar = await service.getCalendar(employeeIds[0], futureDate, futureDate, now);
    const holidayCalendar = await service.getCalendar(employeeIds[0], holidayDate, holidayDate, now);
    check(todayCalendar[0]?.status === "pending", "today's open attendance is not prematurely absent");
    check(noCheckInTodayCalendar[0]?.status === "absent", "today without any check-in is absent");
    const todayDirectory = await new AttendanceEmployeeAdminService(pool, () => new Date(now)).getDirectory(today);
    const todayAbsentCount = todayDirectory.employees.filter((employee) => employee.employmentStatus === "active" && employee.attendanceState === "absent").length;
    const todayDashboard = await new AttendanceAnalyticsService(pool, () => new Date(now)).getDashboard(today, 7);
    check(todayDashboard.kpis.totalEmployees >= 5 && todayDashboard.kpis.todayPresent >= 1, "today dashboard counts active employees and completed attendance");
    check(todayDashboard.kpis.todayAbsent === todayAbsentCount && todayAbsentCount >= 3, "today Absent KPI includes active employees with no check-in and matches the directory");
    check(futureCalendar[0]?.status === "future", "future dates are never absent");
    check(holidayCalendar[0]?.status === "holiday", "configured holiday remains holiday instead of absent");
  } finally {
    if (employeeIds.length > 0) {
      await pool.query("DELETE FROM attendance_day_statuses WHERE employee_id IN (?)", [employeeIds]);
      await pool.query(`DELETE b FROM attendance_breaks b JOIN attendance_sessions s ON s.id = b.attendance_session_id WHERE s.employee_id IN (?)`, [employeeIds]);
      await pool.query("DELETE FROM attendance_sessions WHERE employee_id IN (?)", [employeeIds]);
      await pool.query("DELETE FROM leave_requests WHERE employee_id IN (?)", [employeeIds]);
      await pool.query("DELETE FROM employee_attendance_settings WHERE employee_id IN (?)", [employeeIds]);
      await pool.query("DELETE FROM employees WHERE id IN (?)", [employeeIds]);
    }
    if (holidayId !== null) await pool.execute("DELETE FROM holidays WHERE id = ?", [holidayId]);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
