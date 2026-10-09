import { Pool, RowDataPacket } from "mysql2/promise";
import { pool as applicationPool } from "../db";
import {
  addDays,
  calculateCalendar,
  calculateDailyAttendance,
  calculateSession,
  enumerateDates,
} from "./calculations";
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
  AdminAttendanceDashboardResult,
  AdminAttendanceStatus,
  AttendanceOverviewBucket,
  AttendanceOverviewPeriod,
  AttendanceStatusCount,
  AttendanceTimelineEmployee,
  AttendanceTimelineSegment,
} from "./analyticsTypes";

interface EmployeeRow extends RowDataPacket {
  id: number;
  employee_code: string;
  full_name: string;
  designation: string;
  attendance_mode: AttendanceMode;
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
  status: "approved";
  requested_by: number | null;
  reviewed_by: number | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const STATUS_LABELS: Record<AdminAttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  leave: "Full-day leave",
  short_leave: "Short leave",
  holiday: "Holiday",
  incomplete: "Incomplete",
  pending: "Current / pending",
  future: "Future / no data",
};

function mapSession(row: SessionRow): AttendanceSession {
  return {
    id: Number(row.id), employeeId: Number(row.employee_id), workDate: row.work_date,
    timezoneName: row.timezone_name, attendanceMode: row.attendance_mode, state: row.state,
    checkInAtUtc: row.check_in_at_utc, checkOutAtUtc: row.check_out_at_utc,
    incompleteReason: row.incomplete_reason, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapBreak(row: BreakRow): AttendanceBreak {
  return {
    id: Number(row.id), attendanceSessionId: Number(row.attendance_session_id), state: row.state,
    breakOutAtUtc: row.break_out_at_utc, breakInAtUtc: row.break_in_at_utc,
    incompleteReason: row.incomplete_reason, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapHoliday(row: HolidayRow): Holiday {
  return {
    id: Number(row.id), holidayDate: row.holiday_date, name: row.name,
    createdBy: row.created_by, updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapLeave(row: LeaveRow): LeaveRequest {
  return {
    id: Number(row.id), employeeId: Number(row.employee_id), leaveType: row.leave_type,
    startDate: row.start_date, endDate: row.end_date, startTime: row.start_time, endTime: row.end_time,
    timezoneName: row.timezone_name, reason: row.reason, status: row.status,
    requestedBy: row.requested_by, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function monthStart(date: string, offset: number): string {
  const base = new Date(`${date.slice(0, 7)}-01T00:00:00.000Z`);
  base.setUTCMonth(base.getUTCMonth() + offset);
  return base.toISOString().slice(0, 10);
}

function monthEnd(monthFirst: string): string {
  return addDays(monthStart(monthFirst, 1), -1);
}

function overviewRange(anchor: string, period: AttendanceOverviewPeriod) {
  if (period === 180) return { from: monthStart(anchor, -5), to: anchor, bucketUnit: "month" as const };
  return {
    from: addDays(anchor, -(period - 1)),
    to: anchor,
    bucketUnit: period === 60 ? "week" as const : "day" as const,
  };
}

function bucketRanges(from: string, to: string, unit: "day" | "week" | "month") {
  if (unit === "day") return enumerateDates(from, to).map((date) => ({ from: date, to: date }));
  if (unit === "week") {
    const ranges: Array<{ from: string; to: string }> = [];
    for (let start = from; start <= to; start = addDays(start, 7)) {
      const end = addDays(start, 6);
      ranges.push({ from: start, to: end > to ? to : end });
    }
    return ranges;
  }
  const ranges: Array<{ from: string; to: string }> = [];
  for (let start = from; start <= to; start = monthStart(start, 1)) {
    const end = monthEnd(start);
    ranges.push({ from: start, to: end > to ? to : end });
  }
  return ranges;
}

function localPosition(value: Date, workDate: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ATTENDANCE_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "00";
  const localDate = `${part("year")}-${part("month")}-${part("day")}`;
  if (localDate < workDate) return 0;
  if (localDate > workDate) return 1440;
  return Math.min(1440, Number(part("hour")) * 60 + Number(part("minute")));
}

function segment(startMinute: number, endMinute: number): AttendanceTimelineSegment | null {
  const start = Math.max(0, Math.min(1440, startMinute));
  const end = Math.max(start, Math.min(1440, endMinute));
  return end > start ? { startMinute: start, endMinute: end } : null;
}

export class AttendanceAnalyticsService {
  constructor(
    private readonly database: Pool = applicationPool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getDashboard(selectedDate: string, periodDays: AttendanceOverviewPeriod): Promise<AdminAttendanceDashboardResult> {
    const generatedAtUtc = this.now();
    const today = workDateForInstant(generatedAtUtc, ATTENDANCE_TIME_ZONE);
    const overview = overviewRange(selectedDate, periodDays);
    const rangeFrom = [overview.from, selectedDate, today].sort()[0];
    const rangeTo = [overview.to, selectedDate, today].sort().at(-1)!;
    await finalizeAttendanceStatusRange(this.database, rangeFrom, rangeTo, generatedAtUtc);

    const [employees, sessions, holidays, leave, pendingRows] = await Promise.all([
      this.loadEmployees(),
      this.loadSessions(rangeFrom, rangeTo),
      this.loadHolidays(rangeFrom, rangeTo),
      this.loadApprovedLeave(rangeFrom, rangeTo),
      this.database.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM leave_requests l
         JOIN employees e ON e.id = l.employee_id
         WHERE l.status = 'pending' AND e.status = 'active'`,
      ).then(([rows]) => rows),
    ]);

    const finalized = await loadFinalizedAttendanceStatuses(this.database, employees.map((employee) => Number(employee.id)), rangeFrom, rangeTo);
    const sessionsByEmployee = new Map<number, AttendanceSessionWithBreaks[]>();
    for (const session of sessions) {
      const list = sessionsByEmployee.get(session.employeeId) ?? [];
      list.push(session);
      sessionsByEmployee.set(session.employeeId, list);
    }
    const leaveByEmployee = new Map<number, LeaveRequest[]>();
    for (const request of leave) {
      const list = leaveByEmployee.get(request.employeeId) ?? [];
      list.push(request);
      leaveByEmployee.set(request.employeeId, list);
    }

    const calendars = new Map<number, Map<string, AdminAttendanceStatus>>();
    for (const employee of employees) {
      const employeeSessions = sessionsByEmployee.get(Number(employee.id)) ?? [];
      const daily = new Map<string, ReturnType<typeof calculateDailyAttendance>>();
      for (const date of enumerateDates(rangeFrom, rangeTo)) {
        daily.set(
          date,
          calculateDailyAttendance(date, employeeSessions.filter((item) => item.workDate === date), generatedAtUtc),
        );
      }
      const calendar = calculateCalendar(
        rangeFrom, rangeTo, today, daily, holidays, leaveByEmployee.get(Number(employee.id)) ?? [], generatedAtUtc,
      );
      calendars.set(Number(employee.id), new Map(calendar.map((day) => [
        day.date,
        day.date < today ? finalizedStatusFor(finalized, Number(employee.id), day.date) ?? day.status : day.status,
      ])));
    }

    const countForDate = (date: string) => {
      const counts = new Map<AdminAttendanceStatus, number>();
      for (const employee of employees) {
        const status = calendars.get(Number(employee.id))?.get(date) ?? "pending";
        counts.set(status, (counts.get(status) ?? 0) + 1);
      }
      return counts;
    };
    const selectedCounts = countForDate(selectedDate);
    const teamStatuses = this.statusCounts(selectedCounts, employees.length);
    const timelineEmployees = employees.map((employee) => this.timelineEmployee(
      employee,
      selectedDate,
      calendars.get(Number(employee.id))?.get(selectedDate) ?? "pending",
      (sessionsByEmployee.get(Number(employee.id)) ?? []).filter((session) => session.workDate === selectedDate),
      generatedAtUtc,
    ));

    const buckets = bucketRanges(overview.from, overview.to, overview.bucketUnit).map((range) => {
      const aggregate = new Map<AdminAttendanceStatus, number>();
      for (const date of enumerateDates(range.from, range.to)) {
        for (const [status, count] of countForDate(date)) aggregate.set(status, (aggregate.get(status) ?? 0) + count);
      }
      return this.overviewBucket(range.from, range.to, aggregate, overview.bucketUnit);
    });

    return {
      timezone: ATTENDANCE_TIME_ZONE,
      today,
      selectedDate,
      generatedAtUtc,
      kpis: {
        totalEmployees: employees.length,
        todayPresent: selectedCounts.get("present") ?? 0,
        todayAbsent: selectedCounts.get("absent") ?? 0,
        pendingLeave: Number(pendingRows[0]?.count ?? 0),
      },
      teamStatus: { totalEmployees: employees.length, statuses: teamStatuses },
      overview: { periodDays, ...overview, buckets },
      timeline: {
        totalCheckIns: timelineEmployees.reduce((total, employee) => total + employee.sessions.length, 0),
        totalCheckOuts: timelineEmployees.reduce(
          (total, employee) => total + employee.sessions.filter((session) => session.checkOutAtUtc !== null).length,
          0,
        ),
        activeEmployees: timelineEmployees.filter((employee) => employee.sessions.some((session) => session.state === "open")).length,
        employees: timelineEmployees,
      },
    };
  }

  private async loadEmployees(): Promise<EmployeeRow[]> {
    const [rows] = await this.database.execute<EmployeeRow[]>(
      `SELECT e.id, e.employee_code, e.full_name, e.designation,
              COALESCE(s.attendance_mode, 'remote') AS attendance_mode
       FROM employees e
       LEFT JOIN employee_attendance_settings s ON s.employee_id = e.id
       WHERE e.status = 'active'
       ORDER BY e.full_name, e.id`,
    );
    return rows;
  }

  private async loadSessions(from: string, to: string): Promise<AttendanceSessionWithBreaks[]> {
    const [sessionRows] = await this.database.execute<SessionRow[]>(
      `SELECT s.id, s.employee_id, DATE_FORMAT(s.work_date, '%Y-%m-%d') AS work_date,
              s.timezone_name, s.attendance_mode, s.state, s.check_in_at_utc, s.check_out_at_utc,
              s.incomplete_reason, s.created_at, s.updated_at
       FROM attendance_sessions s
       JOIN employees e ON e.id = s.employee_id AND e.status = 'active'
       WHERE s.work_date BETWEEN ? AND ?
       ORDER BY s.employee_id, s.work_date, s.check_in_at_utc, s.id`,
      [from, to],
    );
    if (sessionRows.length === 0) return [];
    const ids = sessionRows.map((row) => Number(row.id));
    const [breakRows] = await this.database.query<BreakRow[]>(
      `SELECT id, attendance_session_id, state, break_out_at_utc, break_in_at_utc,
              incomplete_reason, created_at, updated_at
       FROM attendance_breaks WHERE attendance_session_id IN (?)
       ORDER BY attendance_session_id, break_out_at_utc, id`,
      [ids],
    );
    const bySession = new Map<number, AttendanceBreak[]>();
    for (const row of breakRows) {
      const item = mapBreak(row);
      const list = bySession.get(item.attendanceSessionId) ?? [];
      list.push(item);
      bySession.set(item.attendanceSessionId, list);
    }
    return sessionRows.map((row) => {
      const item = mapSession(row);
      return { ...item, breaks: bySession.get(item.id) ?? [] };
    });
  }

  private async loadHolidays(from: string, to: string): Promise<Holiday[]> {
    const [rows] = await this.database.execute<HolidayRow[]>(
      `SELECT id, DATE_FORMAT(holiday_date, '%Y-%m-%d') AS holiday_date, name,
              created_by, updated_by, created_at, updated_at
       FROM holidays WHERE holiday_date BETWEEN ? AND ?`,
      [from, to],
    );
    return rows.map(mapHoliday);
  }

  private async loadApprovedLeave(from: string, to: string): Promise<LeaveRequest[]> {
    const [rows] = await this.database.execute<LeaveRow[]>(
      `SELECT l.id, l.employee_id, l.leave_type,
              DATE_FORMAT(l.start_date, '%Y-%m-%d') AS start_date,
              DATE_FORMAT(l.end_date, '%Y-%m-%d') AS end_date,
              TIME_FORMAT(l.start_time, '%H:%i:%s') AS start_time,
              TIME_FORMAT(l.end_time, '%H:%i:%s') AS end_time,
              l.timezone_name, l.reason, l.status, l.requested_by, l.reviewed_by,
              l.reviewed_at, l.created_at, l.updated_at
       FROM leave_requests l
       JOIN employees e ON e.id = l.employee_id AND e.status = 'active'
       WHERE l.status = 'approved' AND l.start_date <= ? AND l.end_date >= ?`,
      [to, from],
    );
    return rows.map(mapLeave);
  }

  private statusCounts(counts: Map<AdminAttendanceStatus, number>, total: number): AttendanceStatusCount[] {
    const order: AdminAttendanceStatus[] = [
      "present", "absent", "leave", "short_leave", "holiday", "incomplete", "pending", "future",
    ];
    return order.map((status) => {
      const count = counts.get(status) ?? 0;
      return {
        status, label: STATUS_LABELS[status], count,
        percentage: total === 0 ? 0 : Math.round((count / total) * 10_000) / 100,
      };
    }).filter((entry) => entry.count > 0);
  }

  private overviewBucket(
    from: string,
    to: string,
    counts: Map<AdminAttendanceStatus, number>,
    unit: "day" | "week" | "month",
  ): AttendanceOverviewBucket {
    const label = unit === "day"
      ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${to}T00:00:00Z`))
      : unit === "month"
        ? new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${from}T00:00:00Z`))
        : `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${from}T00:00:00Z`))}`;
    return {
      from, to, label,
      present: counts.get("present") ?? 0,
      absent: counts.get("absent") ?? 0,
      leave: counts.get("leave") ?? 0,
      shortLeave: counts.get("short_leave") ?? 0,
      holiday: counts.get("holiday") ?? 0,
      incomplete: counts.get("incomplete") ?? 0,
      pending: counts.get("pending") ?? 0,
    };
  }

  private timelineEmployee(
    employee: EmployeeRow,
    workDate: string,
    status: AdminAttendanceStatus,
    sessions: AttendanceSessionWithBreaks[],
    now: Date,
  ): AttendanceTimelineEmployee {
    const sorted = [...sessions].sort((a, b) => a.checkInAtUtc.getTime() - b.checkInAtUtc.getTime());
    return {
      employeeId: Number(employee.id), employeeCode: employee.employee_code,
      employeeName: employee.full_name, designation: employee.designation,
      attendanceMode: employee.attendance_mode, status, statusLabel: STATUS_LABELS[status],
      sessions: sorted.map((session, index) => {
        const calculation = calculateSession(session, now);
        const knownEvents = session.breaks.flatMap((item) => [item.breakOutAtUtc, item.breakInAtUtc].filter((value): value is Date => value !== null));
        const lastKnownEvent = [session.checkInAtUtc, ...knownEvents].sort((left, right) => right.getTime() - left.getTime())[0];
        const sessionEnd = session.checkOutAtUtc
          ?? (session.state === "incomplete"
            ? lastKnownEvent
            : workDate === workDateForInstant(now, ATTENDANCE_TIME_ZONE)
              ? now
              : new Date(`${addDays(workDate, 1)}T00:00:00.000Z`));
        const startMinute = localPosition(session.checkInAtUtc, workDate);
        const endMinute = localPosition(sessionEnd, workDate);
        const workingSegments: AttendanceTimelineSegment[] = [];
        const timelineBreaks = [] as AttendanceTimelineEmployee["sessions"][number]["breaks"];
        let cursor = startMinute;
        for (const attendanceBreak of [...session.breaks].sort((a, b) => a.breakOutAtUtc.getTime() - b.breakOutAtUtc.getTime())) {
          const breakStart = localPosition(attendanceBreak.breakOutAtUtc, workDate);
          const work = segment(cursor, Math.min(breakStart, endMinute));
          if (work) workingSegments.push(work);
          const breakEnd = attendanceBreak.breakInAtUtc
            ? localPosition(attendanceBreak.breakInAtUtc, workDate)
            : endMinute;
          const breakSegment = segment(breakStart, Math.min(breakEnd, endMinute));
          if (breakSegment) timelineBreaks.push({ id: attendanceBreak.id, state: attendanceBreak.state, ...breakSegment });
          if (!attendanceBreak.breakInAtUtc) {
            cursor = endMinute;
            break;
          }
          cursor = Math.max(cursor, breakEnd);
        }
        const finalWork = segment(cursor, endMinute);
        if (finalWork) workingSegments.push(finalWork);
        return {
          id: session.id, sessionNumber: index + 1, attendanceMode: session.attendanceMode,
          state: session.state, checkInAtUtc: session.checkInAtUtc, checkOutAtUtc: session.checkOutAtUtc,
          workedSeconds: calculation.workedSeconds, completedBreakSeconds: calculation.completedBreakSeconds,
          workingSegments, breaks: timelineBreaks,
        };
      }),
    };
  }
}

export const attendanceAnalyticsService = new AttendanceAnalyticsService();
