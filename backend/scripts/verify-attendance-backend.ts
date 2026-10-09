import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { AttendanceService } from "../src/attendance/attendanceService";
import { calculateGpsValidity } from "../src/attendance/calculations";
import { AttendanceError } from "../src/attendance/errors";
import { workDateForInstant } from "../src/attendance/time";
import { pool } from "../src/db";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`PASS: ${message}`);
}

async function expectCode(action: () => Promise<unknown>, code: string, message: string) {
  try {
    await action();
  } catch (error) {
    if (error instanceof AttendanceError && error.code === code) {
      console.log(`PASS: ${message}`);
      return;
    }
    throw error;
  }
  throw new Error(`FAILED: ${message} (expected ${code})`);
}

function fulfilledCount(results: PromiseSettledResult<unknown>[]) {
  return results.filter((result) => result.status === "fulfilled").length;
}

async function main() {
  let now = new Date("2098-10-05T03:00:00.000Z");
  const service = new AttendanceService(pool, () => new Date(now));
  const testCode = `P4-${Date.now()}`;
  let employeeId: number | null = null;
  let holidayId: number | null = null;
  let originalOrganization: {
    office_latitude: number | null;
    office_longitude: number | null;
    allowed_radius_meters: number | null;
  } | null = null;

  try {
    const connection = await pool.getConnection();
    try {
      const [organizationRows] = await connection.execute<RowDataPacket[]>(
        `SELECT office_latitude, office_longitude, allowed_radius_meters
         FROM organization_attendance_settings WHERE id = 1`,
      );
      originalOrganization = {
        office_latitude: organizationRows[0].office_latitude,
        office_longitude: organizationRows[0].office_longitude,
        allowed_radius_meters: organizationRows[0].allowed_radius_meters,
      };
      const [employeeInsert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO employees
           (employee_code, full_name, designation, joining_date, employment_type, status)
         VALUES (?, 'Phase 4 Verification', 'Verifier', '2098-01-01', 'contract', 'active')`,
        [testCode],
      );
      employeeId = employeeInsert.insertId;
      await connection.execute(
        `INSERT INTO employee_attendance_settings
           (employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes)
         VALUES (?, 'remote', 2400, 9600)`,
        [employeeId],
      );
    } finally {
      connection.release();
    }

    const id = employeeId!;

    const first = await service.checkIn(id);
    check(first.session.workDate === "2098-10-05", "remote first check-in uses the Karachi work date");
    check(first.gps === null, "remote attendance does not require GPS");
    await expectCode(() => service.checkIn(id), "ALREADY_CHECKED_IN", "duplicate check-in is rejected");

    now = new Date("2098-10-05T04:00:00.000Z");
    await expectCode(() => service.breakIn(id), "NOT_ON_BREAK", "break-in without an open break is rejected");
    await service.breakOut(id);
    await expectCode(() => service.breakOut(id), "ALREADY_ON_BREAK", "duplicate break-out is rejected");
    await expectCode(() => service.checkOut(id), "ACTIVE_BREAK_MUST_END", "check-out with an open break is rejected");
    now = new Date("2098-10-05T04:15:00.000Z");
    await service.breakIn(id);
    now = new Date("2098-10-05T05:00:00.000Z");
    await service.breakOut(id);
    now = new Date("2098-10-05T05:30:00.000Z");
    await service.breakIn(id);
    now = new Date("2098-10-05T07:00:00.000Z");
    const firstCheckout = await service.checkOut(id);
    check(firstCheckout.session.breaks.length === 2, "multiple normalized breaks are retained on one session");
    await expectCode(() => service.checkOut(id), "NO_ACTIVE_SESSION", "check-out without an open session is rejected");
    await expectCode(() => service.breakOut(id), "NO_ACTIVE_SESSION", "break-out without an open session is rejected");

    now = new Date("2098-10-05T08:00:00.000Z");
    await service.checkIn(id);
    now = new Date("2098-10-05T10:00:00.000Z");
    await service.checkOut(id);
    const firstDay = await service.getHistory(id, "2098-10-05", "2098-10-05", now);
    check(firstDay.days[0].sessions.length === 2, "same-day remote sessions remain separate");
    check(firstDay.days[0].completedSessionCount === 2, "daily aggregation includes both completed sessions");
    check(firstDay.days[0].totalCompletedBreakSeconds === 2700, "completed break durations aggregate consistently");
    check(firstDay.days[0].totalWorkedSeconds === 18900, "daily worked time subtracts all completed breaks");

    const office = { latitude: 31.5204, longitude: 74.3587, radiusMeters: 100 };
    const boundaryLatitude = office.latitude + (100 / 6_371_000) * (180 / Math.PI);
    check(
      calculateGpsValidity({ latitude: boundaryLatitude, longitude: office.longitude }, office).withinAllowedRadius,
      "GPS exact-radius floating-point boundary is accepted",
    );
    check(
      !calculateGpsValidity(
        { latitude: office.latitude + (100.1 / 6_371_000) * (180 / Math.PI), longitude: office.longitude },
        office,
      ).withinAllowedRadius,
      "GPS point just outside the radius is rejected",
    );

    const setup = await pool.getConnection();
    try {
      await setup.execute(
        `UPDATE employee_attendance_settings SET attendance_mode = 'gps' WHERE employee_id = ?`,
        [id],
      );
      await setup.execute(
        `UPDATE organization_attendance_settings
         SET office_latitude = NULL, office_longitude = NULL, allowed_radius_meters = NULL WHERE id = 1`,
      );
    } finally {
      setup.release();
    }
    now = new Date("2098-10-06T03:00:00.000Z");
    await expectCode(
      () => service.checkIn(id, { latitude: office.latitude, longitude: office.longitude }),
      "ATTENDANCE_GPS_NOT_CONFIGURED",
      "GPS attendance fails safely when office configuration is missing",
    );
    await expectCode(
      () => service.checkIn(id, { latitude: 91, longitude: office.longitude }),
      "INVALID_GPS_COORDINATES",
      "invalid GPS coordinates are rejected",
    );
    await pool.execute(
      `UPDATE organization_attendance_settings
       SET office_latitude = ?, office_longitude = ?, allowed_radius_meters = ? WHERE id = 1`,
      [office.latitude, office.longitude, office.radiusMeters],
    );
    await expectCode(
      () => service.checkIn(id, { latitude: office.latitude + 0.01, longitude: office.longitude }),
      "OUTSIDE_ALLOWED_GPS_RADIUS",
      "GPS attendance outside the configured radius is rejected",
    );
    const gpsCheckIn = await service.checkIn(id, {
      latitude: boundaryLatitude,
      longitude: office.longitude,
      accuracyMeters: 5,
    });
    check(gpsCheckIn.gps?.validated, "GPS check-in is validated server-side at the configured boundary");
    now = new Date("2098-10-06T04:00:00.000Z");
    await service.checkOut(id, { latitude: office.latitude, longitude: office.longitude });
    await expectCode(
      () => service.checkIn(id, { latitude: office.latitude, longitude: office.longitude }),
      "ATTENDANCE_ALREADY_RECORDED_FOR_DATE",
      "GPS/office mode prevents a second session on the same work date",
    );

    await pool.execute(
      `UPDATE employee_attendance_settings SET attendance_mode = 'remote' WHERE employee_id = ?`,
      [id],
    );
    now = new Date("2098-10-07T03:00:00.000Z");
    const concurrentCheckIns = await Promise.allSettled([service.checkIn(id), service.checkIn(id)]);
    check(fulfilledCount(concurrentCheckIns) === 1, "simultaneous check-in requests produce exactly one session");
    await expectCode(() => service.breakIn(id), "NOT_ON_BREAK", "active session still rejects break-in before break-out");
    now = new Date("2098-10-07T04:00:00.000Z");
    const concurrentBreakOuts = await Promise.allSettled([service.breakOut(id), service.breakOut(id)]);
    check(fulfilledCount(concurrentBreakOuts) === 1, "simultaneous break-out requests produce exactly one open break");
    await service.breakIn(id);
    now = new Date("2098-10-07T05:00:00.000Z");
    const concurrentCheckOuts = await Promise.allSettled([service.checkOut(id), service.checkOut(id)]);
    check(fulfilledCount(concurrentCheckOuts) === 1, "simultaneous check-out requests complete a session exactly once");

    now = new Date("2098-10-08T18:30:00.000Z");
    const crossMidnightCheckIn = await service.checkIn(id);
    check(crossMidnightCheckIn.session.workDate === "2098-10-08", "session before Karachi midnight gets the intended work date");
    now = new Date("2098-10-08T20:00:00.000Z");
    const crossMidnightCheckout = await service.checkOut(id);
    check(
      crossMidnightCheckout.session.workDate === "2098-10-08"
        && crossMidnightCheckout.session.checkOutAtUtc?.toISOString() === "2098-10-08T20:00:00.000Z",
      "cross-midnight session remains coherent on its check-in work date",
    );
    check(
      workDateForInstant(new Date("2098-10-08T18:59:59.999Z")) === "2098-10-08"
        && workDateForInstant(new Date("2098-10-08T19:00:00.000Z")) === "2098-10-09",
      "Karachi midnight boundary is exact",
    );

    const unresolved = await pool.execute<ResultSetHeader>(
      `INSERT INTO attendance_sessions
         (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc)
       VALUES (?, '2098-10-09', 'Asia/Karachi', 'remote', 'open', '2098-10-09 03:00:00.000')`,
      [id],
    );
    const unresolvedSessionId = unresolved[0].insertId;
    await pool.execute(
      `INSERT INTO attendance_breaks
         (attendance_session_id, state, break_out_at_utc, incomplete_reason)
       VALUES (?, 'incomplete', '2098-10-09 04:00:00.000', 'Verification preserves incomplete break')`,
      [unresolvedSessionId],
    );
    now = new Date("2098-10-10T03:00:00.000Z");
    await expectCode(
      () => service.checkIn(id),
      "UNRESOLVED_PREVIOUS_SESSION",
      "old open session blocks a new session with a clear non-destructive error",
    );
    await expectCode(
      () => service.breakOut(id),
      "UNRESOLVED_INCOMPLETE_BREAK",
      "incomplete break blocks further transitions with a clear non-destructive error",
    );
    const [preservedOpen] = await pool.execute<RowDataPacket[]>(
      `SELECT s.state, COUNT(b.id) AS break_count
       FROM attendance_sessions s LEFT JOIN attendance_breaks b ON b.attendance_session_id = s.id
       WHERE s.id = ? GROUP BY s.id, s.state`,
      [unresolvedSessionId],
    );
    check(
      preservedOpen[0]?.state === "open" && Number(preservedOpen[0]?.break_count) === 1,
      "old open session and incomplete break remain preserved",
    );
    await pool.execute("DELETE FROM attendance_breaks WHERE attendance_session_id = ?", [unresolvedSessionId]);
    await pool.execute("DELETE FROM attendance_sessions WHERE id = ?", [unresolvedSessionId]);

    const [incompleteInsert] = await pool.execute<ResultSetHeader>(
      `INSERT INTO attendance_sessions
         (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc, incomplete_reason)
       VALUES (?, '2098-10-09', 'Asia/Karachi', 'remote', 'incomplete',
               '2098-10-09 05:00:00.000', 'Verification incomplete session')`,
      [id],
    );
    await expectCode(
      () => service.checkIn(id),
      "UNRESOLVED_INCOMPLETE_SESSION",
      "incomplete session blocks ambiguous new check-in without deleting history",
    );
    const [incompleteRows] = await pool.execute<RowDataPacket[]>(
      "SELECT state FROM attendance_sessions WHERE id = ?",
      [incompleteInsert.insertId],
    );
    check(incompleteRows[0]?.state === "incomplete", "incomplete session remains preserved");

    const [holidayInsert] = await pool.execute<ResultSetHeader>(
      "INSERT INTO holidays (holiday_date, name) VALUES ('2098-10-03', 'Phase 4 Verification Holiday')",
    );
    holidayId = holidayInsert.insertId;
    await pool.execute(
      `INSERT INTO leave_requests
         (employee_id, leave_type, start_date, end_date, status)
       VALUES (?, 'full_day', '2098-10-04', '2098-10-04', 'approved')`,
      [id],
    );
    await pool.execute(
      `INSERT INTO leave_requests
         (employee_id, leave_type, start_date, end_date, start_time, end_time, status)
       VALUES (?, 'short_hours', '2098-10-06', '2098-10-06', '10:00:00', '11:00:00', 'approved')`,
      [id],
    );

    const summary = await service.getSummary(id, "2098-10-07", now);
    check(summary.weekly.workedSeconds > 0 && summary.monthly.workedSeconds > 0, "weekly and monthly summaries aggregate session work");
    check(summary.weekly.target.progressPercent !== null, "configured weekly target produces finite progress");
    check(
      summary.weekly.approvedShortLeaveSeconds === 3600 && !summary.weekly.shortLeaveAffectsWorkedTime,
      "approved short leave is represented but does not alter worked time",
    );
    await pool.execute(
      `UPDATE employee_attendance_settings
       SET weekly_target_minutes = 0, monthly_target_minutes = 0 WHERE employee_id = ?`,
      [id],
    );
    const zeroTargets = await service.getSummary(id, "2098-10-07", now);
    check(
      zeroTargets.weekly.target.progressPercent === null
        && zeroTargets.monthly.target.progressPercent === null
        && !zeroTargets.weekly.target.targetConfigured,
      "zero weekly/monthly targets are safe and never produce NaN or division by zero",
    );

    const calendar = await service.getCalendar(id, "2098-09-27", "2098-10-12", now);
    const status = (date: string) => calendar.find((day) => day.date === date)?.status;
    check(status("2098-10-05") === "present", "calendar derives present from attendance sessions");
    check(status("2098-09-27") === "absent", "past weekend is not automatically treated as a holiday");
    check(status("2098-10-03") === "holiday", "configured holiday has calendar precedence");
    check(status("2098-10-04") === "leave", "approved full-day leave is represented instead of absence");
    check(status("2098-10-06") === "short_leave", "approved short-hour leave is represented explicitly");
    check(status("2098-10-09") === "incomplete", "incomplete attendance is visible in calendar status");
    check(status("2098-10-12") === "future", "future work dates are not marked absent");

    const [openConstraintRows] = await pool.execute<RowDataPacket[]>(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND INDEX_NAME IN ('uq_attendance_one_open_session', 'uq_attendance_one_open_break')`,
    );
    check(openConstraintRows.length === 2, "database uniqueness constraints protect both open state transitions");
  } finally {
    if (employeeId !== null) {
      const cleanup = await pool.getConnection();
      try {
        await cleanup.beginTransaction();
        await cleanup.execute(
          `DELETE b FROM attendance_breaks b
           JOIN attendance_sessions s ON s.id = b.attendance_session_id
           WHERE s.employee_id = ?`,
          [employeeId],
        );
        await cleanup.execute("DELETE FROM attendance_sessions WHERE employee_id = ?", [employeeId]);
        await cleanup.execute("DELETE FROM leave_requests WHERE employee_id = ?", [employeeId]);
        await cleanup.execute("DELETE FROM employee_attendance_settings WHERE employee_id = ?", [employeeId]);
        await cleanup.execute("DELETE FROM employees WHERE id = ?", [employeeId]);
        if (holidayId !== null) await cleanup.execute("DELETE FROM holidays WHERE id = ?", [holidayId]);
        if (originalOrganization) {
          await cleanup.execute(
            `UPDATE organization_attendance_settings
             SET office_latitude = ?, office_longitude = ?, allowed_radius_meters = ? WHERE id = 1`,
            [
              originalOrganization.office_latitude,
              originalOrganization.office_longitude,
              originalOrganization.allowed_radius_meters,
            ],
          );
        }
        await cleanup.commit();
      } catch (error) {
        await cleanup.rollback();
        throw error;
      } finally {
        cleanup.release();
      }
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
