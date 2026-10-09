import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { AttendanceAnalyticsService } from "../src/attendance/analyticsService";
import { pool } from "../src/db";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`PASS: ${message}`);
}

async function main() {
  const now = new Date("2095-06-20T07:00:00.000Z");
  const service = new AttendanceAnalyticsService(pool, () => new Date(now));
  const suffix = Date.now();
  const employeeIds: number[] = [];
  let holidayId: number | null = null;

  try {
    const baseline = await service.getDashboard("2095-06-20", 7);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const [index, name, mode] of [
        ["A", "Phase 7 GPS", "gps"],
        ["B", "Phase 7 Remote", "remote"],
        ["C", "Phase 7 Absent", "remote"],
        ["D", "Phase 7 Leave", "remote"],
        ["E", "Phase 7 Incomplete", "remote"],
      ] as const) {
        const [insert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO employees
             (employee_code, full_name, designation, joining_date, employment_type, status)
           VALUES (?, ?, 'Analytics Verifier', '2095-01-01', 'contract', 'active')`,
          [`P7-${index}-${suffix}`, name],
        );
        employeeIds.push(insert.insertId);
        await connection.execute(
          `INSERT INTO employee_attendance_settings
             (employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes)
           VALUES (?, ?, 0, 0)`,
          [insert.insertId, mode],
        );
      }
      const [gps, remote, , leaveEmployee, incomplete] = employeeIds;
      const [gpsSession] = await connection.execute<ResultSetHeader>(
        `INSERT INTO attendance_sessions
           (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc, check_out_at_utc)
         VALUES (?, '2095-06-20', 'Asia/Karachi', 'gps', 'completed',
                 '2095-06-20 04:00:00.000', '2095-06-20 12:00:00.000')`,
        [gps],
      );
      for (const [outAt, inAt] of [
        ["2095-06-20 06:00:00.000", "2095-06-20 06:20:00.000"],
        ["2095-06-20 08:30:00.000", "2095-06-20 09:00:00.000"],
        ["2095-06-20 10:45:00.000", "2095-06-20 11:00:00.000"],
      ]) {
        await connection.execute(
          `INSERT INTO attendance_breaks
             (attendance_session_id, state, break_out_at_utc, break_in_at_utc)
           VALUES (?, 'completed', ?, ?)`,
          [gpsSession.insertId, outAt, inAt],
        );
      }
      for (const [checkIn, checkOut] of [
        ["2095-06-20 04:00:00.000", "2095-06-20 06:30:00.000"],
        ["2095-06-20 07:15:00.000", "2095-06-20 09:45:00.000"],
        ["2095-06-20 10:10:00.000", "2095-06-20 12:30:00.000"],
      ]) {
        await connection.execute(
          `INSERT INTO attendance_sessions
             (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc, check_out_at_utc)
           VALUES (?, '2095-06-20', 'Asia/Karachi', 'remote', 'completed', ?, ?)`,
          [remote, checkIn, checkOut],
        );
      }
      await connection.execute(
        `INSERT INTO leave_requests
           (employee_id, leave_type, start_date, end_date, status)
         VALUES (?, 'full_day', '2095-06-20', '2095-06-20', 'approved')`,
        [leaveEmployee],
      );
      await connection.execute(
        `INSERT INTO leave_requests
           (employee_id, leave_type, start_date, end_date, status)
         VALUES (?, 'full_day', '2095-06-21', '2095-06-21', 'pending')`,
        [employeeIds[2]],
      );
      await connection.execute(
        `INSERT INTO attendance_sessions
           (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc, incomplete_reason)
         VALUES (?, '2095-06-20', 'Asia/Karachi', 'remote', 'incomplete',
                 '2095-06-20 04:30:00.000', 'Verification incomplete session')`,
        [incomplete],
      );
      const [holiday] = await connection.execute<ResultSetHeader>(
        "INSERT INTO holidays (holiday_date, name) VALUES ('2095-06-19', 'Phase 7 Verification Holiday')",
      );
      holidayId = holiday.insertId;
      await connection.commit();
    } finally {
      connection.release();
    }

    const result = await service.getDashboard("2095-06-20", 7);
    check(result.kpis.totalEmployees === baseline.kpis.totalEmployees + 5, "total employees counts active EMS employees once");
    check(result.kpis.todayPresent === baseline.kpis.todayPresent + 2, "GPS and remote employees each add one present employee despite four total sessions");
    check(result.kpis.todayAbsent === baseline.kpis.todayAbsent, "current-day no-data employees remain pending rather than becoming premature absences");
    check(result.kpis.pendingLeave === baseline.kpis.pendingLeave + 1, "pending leave KPI uses pending leave requests");

    const statusCount = (status: string) => result.teamStatus.statuses.find((item) => item.status === status)?.count ?? 0;
    const baselineStatus = (status: string) => baseline.teamStatus.statuses.find((item) => item.status === status)?.count ?? 0;
    check(statusCount("present") === baselineStatus("present") + 2, "remote sessions do not inflate Team Status present count");
    check(statusCount("leave") === baselineStatus("leave") + 1, "approved full-day leave is distinct from absence");
    check(statusCount("incomplete") === baselineStatus("incomplete") + 1, "incomplete attendance remains distinct");

    const nextDayService = new AttendanceAnalyticsService(pool, () => new Date("2095-06-21T07:00:00.000Z"));
    const pastDay = await nextDayService.getDashboard("2095-06-20", 7);
    const absent = pastDay.timeline.employees.find((employee) => employee.employeeCode.startsWith("P7-C-"));
    check(absent?.status === "absent", "employee without attendance, leave, or holiday becomes absent after the work date passes");

    const gps = result.timeline.employees.find((employee) => employee.employeeCode.startsWith("P7-A-"));
    const remote = result.timeline.employees.find((employee) => employee.employeeCode.startsWith("P7-B-"));
    const incompleteTimeline = result.timeline.employees.find((employee) => employee.employeeCode.startsWith("P7-E-"));
    check(gps?.sessions.length === 1, "GPS/office timeline contains one daily session");
    check(gps.sessions[0].breaks.length === 3 && gps.sessions[0].workingSegments.length === 4, "three GPS breaks produce four break-excluded working segments");
    check(gps.sessions[0].workedSeconds === 24_900, "GPS timeline uses break-adjusted backend worked time");
    check(remote?.sessions.length === 3, "remote timeline preserves three independent sessions");
    check(incompleteTimeline?.sessions[0].workingSegments.length === 0, "incomplete attendance does not invent an unverified worked interval");
    check(
      remote.sessions[0].workingSegments[0].endMinute < remote.sessions[1].workingSegments[0].startMinute
        && remote.sessions[1].workingSegments[0].endMinute < remote.sessions[2].workingSegments[0].startMinute,
      "remote timeline preserves gaps instead of drawing one continuous shift",
    );
    check(result.timeline.totalCheckIns >= 5 && result.timeline.totalCheckOuts >= 4, "timeline summary counts session events without employee-status duplication");

    const overviewToday = result.overview.buckets.find((bucket) => bucket.to === "2095-06-20");
    check(Boolean(overviewToday && overviewToday.present >= 2 && overviewToday.leave >= 1 && overviewToday.incomplete >= 1), "overview buckets contain backend status aggregates");
    const holiday = await service.getDashboard("2095-06-19", 7);
    const holidayCount = holiday.teamStatus.statuses.find((item) => item.status === "holiday")?.count;
    check(holidayCount === holiday.kpis.totalEmployees, "configured holiday applies consistently to the full active population");

    await pool.execute("UPDATE employees SET status = 'resigned' WHERE id = ?", [employeeIds[2]]);
    const inactiveExcluded = await service.getDashboard("2095-06-20", 7);
    check(inactiveExcluded.kpis.totalEmployees === result.kpis.totalEmployees - 1, "inactive employees are excluded from the attendance population");
  } finally {
    if (employeeIds.length) {
      await pool.query(
        `DELETE b FROM attendance_breaks b
         JOIN attendance_sessions s ON s.id = b.attendance_session_id
         WHERE s.employee_id IN (?)`,
        [employeeIds],
      );
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
