import {
  AttendancePeriodSummary,
  AttendanceSessionCalculation,
  AttendanceSessionWithBreaks,
  AttendanceTargetProgress,
  CalendarDaySummary,
  DailyAttendanceSummary,
  GpsCoordinates,
  GpsValidationResult,
  Holiday,
  LeaveRequest,
} from "./types";
import { isIsoDate } from "./validation";
import type { FinalizedAttendanceStatus } from "./finalization";

const EARTH_RADIUS_METERS = 6_371_000;

function secondsBetween(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
}

export function haversineDistanceMeters(
  point: GpsCoordinates,
  office: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(point.latitude - office.latitude);
  const longitudeDelta = radians(point.longitude - office.longitude);
  const officeLatitude = radians(office.latitude);
  const employeeLatitude = radians(point.latitude);
  const haversine = (
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(officeLatitude) * Math.cos(employeeLatitude) * Math.sin(longitudeDelta / 2) ** 2
  );
  const clamped = Math.min(1, Math.max(0, haversine));
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

export function calculateGpsValidity(
  point: GpsCoordinates,
  office: { latitude: number; longitude: number; radiusMeters: number },
): GpsValidationResult {
  const distanceMeters = haversineDistanceMeters(point, office);
  return {
    // A micrometre tolerance prevents floating-point noise from rejecting an
    // otherwise exact radius boundary without meaningfully widening it.
    withinAllowedRadius: distanceMeters <= office.radiusMeters + 0.000001,
    distanceMeters,
    allowedRadiusMeters: office.radiusMeters,
  };
}

export function calculateSession(
  session: AttendanceSessionWithBreaks,
  now: Date,
): AttendanceSessionCalculation {
  let completedBreakSeconds = 0;
  let activeBreakElapsedSeconds = 0;
  let hasOpenBreak = false;
  let hasIncompleteBreak = false;

  for (const attendanceBreak of session.breaks) {
    if (attendanceBreak.state === "completed" && attendanceBreak.breakInAtUtc) {
      completedBreakSeconds += secondsBetween(attendanceBreak.breakOutAtUtc, attendanceBreak.breakInAtUtc);
    } else if (attendanceBreak.state === "open") {
      hasOpenBreak = true;
      activeBreakElapsedSeconds += secondsBetween(attendanceBreak.breakOutAtUtc, now);
    } else if (attendanceBreak.state === "incomplete") {
      hasIncompleteBreak = true;
    }
  }

  const end = session.state === "completed" ? session.checkOutAtUtc : session.state === "open" ? now : null;
  const sessionSpanSeconds = end ? secondsBetween(session.checkInAtUtc, end) : null;
  const workedSeconds = sessionSpanSeconds === null
    ? null
    : Math.max(0, sessionSpanSeconds - completedBreakSeconds - activeBreakElapsedSeconds);

  return {
    session,
    sessionSpanSeconds,
    completedBreakSeconds,
    activeBreakElapsedSeconds,
    workedSeconds,
    hasOpenBreak,
    hasIncompleteBreak,
  };
}

export function calculateDailyAttendance(
  workDate: string,
  sessions: AttendanceSessionWithBreaks[],
  now: Date,
): DailyAttendanceSummary {
  const calculated = sessions
    .map((session) => calculateSession(session, now))
    .sort((left, right) => left.session.checkInAtUtc.getTime() - right.session.checkInAtUtc.getTime());
  const completed = calculated.filter((entry) => entry.session.state === "completed");
  const open = calculated.filter((entry) => entry.session.state === "open");
  const incomplete = calculated.filter((entry) => entry.session.state === "incomplete");
  const currentSession = open.at(-1) ?? null;

  return {
    workDate,
    sessions: calculated,
    completedSessionCount: completed.length,
    openSessionCount: open.length,
    incompleteSessionCount: incomplete.length,
    totalCompletedSessionSpanSeconds: completed.reduce(
      (total, entry) => total + (entry.sessionSpanSeconds ?? 0),
      0,
    ),
    totalCompletedBreakSeconds: calculated.reduce(
      (total, entry) => total + entry.completedBreakSeconds,
      0,
    ),
    totalWorkedSeconds: completed.reduce((total, entry) => total + (entry.workedSeconds ?? 0), 0),
    currentSessionWorkedSeconds: currentSession?.workedSeconds ?? 0,
    currentSession,
    hasOpenBreak: Boolean(currentSession?.hasOpenBreak),
    hasIncompleteState: incomplete.length > 0 || calculated.some((entry) => entry.hasIncompleteBreak),
  };
}

export function calculateTargetProgress(
  workedSeconds: number,
  targetMinutes: number,
): AttendanceTargetProgress {
  if (targetMinutes <= 0) {
    return { workedSeconds, targetMinutes, targetConfigured: false, progressPercent: null };
  }
  return {
    workedSeconds,
    targetMinutes,
    targetConfigured: true,
    progressPercent: Math.round((workedSeconds / (targetMinutes * 60)) * 10_000) / 100,
  };
}

export function calculatePeriodSummary(
  from: string,
  to: string,
  dailySummaries: DailyAttendanceSummary[],
  targetMinutes: number,
  approvedShortLeaveSeconds: number,
): AttendancePeriodSummary {
  const workedSeconds = dailySummaries.reduce((total, day) => total + day.totalWorkedSeconds, 0);
  return {
    from,
    to,
    workedSeconds,
    approvedShortLeaveSeconds,
    shortLeaveAffectsWorkedTime: false,
    target: calculateTargetProgress(workedSeconds, targetMinutes),
  };
}

function dateFromIso(value: string): Date {
  if (!isIsoDate(value)) throw new Error(`Invalid ISO date: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

export function addDays(value: string, days: number): string {
  const date = dateFromIso(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let current = from; current <= to; current = addDays(current, 1)) dates.push(current);
  return dates;
}

export function weekRange(anchorDate: string): { from: string; to: string } {
  const anchor = dateFromIso(anchorDate);
  const day = anchor.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const from = addDays(anchorDate, mondayOffset);
  return { from, to: addDays(from, 6) };
}

export function monthRange(anchorDate: string): { from: string; to: string } {
  const date = dateFromIso(anchorDate);
  const from = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const nextMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  nextMonth.setUTCDate(nextMonth.getUTCDate() - 1);
  return { from, to: nextMonth.toISOString().slice(0, 10) };
}

export function shortLeaveSeconds(leaveRequests: LeaveRequest[]): number {
  return leaveRequests
    .filter((request) => request.status === "approved" && request.leaveType === "short_hours")
    .reduce((total, request) => {
      if (!request.startTime || !request.endTime) return total;
      const parseTime = (value: string) => {
        const [hours, minutes, seconds = 0] = value.split(":").map(Number);
        return hours * 3600 + minutes * 60 + seconds;
      };
      return total + Math.max(0, parseTime(request.endTime) - parseTime(request.startTime));
    }, 0);
}

export function calculateCalendar(
  from: string,
  to: string,
  today: string,
  dailyByDate: Map<string, DailyAttendanceSummary>,
  holidays: Holiday[],
  approvedLeave: LeaveRequest[],
  now: Date,
  finalizedStatus?: FinalizedAttendanceStatus | Map<string, FinalizedAttendanceStatus>,
): CalendarDaySummary[] {
  const holidayByDate = new Map(holidays.map((holiday) => [holiday.holidayDate, holiday]));
  const leaveForDate = (date: string) => {
    const matching = approvedLeave.filter(
      (leave) => leave.status === "approved" && leave.startDate <= date && leave.endDate >= date,
    );
    return matching.find((leave) => leave.leaveType === "full_day") ?? matching[0] ?? null;
  };

  return enumerateDates(from, to).map((date) => {
    const attendance = dailyByDate.get(date) ?? calculateDailyAttendance(date, [], now);
    const holiday = holidayByDate.get(date) ?? null;
    const leave = leaveForDate(date);
    let status: CalendarDaySummary["status"];

    if (holiday) status = "holiday";
    else if (leave?.leaveType === "full_day") status = "leave";
    else if (leave?.leaveType === "short_hours") status = "short_leave";
    else if (date > today) status = "future";
    else if (date < today) {
      const storedStatus = finalizedStatus instanceof Map ? finalizedStatus.get(date) : finalizedStatus;
      status = storedStatus ?? (attendance.completedSessionCount > 0 && !attendance.hasIncompleteState && attendance.openSessionCount === 0
        ? "present"
        : "absent");
    }
    else if (attendance.openSessionCount > 0) status = "pending";
    else if (attendance.hasIncompleteState) status = "incomplete";
    else if (attendance.completedSessionCount > 0) status = "present";
    else status = "absent";

    return {
      date,
      status,
      holiday: holiday ? { id: holiday.id, name: holiday.name } : null,
      approvedLeave: leave
        ? {
            id: leave.id,
            leaveType: leave.leaveType,
            startTime: leave.startTime,
            endTime: leave.endTime,
          }
        : null,
      attendance,
    };
  });
}
