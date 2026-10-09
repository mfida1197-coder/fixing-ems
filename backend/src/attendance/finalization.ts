import { Pool, RowDataPacket } from "mysql2/promise";
import { addDays, enumerateDates } from "./calculations";
import { ATTENDANCE_TIME_ZONE, AttendanceDayStatus } from "./types";
import { workDateForInstant } from "./time";

export type FinalizedAttendanceStatus = Extract<AttendanceDayStatus, "absent" | "present" | "leave" | "short_leave" | "holiday">;

interface EmployeeRow extends RowDataPacket {
  id: number;
  joining_date: string;
}

interface SessionStateRow extends RowDataPacket {
  employee_id: number;
  work_date: string;
  has_completed: number;
  has_incomplete: number;
}

interface HolidayRow extends RowDataPacket { holiday_date: string; }
interface LeaveRow extends RowDataPacket { employee_id: number; start_date: string; end_date: string; leave_type: "full_day" | "short_hours"; }
interface StoredStatusRow extends RowDataPacket { employee_id: number; work_date: string; status: FinalizedAttendanceStatus; }

const keyFor = (employeeId: number, workDate: string) => `${employeeId}:${workDate}`;

/**
 * Finalizes date-level attendance without manufacturing a checkout.  Session
 * evidence remains in attendance_sessions; this table is the durable outcome
 * used by all date-level attendance views.
 */
export async function finalizeAttendanceStatusRange(
  database: Pool,
  from: string,
  to: string,
  at: Date = new Date(),
): Promise<number> {
  const today = workDateForInstant(at, ATTENDANCE_TIME_ZONE);
  const finalTo = to < today ? to : addDays(today, -1);
  if (from > finalTo) return 0;

  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();

    // Once a work date is over, retain the evidence but make an unresolved
    // session/break explicit.  No checkout time or worked time is invented.
    await connection.execute(
      `UPDATE attendance_breaks b
       JOIN attendance_sessions s ON s.id = b.attendance_session_id
       SET b.state = 'incomplete', b.incomplete_reason = COALESCE(b.incomplete_reason, 'Work date ended before break-in')
       WHERE s.work_date BETWEEN ? AND ? AND b.state = 'open'`,
      [from, finalTo],
    );
    await connection.execute(
      `UPDATE attendance_sessions
       SET state = 'incomplete', incomplete_reason = COALESCE(incomplete_reason, 'Work date ended before check-out')
       WHERE work_date BETWEEN ? AND ? AND state = 'open'`,
      [from, finalTo],
    );

    const [employees] = await connection.execute<EmployeeRow[]>(
      `SELECT id, DATE_FORMAT(joining_date, '%Y-%m-%d') AS joining_date
       FROM employees WHERE joining_date <= ?`,
      [finalTo],
    );
    if (employees.length === 0) {
      await connection.commit();
      return 0;
    }
    const [sessionStates] = await connection.execute<SessionStateRow[]>(
      `SELECT employee_id, DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date,
              MAX(state = 'completed') AS has_completed,
              MAX(state IN ('open', 'incomplete')) AS has_incomplete
       FROM attendance_sessions
       WHERE work_date BETWEEN ? AND ? GROUP BY employee_id, work_date`,
      [from, finalTo],
    );
    const [holidays] = await connection.execute<HolidayRow[]>(
      `SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS holiday_date
       FROM holidays WHERE holiday_date BETWEEN ? AND ?`,
      [from, finalTo],
    );
    const [leaves] = await connection.execute<LeaveRow[]>(
      `SELECT employee_id, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
              DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date, leave_type
       FROM leave_requests
       WHERE status = 'approved' AND start_date <= ? AND end_date >= ?`,
      [finalTo, from],
    );

    const sessionByDay = new Map(sessionStates.map((row) => [keyFor(Number(row.employee_id), row.work_date), row]));
    const holidayDates = new Set(holidays.map((row) => row.holiday_date));
    const leaveByEmployee = new Map<number, LeaveRow[]>();
    for (const leave of leaves) {
      const employeeLeaves = leaveByEmployee.get(Number(leave.employee_id)) ?? [];
      employeeLeaves.push(leave);
      leaveByEmployee.set(Number(leave.employee_id), employeeLeaves);
    }

    const records: Array<[number, string, FinalizedAttendanceStatus, string]> = [];
    for (const employee of employees) {
      const start = employee.joining_date > from ? employee.joining_date : from;
      const employeeLeaves = leaveByEmployee.get(Number(employee.id)) ?? [];
      for (const workDate of enumerateDates(start, finalTo)) {
        const leave = employeeLeaves.filter((item) => item.start_date <= workDate && item.end_date >= workDate);
        const state = sessionByDay.get(keyFor(Number(employee.id), workDate));
        let status: FinalizedAttendanceStatus;
        if (holidayDates.has(workDate)) status = "holiday";
        else if (leave.some((item) => item.leave_type === "full_day")) status = "leave";
        else if (leave.some((item) => item.leave_type === "short_hours")) status = "short_leave";
        else if (Boolean(state?.has_incomplete)) status = "absent";
        else if (Boolean(state?.has_completed)) status = "present";
        else status = "absent";
        records.push([Number(employee.id), workDate, status, at.toISOString().slice(0, 23).replace("T", " ")]);
      }
    }

    for (let offset = 0; offset < records.length; offset += 250) {
      const chunk = records.slice(offset, offset + 250);
      const placeholders = chunk.map(() => "(?, ?, ?, ?)").join(", ");
      await connection.execute(
        `INSERT INTO attendance_day_statuses (employee_id, work_date, status, finalized_at_utc)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE status = VALUES(status), finalized_at_utc = VALUES(finalized_at_utc)`,
        chunk.flat(),
      );
    }
    await connection.commit();
    return records.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function finalizeAllPastAttendanceStatuses(
  database: Pool,
  at: Date = new Date(),
): Promise<number> {
  const [rows] = await database.execute<RowDataPacket[]>(
    "SELECT DATE_FORMAT(MIN(joining_date), '%Y-%m-%d') AS earliest_date FROM employees",
  );
  const earliest = rows[0]?.earliest_date as string | null;
  if (!earliest) return 0;
  return finalizeAttendanceStatusRange(
    database,
    earliest,
    addDays(workDateForInstant(at, ATTENDANCE_TIME_ZONE), -1),
    at,
  );
}

export async function loadFinalizedAttendanceStatuses(
  database: Pool,
  employeeIds: number[],
  from: string,
  to: string,
): Promise<Map<string, FinalizedAttendanceStatus>> {
  if (employeeIds.length === 0) return new Map();
  const [rows] = await database.query<StoredStatusRow[]>(
    `SELECT employee_id, DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date, status
     FROM attendance_day_statuses
     WHERE employee_id IN (?) AND work_date BETWEEN ? AND ?`,
    [employeeIds, from, to],
  );
  return new Map(rows.map((row) => [keyFor(Number(row.employee_id), row.work_date), row.status]));
}

export function finalizedStatusFor(
  statuses: Map<string, FinalizedAttendanceStatus>,
  employeeId: number,
  workDate: string,
): FinalizedAttendanceStatus | undefined {
  return statuses.get(keyFor(employeeId, workDate));
}
