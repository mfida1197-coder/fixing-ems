export const ATTENDANCE_TIME_ZONE = "Asia/Karachi" as const;

export type AttendanceMode = "gps" | "remote";
export type AttendanceRecordState = "open" | "completed" | "incomplete";
export type LeaveType = "full_day" | "short_hours";
export type LeaveStatus = "pending" | "approved" | "rejected";
export type AttendanceDayStatus =
  | "future"
  | "holiday"
  | "leave"
  | "short_leave"
  | "present"
  | "pending"
  | "incomplete"
  | "absent";

export interface OrganizationAttendanceSettings {
  id: 1;
  officeTimezone: string;
  officeLatitude: number | null;
  officeLongitude: number | null;
  allowedRadiusMeters: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeeAttendanceSettings {
  employeeId: number;
  attendanceMode: AttendanceMode;
  weeklyTargetMinutes: number;
  monthlyTargetMinutes: number;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttendanceSession {
  id: number;
  employeeId: number;
  workDate: string;
  timezoneName: string;
  attendanceMode: AttendanceMode;
  state: AttendanceRecordState;
  checkInAtUtc: Date;
  checkOutAtUtc: Date | null;
  incompleteReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttendanceBreak {
  id: number;
  attendanceSessionId: number;
  state: AttendanceRecordState;
  breakOutAtUtc: Date;
  breakInAtUtc: Date | null;
  incompleteReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Holiday {
  id: number;
  holidayDate: string;
  name: string;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeaveRequest {
  id: number;
  employeeId: number;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  timezoneName: string;
  reason: string | null;
  status: LeaveStatus;
  requestedBy: number | null;
  reviewedBy: number | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationAttendanceSettingsInput {
  officeTimezone: string;
  officeLatitude: number | null;
  officeLongitude: number | null;
  allowedRadiusMeters: number | null;
}

export interface EmployeeAttendanceSettingsInput {
  attendanceMode: AttendanceMode;
  weeklyTargetMinutes: number;
  monthlyTargetMinutes: number;
}

export interface LeaveRequestInput {
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
}

export interface GpsCoordinates {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
}

export interface GpsValidationResult {
  withinAllowedRadius: boolean;
  distanceMeters: number;
  allowedRadiusMeters: number;
}

export interface AttendanceSessionWithBreaks extends AttendanceSession {
  breaks: AttendanceBreak[];
}

export interface AttendanceSessionCalculation {
  session: AttendanceSessionWithBreaks;
  sessionSpanSeconds: number | null;
  completedBreakSeconds: number;
  activeBreakElapsedSeconds: number;
  workedSeconds: number | null;
  hasOpenBreak: boolean;
  hasIncompleteBreak: boolean;
}

export interface DailyAttendanceSummary {
  workDate: string;
  sessions: AttendanceSessionCalculation[];
  completedSessionCount: number;
  openSessionCount: number;
  incompleteSessionCount: number;
  totalCompletedSessionSpanSeconds: number;
  totalCompletedBreakSeconds: number;
  totalWorkedSeconds: number;
  currentSessionWorkedSeconds: number;
  currentSession: AttendanceSessionCalculation | null;
  hasOpenBreak: boolean;
  hasIncompleteState: boolean;
}

export interface AttendanceTargetProgress {
  workedSeconds: number;
  targetMinutes: number;
  targetConfigured: boolean;
  progressPercent: number | null;
}

export interface AttendancePeriodSummary {
  from: string;
  to: string;
  workedSeconds: number;
  approvedShortLeaveSeconds: number;
  shortLeaveAffectsWorkedTime: false;
  target: AttendanceTargetProgress;
}

export interface CalendarDaySummary {
  date: string;
  status: AttendanceDayStatus;
  holiday: { id: number; name: string } | null;
  approvedLeave: {
    id: number;
    leaveType: LeaveType;
    startTime: string | null;
    endTime: string | null;
  } | null;
  attendance: DailyAttendanceSummary;
}
