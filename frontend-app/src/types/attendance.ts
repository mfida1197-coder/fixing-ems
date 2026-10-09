export type AttendanceMode = "gps" | "remote";
export type AttendanceRecordState = "open" | "completed" | "incomplete";
export type AttendanceDayStatus =
  | "future"
  | "holiday"
  | "leave"
  | "short_leave"
  | "present"
  | "pending"
  | "incomplete"
  | "absent";

export type AttendanceBreak = {
  id: number;
  attendanceSessionId: number;
  state: AttendanceRecordState;
  breakOutAtUtc: string;
  breakInAtUtc: string | null;
  incompleteReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AttendanceSession = {
  id: number;
  employeeId: number;
  workDate: string;
  timezoneName: string;
  attendanceMode: AttendanceMode;
  state: AttendanceRecordState;
  checkInAtUtc: string;
  checkOutAtUtc: string | null;
  incompleteReason: string | null;
  createdAt: string;
  updatedAt: string;
  breaks: AttendanceBreak[];
};

export type AttendanceSessionCalculation = {
  session: AttendanceSession;
  sessionSpanSeconds: number | null;
  completedBreakSeconds: number;
  activeBreakElapsedSeconds: number;
  workedSeconds: number | null;
  hasOpenBreak: boolean;
  hasIncompleteBreak: boolean;
};

export type DailyAttendanceSummary = {
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
};

export type AttendanceCurrentState = {
  attendanceMode: AttendanceMode;
  today: DailyAttendanceSummary;
  currentSession: AttendanceSessionCalculation | null;
  unresolvedPreviousSession: boolean;
};

export type AttendanceTargetProgress = {
  workedSeconds: number;
  targetMinutes: number;
  targetConfigured: boolean;
  progressPercent: number | null;
};

export type AttendancePeriodSummary = {
  from: string;
  to: string;
  workedSeconds: number;
  approvedShortLeaveSeconds: number;
  shortLeaveAffectsWorkedTime: false;
  target: AttendanceTargetProgress;
};

export type AttendanceSummary = {
  asOfWorkDate: string;
  weekly: AttendancePeriodSummary;
  monthly: AttendancePeriodSummary;
};

export type AttendanceHistory = {
  from: string;
  to: string;
  days: DailyAttendanceSummary[];
};

export type CalendarDaySummary = {
  date: string;
  status: AttendanceDayStatus;
  holiday: { id: number; name: string } | null;
  approvedLeave: {
    id: number;
    leaveType: "full_day" | "short_hours";
    startTime: string | null;
    endTime: string | null;
  } | null;
  attendance: DailyAttendanceSummary;
};

export type AttendanceCalendar = {
  from: string;
  to: string;
  days: CalendarDaySummary[];
};

export type GpsCoordinates = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
};

export type AttendanceActionResult = {
  action: "check_in" | "break_out" | "break_in" | "check_out";
  occurredAtUtc: string;
  session: AttendanceSession;
  gps: {
    validated: boolean;
    withinAllowedRadius: boolean;
    distanceMeters: number;
    allowedRadiusMeters: number;
  } | null;
};
