import { Pool, RowDataPacket } from "mysql2/promise";
import { pool as applicationPool } from "../db";
import { calculateCalendar, calculateDailyAttendance, enumerateDates } from "./calculations";
import { AttendanceError } from "./errors";
import {
  AttendanceReportEmployeeDay,
  AttendanceReportEmployeeSection,
  AttendanceReportEmployeeOption,
  AttendanceReportFilters,
  AttendanceReportResult,
  AttendanceReportSummary,
  ReportEmploymentStatus,
} from "./reportTypes";
import { workDateForInstant } from "./time";
import { finalizeAttendanceStatusRange, finalizedStatusFor, loadFinalizedAttendanceStatuses } from "./finalization";
import {
  ATTENDANCE_TIME_ZONE,
  AttendanceBreak,
  AttendanceDayStatus,
  AttendanceMode,
  AttendanceSession,
  AttendanceSessionWithBreaks,
  Holiday,
  LeaveRequest,
} from "./types";

interface EmployeeRow extends RowDataPacket {
  id: number;
  employee_code: string;
  full_name: string;
  designation: string;
  employment_status: ReportEmploymentStatus;
  attendance_mode: AttendanceMode;
  weekly_target_minutes: number | null;
  monthly_target_minutes: number | null;
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

const STATUS_LABELS: Record<AttendanceDayStatus, string> = {
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

function blankSummary(employeesIncluded: number): AttendanceReportSummary {
  return {
    employeesIncluded, employeeDays: 0, presentEmployeeDays: 0, absentEmployeeDays: 0,
    leaveEmployeeDays: 0, shortLeaveEmployeeDays: 0, holidayEmployeeDays: 0,
    incompleteEmployeeDays: 0, pendingEmployeeDays: 0, futureEmployeeDays: 0,
    totalVerifiedWorkedSeconds: 0, totalCompletedBreakSeconds: 0,
  };
}

function summarize(rows: AttendanceReportEmployeeDay[], employeesIncluded: number): AttendanceReportSummary {
  const summary = blankSummary(employeesIncluded);
  summary.employeeDays = rows.length;
  for (const row of rows) {
    if (row.attendanceStatus === "present") summary.presentEmployeeDays += 1;
    if (row.attendanceStatus === "absent") summary.absentEmployeeDays += 1;
    if (row.attendanceStatus === "leave") summary.leaveEmployeeDays += 1;
    if (row.attendanceStatus === "short_leave") summary.shortLeaveEmployeeDays += 1;
    if (row.attendanceStatus === "holiday") summary.holidayEmployeeDays += 1;
    if (row.attendanceStatus === "incomplete") summary.incompleteEmployeeDays += 1;
    if (row.attendanceStatus === "pending") summary.pendingEmployeeDays += 1;
    if (row.attendanceStatus === "future") summary.futureEmployeeDays += 1;
    summary.totalVerifiedWorkedSeconds += row.verifiedWorkedSeconds;
    summary.totalCompletedBreakSeconds += row.completedBreakSeconds;
  }
  return summary;
}

export function groupReportEmployees(rows: AttendanceReportEmployeeDay[], settings: Array<{ id: number; weekly_target_minutes: number | null; monthly_target_minutes: number | null }>): AttendanceReportEmployeeSection[] {
  const grouped = new Map<number, AttendanceReportEmployeeDay[]>();
  for (const row of rows) { const days = grouped.get(row.employeeId) ?? []; days.push(row); grouped.set(row.employeeId, days); }
  return [...grouped.values()].map((days) => {
    days.sort((a, b) => a.workDate.localeCompare(b.workDate));
    const employee = days[0];
    const target = settings.find((item) => Number(item.id) === employee.employeeId);
    return { employeeId: employee.employeeId, employeeCode: employee.employeeCode, employeeName: employee.employeeName,
      designation: employee.designation, attendanceMode: employee.attendanceMode,
      weeklyRequiredMinutes: target?.weekly_target_minutes == null ? null : Number(target.weekly_target_minutes),
      monthlyRequiredMinutes: target?.monthly_target_minutes == null ? null : Number(target.monthly_target_minutes),
      days, summary: summarize(days, 1) };
  }).sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.employeeId - b.employeeId);
}

export class AttendanceReportService {
  constructor(
    private readonly database: Pool = applicationPool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getEmployeeOptions(): Promise<AttendanceReportEmployeeOption[]> {
    const [rows] = await this.database.execute<EmployeeRow[]>(
      `SELECT e.id, e.employee_code, e.full_name, e.designation,
              e.status AS employment_status,
              COALESCE(s.attendance_mode, 'remote') AS attendance_mode,
              s.weekly_target_minutes, s.monthly_target_minutes
       FROM employees e
       LEFT JOIN employee_attendance_settings s ON s.employee_id = e.id
       ORDER BY (e.status = 'active') DESC, e.full_name, e.employee_code`,
    );
    return rows.map((row) => ({
      employeeId: Number(row.id), employeeCode: row.employee_code, employeeName: row.full_name,
      designation: row.designation, employmentStatus: row.employment_status,
      attendanceMode: row.attendance_mode,
    }));
  }

  async getReport(filters: AttendanceReportFilters, page: number, pageSize: number): Promise<AttendanceReportResult> {
    const generatedAt = this.now();
    const employees = await this.loadEmployees(filters);
    if (filters.employeeId !== null && employees.length === 0) {
      throw new AttendanceError(404, "EMPLOYEE_NOT_FOUND", "The selected employee was not found for the applied filters");
    }
    const allRows = await this.buildRows(filters, employees, generatedAt);
    const filteredRows = filters.attendanceStatus === null
      ? allRows
      : allRows.filter((row) => row.attendanceStatus === filters.attendanceStatus);
    const totalRows = filteredRows.length;
    const sections = groupReportEmployees(filteredRows, employees);
    const totalPages = Math.max(1, Math.ceil(sections.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    return {
      reportTitle: "Attendance Report",
      timezone: ATTENDANCE_TIME_ZONE,
      generatedAtUtc: generatedAt.toISOString(),
      filters,
      summary: summarize(filteredRows, new Set(filteredRows.map((row) => row.employeeId)).size),
      pagination: { page: safePage, pageSize, totalRows, totalPages },
      employeeSections: sections.slice(start, start + pageSize),
      rows: sections.slice(start, start + pageSize).flatMap((section) => section.days),
    };
  }

  async getCompleteReport(filters: AttendanceReportFilters): Promise<AttendanceReportResult> {
    const generatedAt = this.now();
    const employees = await this.loadEmployees(filters);
    if (filters.employeeId !== null && employees.length === 0) {
      throw new AttendanceError(404, "EMPLOYEE_NOT_FOUND", "The selected employee was not found for the applied filters");
    }
    const allRows = await this.buildRows(filters, employees, generatedAt);
    const rows = filters.attendanceStatus === null
      ? allRows
      : allRows.filter((row) => row.attendanceStatus === filters.attendanceStatus);
    return {
      reportTitle: "Attendance Report", timezone: ATTENDANCE_TIME_ZONE,
      generatedAtUtc: generatedAt.toISOString(), filters,
      summary: summarize(rows, new Set(rows.map((row) => row.employeeId)).size),
      pagination: { page: 1, pageSize: rows.length, totalRows: rows.length, totalPages: 1 },
      rows,
      employeeSections: groupReportEmployees(rows, employees),
    };
  }

  private async loadEmployees(filters: AttendanceReportFilters): Promise<EmployeeRow[]> {
    const conditions: string[] = [];
    const parameters: Array<string | number> = [];
    if (filters.employeeId !== null) { conditions.push("e.id = ?"); parameters.push(filters.employeeId); }
    if (filters.attendanceMode !== null) { conditions.push("COALESCE(s.attendance_mode, 'remote') = ?"); parameters.push(filters.attendanceMode); }
    if (filters.employmentStatus !== null) { conditions.push("e.status = ?"); parameters.push(filters.employmentStatus); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await this.database.execute<EmployeeRow[]>(
      `SELECT e.id, e.employee_code, e.full_name, e.designation,
              e.status AS employment_status,
              COALESCE(s.attendance_mode, 'remote') AS attendance_mode,
              s.weekly_target_minutes, s.monthly_target_minutes
       FROM employees e
       LEFT JOIN employee_attendance_settings s ON s.employee_id = e.id
       ${where}
       ORDER BY e.full_name, e.employee_code`,
      parameters,
    );
    return rows;
  }

  private async buildRows(
    filters: AttendanceReportFilters,
    employees: EmployeeRow[],
    generatedAt: Date,
  ): Promise<AttendanceReportEmployeeDay[]> {
    if (employees.length === 0) return [];
    const employeeIds = employees.map((employee) => Number(employee.id));
    await finalizeAttendanceStatusRange(this.database, filters.from, filters.to, generatedAt);
    const [sessionRows, holidayRows, leaveRows] = await Promise.all([
      this.database.query<SessionBreakRow[]>(
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
         WHERE s.employee_id IN (?) AND s.work_date BETWEEN ? AND ?
         ORDER BY s.employee_id, s.work_date, s.check_in_at_utc, b.break_out_at_utc`,
        [employeeIds, filters.from, filters.to],
      ).then(([rows]) => rows),
      this.database.execute<HolidayRow[]>(
        `SELECT id, DATE_FORMAT(holiday_date, '%Y-%m-%d') AS holiday_date, name,
                created_by, updated_by, created_at, updated_at
         FROM holidays WHERE holiday_date BETWEEN ? AND ?`,
        [filters.from, filters.to],
      ).then(([rows]) => rows),
      this.database.query<LeaveRow[]>(
        `SELECT id, employee_id, leave_type,
                DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
                DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
                TIME_FORMAT(start_time, '%H:%i:%s') AS start_time,
                TIME_FORMAT(end_time, '%H:%i:%s') AS end_time,
                timezone_name, reason, status, requested_by, reviewed_by,
                reviewed_at, created_at, updated_at
         FROM leave_requests
         WHERE employee_id IN (?) AND status = 'approved' AND start_date <= ? AND end_date >= ?`,
        [employeeIds, filters.to, filters.from],
      ).then(([rows]) => rows),
    ]);
    const finalized = await loadFinalizedAttendanceStatuses(this.database, employeeIds, filters.from, filters.to);
    const sessions = sessionsFromRows(sessionRows);
    const sessionsByEmployeeDate = new Map<string, AttendanceSessionWithBreaks[]>();
    for (const session of sessions) {
      const key = `${session.employeeId}:${session.workDate}`;
      const list = sessionsByEmployeeDate.get(key) ?? [];
      list.push(session);
      sessionsByEmployeeDate.set(key, list);
    }
    const leavesByEmployee = new Map<number, LeaveRequest[]>();
    for (const leave of leaveRows.map(mapLeave)) {
      const list = leavesByEmployee.get(leave.employeeId) ?? [];
      list.push(leave);
      leavesByEmployee.set(leave.employeeId, list);
    }
    const holidays = holidayRows.map(mapHoliday);
    const today = workDateForInstant(generatedAt, ATTENDANCE_TIME_ZONE);
    const rows: AttendanceReportEmployeeDay[] = [];
    for (const employee of employees) {
      for (const workDate of enumerateDates(filters.from, filters.to)) {
        const employeeId = Number(employee.id);
        const daySessions = sessionsByEmployeeDate.get(`${employeeId}:${workDate}`) ?? [];
        const daily = calculateDailyAttendance(workDate, daySessions, generatedAt);
        const calendarDay = calculateCalendar(
          workDate, workDate, today, new Map([[workDate, daily]]), holidays,
          leavesByEmployee.get(employeeId) ?? [], generatedAt,
          finalizedStatusFor(finalized, employeeId, workDate),
        )[0];
        rows.push({
          employeeId, employeeCode: employee.employee_code, employeeName: employee.full_name,
          designation: employee.designation, employmentStatus: employee.employment_status,
          attendanceMode: employee.attendance_mode, workDate,
          attendanceStatus: calendarDay.status, attendanceStatusLabel: STATUS_LABELS[calendarDay.status],
          sessionCount: daily.sessions.length,
          verifiedWorkedSeconds: daily.totalWorkedSeconds,
          completedBreakSeconds: daily.totalCompletedBreakSeconds,
          holidayName: calendarDay.holiday?.name ?? null,
          approvedLeave: calendarDay.approvedLeave
            ? {
                leaveType: calendarDay.approvedLeave.leaveType,
                startTime: calendarDay.approvedLeave.startTime,
                endTime: calendarDay.approvedLeave.endTime,
              }
            : null,
          sessions: daily.sessions.map((calculation, index) => ({
            id: calculation.session.id, sessionNumber: index + 1,
            attendanceMode: calculation.session.attendanceMode, state: calculation.session.state,
            checkInAtUtc: calculation.session.checkInAtUtc.toISOString(),
            checkOutAtUtc: calculation.session.checkOutAtUtc?.toISOString() ?? null,
            verifiedWorkedSeconds: calculation.session.state === "completed" ? calculation.workedSeconds : null,
            completedBreakSeconds: calculation.completedBreakSeconds,
            breaks: calculation.session.breaks.map((attendanceBreak) => ({
              id: attendanceBreak.id, state: attendanceBreak.state,
              breakOutAtUtc: attendanceBreak.breakOutAtUtc.toISOString(),
              breakInAtUtc: attendanceBreak.breakInAtUtc?.toISOString() ?? null,
              completedBreakSeconds: attendanceBreak.state === "completed" && attendanceBreak.breakInAtUtc
                ? Math.max(0, Math.floor((attendanceBreak.breakInAtUtc.getTime() - attendanceBreak.breakOutAtUtc.getTime()) / 1000))
                : null,
            })),
          })),
        });
      }
    }
    return rows.sort((left, right) => left.workDate.localeCompare(right.workDate)
      || left.employeeName.localeCompare(right.employeeName)
      || left.employeeId - right.employeeId);
  }
}

export const attendanceReportService = new AttendanceReportService();

