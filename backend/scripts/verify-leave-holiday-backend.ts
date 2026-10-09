import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { AttendanceService } from "../src/attendance/attendanceService";
import { HolidayService } from "../src/leave/holidayService";
import { LeaveManagementError } from "../src/leave/errors";
import { LeaveService } from "../src/leave/leaveService";
import { pool } from "../src/db";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`PASS: ${message}`);
}

async function expectCode(action: () => Promise<unknown>, code: string, message: string) {
  try {
    await action();
  } catch (error) {
    if (error instanceof LeaveManagementError && error.code === code) {
      console.log(`PASS: ${message}`);
      return;
    }
    throw error;
  }
  throw new Error(`FAILED: ${message} (expected ${code})`);
}

async function main() {
  const suffix = Date.now();
  const leave = new LeaveService(pool);
  const holidays = new HolidayService(pool);
  const attendance = new AttendanceService(pool, () => new Date("2097-06-15T07:00:00.000Z"));
  let employeeId: number | null = null;
  let reviewerEmployeeId: number | null = null;
  let employeeUserId: number | null = null;
  let reviewerUserId: number | null = null;
  const holidayIds: number[] = [];

  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [roleRows] = await connection.execute<RowDataPacket[]>(
        "SELECT id, name FROM roles WHERE name IN ('employee', 'admin')",
      );
      const role = (name: string) => Number(roleRows.find((row) => row.name === name)?.id);
      check(role("employee") > 0 && role("admin") > 0, "employee and admin roles exist");

      const [employeeInsert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO employees
           (employee_code, full_name, designation, joining_date, employment_type, status)
         VALUES (?, 'Phase 6 Employee', 'Verifier', '2097-01-01', 'contract', 'active')`,
        [`P6-E-${suffix}`],
      );
      employeeId = employeeInsert.insertId;
      const [reviewerInsert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO employees
           (employee_code, full_name, designation, joining_date, employment_type, status)
         VALUES (?, 'Phase 6 Reviewer', 'Administrator', '2097-01-01', 'contract', 'active')`,
        [`P6-A-${suffix}`],
      );
      reviewerEmployeeId = reviewerInsert.insertId;
      const placeholderHash = "$2b$10$123456789012345678901u12345678901234567890123456789012";
      const [employeeUserInsert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO users (role_id, full_name, email, employee_id, password_hash, is_active)
         VALUES (?, 'Phase 6 Employee', ?, ?, ?, TRUE)`,
        [role("employee"), `p6-employee-${suffix}@example.test`, employeeId, placeholderHash],
      );
      employeeUserId = employeeUserInsert.insertId;
      const [reviewerUserInsert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO users (role_id, full_name, email, employee_id, password_hash, is_active)
         VALUES (?, 'Phase 6 Reviewer', ?, ?, ?, TRUE)`,
        [role("admin"), `p6-reviewer-${suffix}@example.test`, reviewerEmployeeId, placeholderHash],
      );
      reviewerUserId = reviewerUserInsert.insertId;
      await connection.execute(
        `INSERT INTO employee_attendance_settings
           (employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes)
         VALUES (?, 'remote', 2400, 9600)`,
        [employeeId],
      );
      await connection.commit();
    } finally {
      connection.release();
    }

    const employee = employeeId!;
    const requester = employeeUserId!;
    const reviewer = reviewerUserId!;
    const pending = await leave.createOwnRequest(employee, requester, {
      leaveType: "full_day",
      startDate: "2097-06-07",
      endDate: "2097-06-07",
      reason: "Pending calendar verification",
    });
    check(pending.status === "pending" && pending.requestedBy === requester, "employee leave starts pending and records requester");
    await expectCode(
      () => leave.createOwnRequest(employee, requester, {
        leaveType: "full_day",
        startDate: "2097-06-07",
        endDate: "2097-06-07",
      }),
      "LEAVE_REQUEST_CONFLICT",
      "duplicate full-day leave is rejected",
    );
    await expectCode(
      () => leave.createOwnRequest(employee, requester, {
        leaveType: "short_hours",
        startDate: "2097-06-07",
        endDate: "2097-06-07",
        startTime: "10:00",
        endTime: "11:00",
      }),
      "LEAVE_REQUEST_CONFLICT",
      "short-hour leave cannot overlap a pending full-day request",
    );
    await expectCode(
      () => leave.createOwnRequest(employee, requester, {
        leaveType: "short_hours",
        startDate: "2097-06-08",
        endDate: "2097-06-08",
        startTime: "11:00",
        endTime: "10:00",
      }),
      "INVALID_LEAVE_REQUEST",
      "invalid short-hour time ordering is rejected",
    );
    await leave.createOwnRequest(employee, requester, {
      leaveType: "short_hours",
      startDate: "2097-06-13",
      endDate: "2097-06-13",
      startTime: "10:00",
      endTime: "11:00",
    });
    await expectCode(
      () => leave.createOwnRequest(employee, requester, {
        leaveType: "short_hours",
        startDate: "2097-06-13",
        endDate: "2097-06-13",
        startTime: "10:30",
        endTime: "11:30",
      }),
      "LEAVE_REQUEST_CONFLICT",
      "overlapping short-hour requests are rejected",
    );
    const adjacentShort = await leave.createOwnRequest(employee, requester, {
      leaveType: "short_hours",
      startDate: "2097-06-13",
      endDate: "2097-06-13",
      startTime: "11:00",
      endTime: "12:00",
    });
    check(adjacentShort.status === "pending", "adjacent non-overlapping short-hour requests remain valid");

    const pendingCalendar = await attendance.getCalendar(employee, "2097-06-07", "2097-06-07");
    check(pendingCalendar[0].status === "absent", "pending full-day leave does not change calendar status");
    const rejected = await leave.decide(pending.id, "rejected", reviewer, "127.0.0.1");
    check(rejected.status === "rejected" && rejected.reviewedBy === reviewer, "pending leave can be rejected with reviewer details");
    const rejectedCalendar = await attendance.getCalendar(employee, "2097-06-07", "2097-06-07");
    check(rejectedCalendar[0].status === "absent", "rejected full-day leave does not become calendar leave");

    const approvedFull = await leave.createOwnRequest(employee, requester, {
      leaveType: "full_day",
      startDate: "2097-06-08",
      endDate: "2097-06-08",
      reason: "Approved leave verification",
    });
    await leave.decide(approvedFull.id, "approved", reviewer, "127.0.0.1");
    const fullCalendar = await attendance.getCalendar(employee, "2097-06-08", "2097-06-08");
    check(fullCalendar[0].status === "leave", "approved full-day leave flows into the attendance calendar");

    const short = await leave.createOwnRequest(employee, requester, {
      leaveType: "short_hours",
      startDate: "2097-06-09",
      endDate: "2097-06-09",
      startTime: "10:00",
      endTime: "11:00",
      reason: "Short leave verification",
    });
    await leave.decide(short.id, "approved", reviewer, "127.0.0.1");
    const shortCalendar = await attendance.getCalendar(employee, "2097-06-09", "2097-06-09");
    check(shortCalendar[0].status === "short_leave", "approved short-hour leave remains a distinct calendar status");
    await pool.execute(
      `INSERT INTO attendance_sessions
         (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc, check_out_at_utc)
       VALUES (?, '2097-06-09', 'Asia/Karachi', 'remote', 'completed',
               '2097-06-09 04:00:00.000', '2097-06-09 06:00:00.000')`,
      [employee],
    );
    const summary = await attendance.getSummary(employee, "2097-06-09");
    check(
      summary.weekly.workedSeconds === 7200
        && summary.weekly.approvedShortLeaveSeconds === 3600
        && !summary.weekly.shortLeaveAffectsWorkedTime,
      "short-hour leave is represented separately and never changes actual worked time",
    );

    const concurrent = await leave.createOwnRequest(employee, requester, {
      leaveType: "full_day",
      startDate: "2097-06-10",
      endDate: "2097-06-10",
    });
    const decisionResults = await Promise.allSettled([
      leave.decide(concurrent.id, "approved", reviewer, "127.0.0.1"),
      leave.decide(concurrent.id, "rejected", reviewer, "127.0.0.1"),
    ]);
    check(decisionResults.filter((result) => result.status === "fulfilled").length === 1, "concurrent conflicting leave decisions produce one final decision");
    await expectCode(
      () => leave.decide(concurrent.id, "approved", reviewer, "127.0.0.1"),
      "LEAVE_REQUEST_ALREADY_DECIDED",
      "a final leave decision cannot be changed",
    );

    const firstHoliday = await holidays.create("2097-06-11", "Phase 6 Holiday", reviewer, "127.0.0.1");
    holidayIds.push(firstHoliday.id);
    check(firstHoliday.name === "Phase 6 Holiday", "administrator can create a configured holiday");
    await expectCode(
      () => holidays.create("2097-06-11", "Duplicate Holiday", reviewer, "127.0.0.1"),
      "HOLIDAY_DATE_EXISTS",
      "duplicate holiday date is rejected",
    );
    let holidayCalendar = await attendance.getCalendar(employee, "2097-06-11", "2097-06-11");
    check(holidayCalendar[0].status === "holiday", "configured holiday flows into the attendance calendar");
    await holidays.update(firstHoliday.id, "2097-06-12", "Phase 6 Holiday Updated", reviewer, "127.0.0.1");
    holidayCalendar = await attendance.getCalendar(employee, "2097-06-11", "2097-06-12");
    check(
      holidayCalendar[0].status === "absent" && holidayCalendar[1].status === "holiday",
      "editing a holiday moves its calendar effect to the updated date",
    );
    await holidays.delete(firstHoliday.id, reviewer, "127.0.0.1");
    holidayIds.splice(holidayIds.indexOf(firstHoliday.id), 1);
    holidayCalendar = await attendance.getCalendar(employee, "2097-06-12", "2097-06-12");
    check(holidayCalendar[0].status === "absent", "deleting a holiday restores the normal working-day result");

    const weekend = await attendance.getCalendar(employee, "2097-06-15", "2097-06-15");
    check(weekend[0].status !== "holiday", "weekends are not automatically holidays");
    const ownRequests = await leave.listOwn(employee);
    check(ownRequests.every((request) => request.employeeId === employee), "employee list is ownership-scoped");
    await expectCode(
      () => leave.getOwnById(employee + 999_999, approvedFull.id),
      "LEAVE_REQUEST_NOT_FOUND",
      "another employee cannot retrieve a private leave request by id",
    );
    const managed = await leave.listForManagement({ status: "approved" });
    check(managed.some((request) => request.id === approvedFull.id), "admin management filtering returns approved requests");

    const [auditRows] = await pool.execute<RowDataPacket[]>(
      `SELECT action, entity_type FROM audit_logs
       WHERE user_id = ? AND entity_type IN ('leave_request', 'holiday')`,
      [reviewer],
    );
    check(
      auditRows.some((row) => row.entity_type === "leave_request" && row.action === "update")
        && auditRows.some((row) => row.entity_type === "holiday" && row.action === "create")
        && auditRows.some((row) => row.entity_type === "holiday" && row.action === "update")
        && auditRows.some((row) => row.entity_type === "holiday" && row.action === "delete"),
      "leave decisions and holiday mutations create privileged audit events",
    );
  } finally {
    const cleanup = await pool.getConnection();
    try {
      await cleanup.beginTransaction();
      if (reviewerUserId !== null) {
        await cleanup.execute(
          "DELETE FROM audit_logs WHERE user_id = ? AND entity_type IN ('leave_request', 'holiday')",
          [reviewerUserId],
        );
      }
      if (holidayIds.length) {
        await cleanup.query("DELETE FROM holidays WHERE id IN (?)", [holidayIds]);
      }
      if (employeeId !== null) {
        await cleanup.execute("DELETE FROM attendance_sessions WHERE employee_id = ?", [employeeId]);
        await cleanup.execute("DELETE FROM leave_requests WHERE employee_id = ?", [employeeId]);
        await cleanup.execute("DELETE FROM employee_attendance_settings WHERE employee_id = ?", [employeeId]);
      }
      if (employeeUserId !== null) await cleanup.execute("DELETE FROM users WHERE id = ?", [employeeUserId]);
      if (reviewerUserId !== null) await cleanup.execute("DELETE FROM users WHERE id = ?", [reviewerUserId]);
      if (employeeId !== null) await cleanup.execute("DELETE FROM employees WHERE id = ?", [employeeId]);
      if (reviewerEmployeeId !== null) await cleanup.execute("DELETE FROM employees WHERE id = ?", [reviewerEmployeeId]);
      await cleanup.commit();
    } catch (error) {
      await cleanup.rollback();
      throw error;
    } finally {
      cleanup.release();
      await pool.end();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
