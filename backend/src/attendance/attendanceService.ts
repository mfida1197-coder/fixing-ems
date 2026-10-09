import {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { pool as applicationPool } from "../db";
import {
  calculateCalendar,
  calculateDailyAttendance,
  calculateGpsValidity,
  calculatePeriodSummary,
  monthRange,
  shortLeaveSeconds,
  weekRange,
} from "./calculations";
import { AttendanceError, isMysqlDuplicateEntry } from "./errors";
import { toUtcSqlDateTime, workDateForInstant } from "./time";
import { finalizeAttendanceStatusRange, loadFinalizedAttendanceStatuses } from "./finalization";
import {
  ATTENDANCE_TIME_ZONE,
  AttendanceBreak,
  AttendanceMode,
  AttendanceSession,
  AttendanceSessionWithBreaks,
  CalendarDaySummary,
  DailyAttendanceSummary,
  EmployeeAttendanceSettings,
  GpsCoordinates,
  Holiday,
  LeaveRequest,
} from "./types";
import { validateGpsCoordinates } from "./validation";

interface EmployeeSettingsRow extends RowDataPacket {
  employee_id: number;
  attendance_mode: AttendanceMode;
  weekly_target_minutes: number;
  monthly_target_minutes: number;
  updated_by: number | null;
  created_at: Date;
  updated_at: Date;
}

interface OrganizationSettingsRow extends RowDataPacket {
  office_latitude: number | null;
  office_longitude: number | null;
  allowed_radius_meters: number | null;
}

interface SessionRow extends RowDataPacket {
  id: number;
  employee_id: number;
  work_date: string;
  timezone_name: string;
  attendance_mode: AttendanceMode;
  state: "open" | "completed" | "incomplete";
  check_in_at_utc: Date;
  check_out_at_utc: Date | null;
  incomplete_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

interface BreakRow extends RowDataPacket {
  id: number;
  attendance_session_id: number;
  state: "open" | "completed" | "incomplete";
  break_out_at_utc: Date;
  break_in_at_utc: Date | null;
  incomplete_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

interface HolidayRow extends RowDataPacket {
  id: number;
  holiday_date: string;
  name: string;
  created_by: number | null;
  updated_by: number | null;
  created_at: Date;
  updated_at: Date;
}

interface LeaveRow extends RowDataPacket {
  id: number;
  employee_id: number;
  leave_type: "full_day" | "short_hours";
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  timezone_name: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  requested_by: number | null;
  reviewed_by: number | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AttendanceCurrentState {
  attendanceMode: AttendanceMode;
  today: DailyAttendanceSummary;
  currentSession: ReturnType<typeof calculateDailyAttendance>["currentSession"];
  unresolvedPreviousSession: boolean;
}

export interface AttendanceRangeResult {
  from: string;
  to: string;
  days: DailyAttendanceSummary[];
}

export interface AttendanceSummaryResult {
  asOfWorkDate: string;
  weekly: ReturnType<typeof calculatePeriodSummary>;
  monthly: ReturnType<typeof calculatePeriodSummary>;
}

export interface AttendanceActionResult {
  action: "check_in" | "break_out" | "break_in" | "check_out";
  occurredAtUtc: Date;
  session: AttendanceSessionWithBreaks;
  gps: {
    validated: boolean;
    withinAllowedRadius: boolean;
    distanceMeters: number;
    allowedRadiusMeters: number;
  } | null;
}

type Queryable = Pool | PoolConnection;

function mapSession(row: SessionRow): AttendanceSession {
  return {
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    workDate: row.work_date,
    timezoneName: row.timezone_name,
    attendanceMode: row.attendance_mode,
    state: row.state,
    checkInAtUtc: row.check_in_at_utc,
    checkOutAtUtc: row.check_out_at_utc,
    incompleteReason: row.incomplete_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBreak(row: BreakRow): AttendanceBreak {
  return {
    id: Number(row.id),
    attendanceSessionId: Number(row.attendance_session_id),
    state: row.state,
    breakOutAtUtc: row.break_out_at_utc,
    breakInAtUtc: row.break_in_at_utc,
    incompleteReason: row.incomplete_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLeave(row: LeaveRow): LeaveRequest {
  return {
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    leaveType: row.leave_type,
    startDate: row.start_date,
    endDate: row.end_date,
    startTime: row.start_time,
    endTime: row.end_time,
    timezoneName: row.timezone_name,
    reason: row.reason,
    status: row.status,
    requestedBy: row.requested_by,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SESSION_COLUMNS = `
  s.id, s.employee_id, DATE_FORMAT(s.work_date, '%Y-%m-%d') AS work_date,
  s.timezone_name, s.attendance_mode, s.state, s.check_in_at_utc,
  s.check_out_at_utc, s.incomplete_reason, s.created_at, s.updated_at`;

export class AttendanceService {
  constructor(
    private readonly database: Pool = applicationPool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async checkIn(employeeId: number, coordinates?: GpsCoordinates): Promise<AttendanceActionResult> {
    return this.transition(employeeId, "check_in", coordinates);
  }

  async breakOut(employeeId: number, coordinates?: GpsCoordinates): Promise<AttendanceActionResult> {
    return this.transition(employeeId, "break_out", coordinates);
  }

  async breakIn(employeeId: number, coordinates?: GpsCoordinates): Promise<AttendanceActionResult> {
    return this.transition(employeeId, "break_in", coordinates);
  }

  async checkOut(employeeId: number, coordinates?: GpsCoordinates): Promise<AttendanceActionResult> {
    return this.transition(employeeId, "check_out", coordinates);
  }

  async getCurrentState(employeeId: number, at: Date = this.now()): Promise<AttendanceCurrentState> {
    const settings = await this.getEmployeeSettings(this.database, employeeId);
    const today = workDateForInstant(at, ATTENDANCE_TIME_ZONE);
    const todaySessions = await this.loadSessions(this.database, employeeId, today, today);
    const openSession = await this.loadOpenSession(this.database, employeeId);
    const daily = calculateDailyAttendance(today, todaySessions, at);
    let currentSession = daily.currentSession;
    if (openSession && openSession.workDate !== today) {
      currentSession = calculateDailyAttendance(openSession.workDate, [openSession], at).currentSession;
    }
    return {
      attendanceMode: settings.attendanceMode,
      today: daily,
      currentSession,
      unresolvedPreviousSession: Boolean(openSession && openSession.workDate !== today),
    };
  }

  async getHistory(employeeId: number, from: string, to: string, at: Date = this.now()): Promise<AttendanceRangeResult> {
    await this.getEmployeeSettings(this.database, employeeId);
    const sessions = await this.loadSessions(this.database, employeeId, from, to);
    const byDate = this.dailyMap(from, to, sessions, at);
    return { from, to, days: [...byDate.values()] };
  }

  async getCalendar(employeeId: number, from: string, to: string, at: Date = this.now()): Promise<CalendarDaySummary[]> {
    await this.getEmployeeSettings(this.database, employeeId);
    await finalizeAttendanceStatusRange(this.database, from, to, at);
    const [sessions, holidays, leave] = await Promise.all([
      this.loadSessions(this.database, employeeId, from, to),
      this.loadHolidays(from, to),
      this.loadApprovedLeave(employeeId, from, to),
    ]);
    const finalized = await loadFinalizedAttendanceStatuses(this.database, [employeeId], from, to);
    return calculateCalendar(
      from,
      to,
      workDateForInstant(at, ATTENDANCE_TIME_ZONE),
      this.dailyMap(from, to, sessions, at),
      holidays,
      leave,
      at,
      new Map([...finalized.entries()].map(([key, status]) => [key.slice(key.indexOf(":") + 1), status])),
    );
  }

  async getSummary(employeeId: number, anchorDate: string, at: Date = this.now()): Promise<AttendanceSummaryResult> {
    const settings = await this.getEmployeeSettings(this.database, employeeId);
    const weeklyRange = weekRange(anchorDate);
    const monthlyRange = monthRange(anchorDate);
    const from = weeklyRange.from < monthlyRange.from ? weeklyRange.from : monthlyRange.from;
    const to = weeklyRange.to > monthlyRange.to ? weeklyRange.to : monthlyRange.to;
    const [sessions, leave] = await Promise.all([
      this.loadSessions(this.database, employeeId, from, to),
      this.loadApprovedLeave(employeeId, from, to),
    ]);
    const allDays = this.dailyMap(from, to, sessions, at);
    const periodDays = (range: { from: string; to: string }) => [...allDays.values()].filter(
      (day) => day.workDate >= range.from && day.workDate <= range.to,
    );
    const periodLeave = (range: { from: string; to: string }) => leave.filter(
      (request) => request.startDate <= range.to && request.endDate >= range.from,
    );
    return {
      asOfWorkDate: anchorDate,
      weekly: calculatePeriodSummary(
        weeklyRange.from,
        weeklyRange.to,
        periodDays(weeklyRange),
        settings.weeklyTargetMinutes,
        shortLeaveSeconds(periodLeave(weeklyRange)),
      ),
      monthly: calculatePeriodSummary(
        monthlyRange.from,
        monthlyRange.to,
        periodDays(monthlyRange),
        settings.monthlyTargetMinutes,
        shortLeaveSeconds(periodLeave(monthlyRange)),
      ),
    };
  }

  private async transition(
    employeeId: number,
    action: AttendanceActionResult["action"],
    coordinates?: GpsCoordinates,
  ): Promise<AttendanceActionResult> {
    const connection = await this.database.getConnection();
    const occurredAtUtc = this.now();
    try {
      await connection.beginTransaction();
      const settings = await this.lockEmployeeSettings(connection, employeeId);
      const openSession = await this.loadOpenSession(connection, employeeId, true);
      let gps: AttendanceActionResult["gps"] = null;

      let sessionId: number;
      if (action === "check_in") {
        if (openSession) {
          const currentWorkDate = workDateForInstant(occurredAtUtc, ATTENDANCE_TIME_ZONE);
          if (openSession.workDate !== currentWorkDate) {
            throw new AttendanceError(
              409,
              "UNRESOLVED_PREVIOUS_SESSION",
              "A previous attendance session is still open and must be resolved before checking in again",
              { sessionId: openSession.id, workDate: openSession.workDate },
            );
          }
          throw new AttendanceError(409, "ALREADY_CHECKED_IN", "An attendance session is already open");
        }
        const [incompleteRows] = await connection.execute<RowDataPacket[]>(
          `SELECT id, DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date
           FROM attendance_sessions
           WHERE employee_id = ? AND state = 'incomplete'
           ORDER BY check_in_at_utc DESC LIMIT 1 FOR UPDATE`,
          [employeeId],
        );
        if (incompleteRows[0]) {
          throw new AttendanceError(
            409,
            "UNRESOLVED_INCOMPLETE_SESSION",
            "An incomplete attendance session must be resolved before checking in again",
            { sessionId: Number(incompleteRows[0].id), workDate: String(incompleteRows[0].work_date) },
          );
        }
        const workDate = workDateForInstant(occurredAtUtc, ATTENDANCE_TIME_ZONE);
        if (settings.attendanceMode === "gps") {
          const [existing] = await connection.execute<RowDataPacket[]>(
            `SELECT id FROM attendance_sessions
             WHERE employee_id = ? AND work_date = ? LIMIT 1 FOR UPDATE`,
            [employeeId, workDate],
          );
          if (existing[0]) {
            throw new AttendanceError(
              409,
              "ATTENDANCE_ALREADY_RECORDED_FOR_DATE",
              "GPS/office attendance already exists for this work date",
            );
          }
        }
        gps = await this.validateLocation(connection, settings.attendanceMode, coordinates);
        const [insert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO attendance_sessions
             (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc)
           VALUES (?, ?, ?, ?, 'open', ?)`,
          [employeeId, workDate, ATTENDANCE_TIME_ZONE, settings.attendanceMode, toUtcSqlDateTime(occurredAtUtc)],
        );
        sessionId = insert.insertId;
      } else {
        if (!openSession) {
          throw new AttendanceError(409, "NO_ACTIVE_SESSION", "No active attendance session exists");
        }
        sessionId = openSession.id;
        const openBreak = await this.loadOpenBreak(connection, sessionId, true);
        const incompleteBreak = await this.loadIncompleteBreak(connection, sessionId, true);
        if (incompleteBreak) {
          throw new AttendanceError(
            409,
            "UNRESOLVED_INCOMPLETE_BREAK",
            "An incomplete break must be resolved before another attendance transition",
            { breakId: incompleteBreak.id, sessionId },
          );
        }
        if (action === "break_out") {
          if (openBreak) throw new AttendanceError(409, "ALREADY_ON_BREAK", "A break is already active");
          gps = await this.validateLocation(connection, openSession.attendanceMode, coordinates);
          await connection.execute<ResultSetHeader>(
            `INSERT INTO attendance_breaks
               (attendance_session_id, state, break_out_at_utc)
             VALUES (?, 'open', ?)`,
            [sessionId, toUtcSqlDateTime(occurredAtUtc)],
          );
        } else if (action === "break_in") {
          if (!openBreak) throw new AttendanceError(409, "NOT_ON_BREAK", "No active break exists");
          gps = await this.validateLocation(connection, openSession.attendanceMode, coordinates);
          await connection.execute<ResultSetHeader>(
            `UPDATE attendance_breaks
             SET state = 'completed', break_in_at_utc = ?
             WHERE id = ? AND state = 'open'`,
            [toUtcSqlDateTime(occurredAtUtc), openBreak.id],
          );
        } else {
          if (openBreak) {
            throw new AttendanceError(
              409,
              "ACTIVE_BREAK_MUST_END",
              "End the active break before checking out",
            );
          }
          gps = await this.validateLocation(connection, openSession.attendanceMode, coordinates);
          await connection.execute<ResultSetHeader>(
            `UPDATE attendance_sessions
             SET state = 'completed', check_out_at_utc = ?
             WHERE id = ? AND state = 'open'`,
            [toUtcSqlDateTime(occurredAtUtc), sessionId],
          );
        }
      }

      const session = await this.loadSessionById(connection, sessionId);
      if (!session) throw new Error("Attendance session could not be reloaded after transition");
      await connection.commit();
      return { action, occurredAtUtc, session, gps };
    } catch (error) {
      await connection.rollback();
      if (isMysqlDuplicateEntry(error)) {
        throw new AttendanceError(
          409,
          "ATTENDANCE_STATE_CONFLICT",
          "Attendance state changed in another request; refresh and try again",
        );
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  private async lockEmployeeSettings(
    connection: PoolConnection,
    employeeId: number,
  ): Promise<EmployeeAttendanceSettings> {
    await connection.execute<ResultSetHeader>(
      `INSERT IGNORE INTO employee_attendance_settings (employee_id)
       SELECT id FROM employees WHERE id = ?`,
      [employeeId],
    );
    const [rows] = await connection.execute<EmployeeSettingsRow[]>(
      `SELECT employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes,
              updated_by, created_at, updated_at
       FROM employee_attendance_settings
       WHERE employee_id = ?
       LIMIT 1 FOR UPDATE`,
      [employeeId],
    );
    if (!rows[0]) throw new AttendanceError(404, "EMPLOYEE_NOT_FOUND", "Employee record was not found");
    return this.mapSettings(rows[0]);
  }

  private async getEmployeeSettings(queryable: Queryable, employeeId: number): Promise<EmployeeAttendanceSettings> {
    const [rows] = await queryable.execute<EmployeeSettingsRow[]>(
      `SELECT employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes,
              updated_by, created_at, updated_at
       FROM employee_attendance_settings
       WHERE employee_id = ? LIMIT 1`,
      [employeeId],
    );
    if (!rows[0]) {
      throw new AttendanceError(
        409,
        "ATTENDANCE_SETTINGS_MISSING",
        "Attendance settings are missing for this employee",
      );
    }
    return this.mapSettings(rows[0]);
  }

  private mapSettings(row: EmployeeSettingsRow): EmployeeAttendanceSettings {
    return {
      employeeId: Number(row.employee_id),
      attendanceMode: row.attendance_mode,
      weeklyTargetMinutes: Number(row.weekly_target_minutes),
      monthlyTargetMinutes: Number(row.monthly_target_minutes),
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async validateLocation(
    connection: PoolConnection,
    mode: AttendanceMode,
    coordinates?: GpsCoordinates,
  ): Promise<AttendanceActionResult["gps"]> {
    if (coordinates) {
      const result = validateGpsCoordinates(coordinates);
      if (!result.valid) {
        throw new AttendanceError(400, "INVALID_GPS_COORDINATES", "GPS coordinates are invalid", {
          errors: result.errors,
        });
      }
    }
    if (mode === "remote") return null;
    if (!coordinates) {
      throw new AttendanceError(400, "GPS_COORDINATES_REQUIRED", "GPS coordinates are required for office attendance");
    }
    const [rows] = await connection.execute<OrganizationSettingsRow[]>(
      `SELECT office_latitude, office_longitude, allowed_radius_meters
       FROM organization_attendance_settings WHERE id = 1 LIMIT 1`,
    );
    const settings = rows[0];
    if (
      !settings
      || settings.office_latitude === null
      || settings.office_longitude === null
      || settings.allowed_radius_meters === null
    ) {
      throw new AttendanceError(
        503,
        "ATTENDANCE_GPS_NOT_CONFIGURED",
        "Office GPS attendance is not configured; contact an administrator",
      );
    }
    const validity = calculateGpsValidity(coordinates, {
      latitude: Number(settings.office_latitude),
      longitude: Number(settings.office_longitude),
      radiusMeters: Number(settings.allowed_radius_meters),
    });
    if (!validity.withinAllowedRadius) {
      throw new AttendanceError(403, "OUTSIDE_ALLOWED_GPS_RADIUS", "You are outside the allowed office attendance radius", {
        distanceMeters: Math.round(validity.distanceMeters * 100) / 100,
        allowedRadiusMeters: validity.allowedRadiusMeters,
      });
    }
    return {
      validated: true,
      withinAllowedRadius: true,
      distanceMeters: Math.round(validity.distanceMeters * 100) / 100,
      allowedRadiusMeters: validity.allowedRadiusMeters,
    };
  }

  private async loadOpenSession(
    queryable: Queryable,
    employeeId: number,
    forUpdate = false,
  ): Promise<AttendanceSessionWithBreaks | null> {
    const [rows] = await queryable.execute<SessionRow[]>(
      `SELECT ${SESSION_COLUMNS}
       FROM attendance_sessions s
       WHERE s.employee_id = ? AND s.state = 'open'
       ORDER BY s.check_in_at_utc DESC LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [employeeId],
    );
    return rows[0] ? this.attachBreaks(queryable, mapSession(rows[0])) : null;
  }

  private async loadOpenBreak(
    queryable: Queryable,
    sessionId: number,
    forUpdate = false,
  ): Promise<AttendanceBreak | null> {
    const [rows] = await queryable.execute<BreakRow[]>(
      `SELECT id, attendance_session_id, state, break_out_at_utc, break_in_at_utc,
              incomplete_reason, created_at, updated_at
       FROM attendance_breaks
       WHERE attendance_session_id = ? AND state = 'open'
       ORDER BY break_out_at_utc DESC LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [sessionId],
    );
    return rows[0] ? mapBreak(rows[0]) : null;
  }

  private async loadIncompleteBreak(
    queryable: Queryable,
    sessionId: number,
    forUpdate = false,
  ): Promise<AttendanceBreak | null> {
    const [rows] = await queryable.execute<BreakRow[]>(
      `SELECT id, attendance_session_id, state, break_out_at_utc, break_in_at_utc,
              incomplete_reason, created_at, updated_at
       FROM attendance_breaks
       WHERE attendance_session_id = ? AND state = 'incomplete'
       ORDER BY break_out_at_utc DESC LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [sessionId],
    );
    return rows[0] ? mapBreak(rows[0]) : null;
  }

  private async loadSessionById(queryable: Queryable, sessionId: number): Promise<AttendanceSessionWithBreaks | null> {
    const [rows] = await queryable.execute<SessionRow[]>(
      `SELECT ${SESSION_COLUMNS} FROM attendance_sessions s WHERE s.id = ? LIMIT 1`,
      [sessionId],
    );
    return rows[0] ? this.attachBreaks(queryable, mapSession(rows[0])) : null;
  }

  private async attachBreaks(queryable: Queryable, session: AttendanceSession): Promise<AttendanceSessionWithBreaks> {
    const [rows] = await queryable.execute<BreakRow[]>(
      `SELECT id, attendance_session_id, state, break_out_at_utc, break_in_at_utc,
              incomplete_reason, created_at, updated_at
       FROM attendance_breaks
       WHERE attendance_session_id = ?
       ORDER BY break_out_at_utc, id`,
      [session.id],
    );
    return { ...session, breaks: rows.map(mapBreak) };
  }

  private async loadSessions(
    queryable: Queryable,
    employeeId: number,
    from: string,
    to: string,
  ): Promise<AttendanceSessionWithBreaks[]> {
    const [sessionRows] = await queryable.execute<SessionRow[]>(
      `SELECT ${SESSION_COLUMNS}
       FROM attendance_sessions s
       WHERE s.employee_id = ? AND s.work_date BETWEEN ? AND ?
       ORDER BY s.work_date, s.check_in_at_utc, s.id`,
      [employeeId, from, to],
    );
    if (sessionRows.length === 0) return [];
    const sessions = sessionRows.map(mapSession);
    const ids = sessions.map((session) => session.id);
    const placeholders = ids.map(() => "?").join(",");
    const [breakRows] = await queryable.execute<BreakRow[]>(
      `SELECT id, attendance_session_id, state, break_out_at_utc, break_in_at_utc,
              incomplete_reason, created_at, updated_at
       FROM attendance_breaks
       WHERE attendance_session_id IN (${placeholders})
       ORDER BY attendance_session_id, break_out_at_utc, id`,
      ids,
    );
    const breaksBySession = new Map<number, AttendanceBreak[]>();
    for (const row of breakRows) {
      const attendanceBreak = mapBreak(row);
      const existing = breaksBySession.get(attendanceBreak.attendanceSessionId) ?? [];
      existing.push(attendanceBreak);
      breaksBySession.set(attendanceBreak.attendanceSessionId, existing);
    }
    return sessions.map((session) => ({ ...session, breaks: breaksBySession.get(session.id) ?? [] }));
  }

  private dailyMap(
    from: string,
    to: string,
    sessions: AttendanceSessionWithBreaks[],
    at: Date,
  ): Map<string, DailyAttendanceSummary> {
    const sessionsByDate = new Map<string, AttendanceSessionWithBreaks[]>();
    for (const session of sessions) {
      const existing = sessionsByDate.get(session.workDate) ?? [];
      existing.push(session);
      sessionsByDate.set(session.workDate, existing);
    }
    const days = new Map<string, DailyAttendanceSummary>();
    for (let date = from; date <= to;) {
      days.set(date, calculateDailyAttendance(date, sessionsByDate.get(date) ?? [], at));
      const next = new Date(`${date}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      date = next.toISOString().slice(0, 10);
    }
    return days;
  }

  private async loadHolidays(from: string, to: string): Promise<Holiday[]> {
    const [rows] = await this.database.execute<HolidayRow[]>(
      `SELECT id, DATE_FORMAT(holiday_date, '%Y-%m-%d') AS holiday_date, name,
              created_by, updated_by, created_at, updated_at
       FROM holidays WHERE holiday_date BETWEEN ? AND ? ORDER BY holiday_date`,
      [from, to],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      holidayDate: row.holiday_date,
      name: row.name,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private async loadApprovedLeave(employeeId: number, from: string, to: string): Promise<LeaveRequest[]> {
    const [rows] = await this.database.execute<LeaveRow[]>(
      `SELECT id, employee_id, leave_type,
              DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
              DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
              TIME_FORMAT(start_time, '%H:%i:%s') AS start_time,
              TIME_FORMAT(end_time, '%H:%i:%s') AS end_time,
              timezone_name, reason, status, requested_by, reviewed_by,
              reviewed_at, created_at, updated_at
       FROM leave_requests
       WHERE employee_id = ? AND status = 'approved'
         AND start_date <= ? AND end_date >= ?
       ORDER BY start_date, id`,
      [employeeId, to, from],
    );
    return rows.map(mapLeave);
  }
}

export const attendanceService = new AttendanceService();
