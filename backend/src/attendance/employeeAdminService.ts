import { Pool, RowDataPacket } from "mysql2/promise";
import { pool as applicationPool } from "../db";
import {
  calculateCalendar,
  calculateDailyAttendance,
  calculatePeriodSummary,
  enumerateDates,
  weekRange,
} from "./calculations";
import { AttendanceError } from "./errors";
import { attendanceService } from "./attendanceService";
import {
  getEmployeeAttendanceSettings,
  getOrganizationAttendanceSettings,
} from "./settingsService";
import { workDateForInstant } from "./time";
import { finalizeAttendanceStatusRange, finalizedStatusFor, loadFinalizedAttendanceStatuses } from "./finalization";
import {
  ATTENDANCE_TIME_ZONE,
  AttendanceBreak,
  AttendanceMode,
  AttendanceSession,
  AttendanceSessionWithBreaks,
  Holiday,
  LeaveRequest,
} from "./types";
import {
  AttendanceEmployeeDirectoryResult,
  AttendanceEmployeeDirectoryRow,
  AttendanceEmployeeLiveState,
  AttendanceEmployeeProfileOverview,
} from "./employeeAdminTypes";

interface EmployeeRow extends RowDataPacket {
  id: number;
  employee_code: string;
  full_name: string;
  designation: string;
  employment_status: "active" | "resigned" | "terminated";
  employment_type: "full_time" | "part_time" | "contract" | "intern";
  department: string | null;
  assigned_project: string | null;
  assigned_role: string | null;
  system_role: string | null;
  account_active: number | null;
  attendance_mode: AttendanceMode;
  weekly_target_minutes: number;
  monthly_target_minutes: number;
  has_attendance_history: number;
}

interface SessionBreakRow extends RowDataPacket {
  session_id: number;
  employee_id: number;
  work_date: string;
  timezone_name: string;
  attendance_mode: AttendanceMode;
  session_state: "open" | "completed" | "incomplete";
  check_in_at_utc: Date;
  check_out_at_utc: Date | null;
  session_incomplete_reason: string | null;
  session_created_at: Date;
  session_updated_at: Date;
  break_id: number | null;
  break_state: "open" | "completed" | "incomplete" | null;
  break_out_at_utc: Date | null;
  break_in_at_utc: Date | null;
  break_incomplete_reason: string | null;
  break_created_at: Date | null;
  break_updated_at: Date | null;
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
  status: "approved";
  requested_by: number | null;
  reviewed_by: number | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const STATE_LABELS: Record<AttendanceEmployeeLiveState, string> = {
  working: "Working",
  on_break: "On break",
  future: "Future / no data",
  holiday: "Holiday",
  leave: "Full-day leave",
  short_leave: "Short leave",
  present: "Present",
  pending: "Current / pending",
  incomplete: "Incomplete",
  absent: "Absent",
};

function mapHoliday(row: HolidayRow): Holiday {
  return {
    id: Number(row.id), holidayDate: row.holiday_date, name: row.name,
    createdBy: row.created_by, updatedBy: row.updated_by,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapLeave(row: LeaveRow): LeaveRequest {
  return {
    id: Number(row.id), employeeId: Number(row.employee_id), leaveType: row.leave_type,
    startDate: row.start_date, endDate: row.end_date, startTime: row.start_time,
    endTime: row.end_time, timezoneName: row.timezone_name, reason: row.reason,
    status: row.status, requestedBy: row.requested_by, reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function sessionsFromRows(rows: SessionBreakRow[]): AttendanceSessionWithBreaks[] {
  const sessions = new Map<number, AttendanceSessionWithBreaks>();
  for (const row of rows) {
    let session = sessions.get(Number(row.session_id));
    if (!session) {
      const base: AttendanceSession = {
        id: Number(row.session_id), employeeId: Number(row.employee_id), workDate: row.work_date,
        timezoneName: row.timezone_name, attendanceMode: row.attendance_mode, state: row.session_state,
        checkInAtUtc: row.check_in_at_utc, checkOutAtUtc: row.check_out_at_utc,
        incompleteReason: row.session_incomplete_reason,
        createdAt: row.session_created_at, updatedAt: row.session_updated_at,
      };
      session = { ...base, breaks: [] };
      sessions.set(base.id, session);
    }
    if (row.break_id !== null && row.break_state && row.break_out_at_utc && row.break_created_at && row.break_updated_at) {
      const attendanceBreak: AttendanceBreak = {
        id: Number(row.break_id), attendanceSessionId: Number(row.session_id), state: row.break_state,
        breakOutAtUtc: row.break_out_at_utc, breakInAtUtc: row.break_in_at_utc,
        incompleteReason: row.break_incomplete_reason,
        createdAt: row.break_created_at, updatedAt: row.break_updated_at,
      };
      session.breaks.push(attendanceBreak);
    }
  }
  return [...sessions.values()].sort((left, right) => left.checkInAtUtc.getTime() - right.checkInAtUtc.getTime());
}

export class AttendanceEmployeeAdminService {
  constructor(
    private readonly database: Pool = applicationPool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getDirectory(selectedDate: string): Promise<AttendanceEmployeeDirectoryResult> {
    const generatedAtUtc = this.now();
    const today = workDateForInstant(generatedAtUtc, ATTENDANCE_TIME_ZONE);
    const weeklyRange = weekRange(selectedDate);
    await finalizeAttendanceStatusRange(this.database, weeklyRange.from, weeklyRange.to, generatedAtUtc);
    const [employees, sessionRows, holidayRows, leaveRows, organizationSettings] = await Promise.all([
      this.loadEmployees(),
      this.loadSessionRows(weeklyRange.from, weeklyRange.to),
      this.database.execute<HolidayRow[]>(
        `SELECT id, DATE_FORMAT(holiday_date, '%Y-%m-%d') AS holiday_date, name,
                created_by, updated_by, created_at, updated_at
         FROM holidays WHERE holiday_date = ?`,
        [selectedDate],
      ).then(([rows]) => rows),
      this.database.execute<LeaveRow[]>(
        `SELECT id, employee_id, leave_type,
                DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
                DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
                TIME_FORMAT(start_time, '%H:%i:%s') AS start_time,
                TIME_FORMAT(end_time, '%H:%i:%s') AS end_time,
                timezone_name, reason, status, requested_by, reviewed_by,
                reviewed_at, created_at, updated_at
         FROM leave_requests
         WHERE status = 'approved' AND start_date <= ? AND end_date >= ?`,
        [selectedDate, selectedDate],
      ).then(([rows]) => rows),
      getOrganizationAttendanceSettings(),
    ]);
    const finalized = await loadFinalizedAttendanceStatuses(this.database, employees.map((employee) => Number(employee.id)), weeklyRange.from, weeklyRange.to);
    const sessions = sessionsFromRows(sessionRows);
    const sessionsByEmployee = new Map<number, AttendanceSessionWithBreaks[]>();
    for (const session of sessions) {
      const list = sessionsByEmployee.get(session.employeeId) ?? [];
      list.push(session);
      sessionsByEmployee.set(session.employeeId, list);
    }
    const leaveByEmployee = new Map<number, LeaveRequest[]>();
    for (const request of leaveRows.map(mapLeave)) {
      const list = leaveByEmployee.get(request.employeeId) ?? [];
      list.push(request);
      leaveByEmployee.set(request.employeeId, list);
    }
    const holidays = holidayRows.map(mapHoliday);

    const result: AttendanceEmployeeDirectoryRow[] = employees.map((employee) => {
      const employeeSessions = sessionsByEmployee.get(Number(employee.id)) ?? [];
      const dailyByDate = new Map(enumerateDates(weeklyRange.from, weeklyRange.to).map((date) => [
        date,
        calculateDailyAttendance(date, employeeSessions.filter((session) => session.workDate === date), generatedAtUtc),
      ]));
      const selectedDay = dailyByDate.get(selectedDate)
        ?? calculateDailyAttendance(selectedDate, [], generatedAtUtc);
      const calendar = calculateCalendar(
        selectedDate,
        selectedDate,
        today,
        new Map([[selectedDate, selectedDay]]),
        holidays,
        leaveByEmployee.get(Number(employee.id)) ?? [],
        generatedAtUtc,
        finalizedStatusFor(finalized, Number(employee.id), selectedDate),
      )[0];
      let state: AttendanceEmployeeLiveState = calendar.status;
      if (selectedDate === today && selectedDay.currentSession) {
        state = selectedDay.hasOpenBreak ? "on_break" : "working";
      }
      const weekly = calculatePeriodSummary(
        weeklyRange.from,
        weeklyRange.to,
        [...dailyByDate.values()],
        Number(employee.weekly_target_minutes),
        0,
      );
      return {
        employeeId: Number(employee.id), employeeCode: employee.employee_code,
        employeeName: employee.full_name, designation: employee.designation,
        employmentStatus: employee.employment_status, employmentType: employee.employment_type,
        department: employee.department, assignedProject: employee.assigned_project,
        assignedRole: employee.assigned_role, systemRole: employee.system_role,
        accountActive: employee.account_active === null ? null : Boolean(employee.account_active),
        attendanceMode: employee.attendance_mode, attendanceState: state,
        attendanceStateLabel: STATE_LABELS[state],
        selectedDateWorkedSeconds: selectedDay.totalWorkedSeconds + selectedDay.currentSessionWorkedSeconds,
        weekly, hasAttendanceHistory: Boolean(employee.has_attendance_history),
      };
    });

    return {
      timezone: ATTENDANCE_TIME_ZONE,
      today,
      selectedDate,
      generatedAtUtc,
      organizationGpsConfigured: organizationSettings.officeLatitude !== null
        && organizationSettings.officeLongitude !== null
        && organizationSettings.allowedRadiusMeters !== null,
      employees: result,
    };
  }

  async getProfileOverview(employeeId: number, selectedDate: string): Promise<AttendanceEmployeeProfileOverview> {
    const [employees] = await this.database.execute<RowDataPacket[]>(
      "SELECT id FROM employees WHERE id = ? LIMIT 1",
      [employeeId],
    );
    if (!employees[0]) throw new AttendanceError(404, "EMPLOYEE_NOT_FOUND", "Employee record was not found");
    const [history, summary, settings, organizationSettings] = await Promise.all([
      attendanceService.getHistory(employeeId, selectedDate, selectedDate),
      attendanceService.getSummary(employeeId, selectedDate),
      getEmployeeAttendanceSettings(employeeId),
      getOrganizationAttendanceSettings(),
    ]);
    return {
      selectedDate,
      selectedDay: history.days[0] ?? calculateDailyAttendance(selectedDate, [], this.now()),
      settings,
      organizationSettings,
      summary,
    };
  }

  private loadEmployees(): Promise<EmployeeRow[]> {
    return this.database.execute<EmployeeRow[]>(
      `SELECT e.id, e.employee_code, e.full_name, e.designation,
              e.status AS employment_status, e.employment_type,
              d.name AS department, assignment.assigned_project, assignment.assigned_role,
              r.name AS system_role, u.is_active AS account_active,
              COALESCE(settings.attendance_mode, 'remote') AS attendance_mode,
              COALESCE(settings.weekly_target_minutes, 0) AS weekly_target_minutes,
              COALESCE(settings.monthly_target_minutes, 0) AS monthly_target_minutes,
              EXISTS(SELECT 1 FROM attendance_sessions history WHERE history.employee_id = e.id LIMIT 1) AS has_attendance_history
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN employee_attendance_settings settings ON settings.employee_id = e.id
       LEFT JOIN users u ON u.employee_id = e.id
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN (
         SELECT pa.employee_id, MAX(p.name) AS assigned_project, MAX(pa.role_on_project) AS assigned_role
         FROM project_assignments pa
         JOIN projects p ON p.id = pa.project_id
         WHERE pa.removed_at IS NULL
         GROUP BY pa.employee_id
       ) assignment ON assignment.employee_id = e.id
       ORDER BY (e.status = 'active') DESC, e.full_name, e.employee_code`,
    ).then(([rows]) => rows);
  }

  private loadSessionRows(from: string, to: string): Promise<SessionBreakRow[]> {
    return this.database.execute<SessionBreakRow[]>(
      `SELECT s.id AS session_id, s.employee_id,
              DATE_FORMAT(s.work_date, '%Y-%m-%d') AS work_date,
              s.timezone_name, s.attendance_mode, s.state AS session_state,
              s.check_in_at_utc, s.check_out_at_utc,
              s.incomplete_reason AS session_incomplete_reason,
              s.created_at AS session_created_at, s.updated_at AS session_updated_at,
              b.id AS break_id, b.state AS break_state,
              b.break_out_at_utc, b.break_in_at_utc,
              b.incomplete_reason AS break_incomplete_reason,
              b.created_at AS break_created_at, b.updated_at AS break_updated_at
       FROM attendance_sessions s
       LEFT JOIN attendance_breaks b ON b.attendance_session_id = s.id
       WHERE s.work_date BETWEEN ? AND ?
       ORDER BY s.employee_id, s.check_in_at_utc, b.break_out_at_utc`,
      [from, to],
    ).then(([rows]) => rows);
  }
}

export const attendanceEmployeeAdminService = new AttendanceEmployeeAdminService();
