export type AdminAttendanceStatus =
  | "present" | "absent" | "leave" | "short_leave" | "holiday"
  | "incomplete" | "pending" | "future";

export type AttendanceOverviewPeriod = 7 | 30 | 60 | 180;

export interface AttendanceStatusCount {
  status: AdminAttendanceStatus;
  label: string;
  count: number;
  percentage: number;
}

export interface AttendanceOverviewBucket {
  from: string;
  to: string;
  label: string;
  present: number;
  absent: number;
  leave: number;
  shortLeave: number;
  holiday: number;
  incomplete: number;
  pending: number;
}

export interface AttendanceTimelineSegment { startMinute: number; endMinute: number }
export interface AttendanceTimelineBreak extends AttendanceTimelineSegment {
  id: number;
  state: "open" | "completed" | "incomplete";
}
export interface AttendanceTimelineSession {
  id: number;
  sessionNumber: number;
  attendanceMode: "remote" | "gps";
  state: "open" | "completed" | "incomplete";
  checkInAtUtc: string;
  checkOutAtUtc: string | null;
  workedSeconds: number | null;
  completedBreakSeconds: number;
  workingSegments: AttendanceTimelineSegment[];
  breaks: AttendanceTimelineBreak[];
}
export interface AttendanceTimelineEmployee {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  designation: string;
  attendanceMode: "remote" | "gps";
  status: AdminAttendanceStatus;
  statusLabel: string;
  sessions: AttendanceTimelineSession[];
}

export interface AdminAttendanceDashboardData {
  timezone: "Asia/Karachi";
  today: string;
  selectedDate: string;
  generatedAtUtc: string;
  kpis: { totalEmployees: number; todayPresent: number; todayAbsent: number; pendingLeave: number };
  teamStatus: { totalEmployees: number; statuses: AttendanceStatusCount[] };
  overview: {
    periodDays: AttendanceOverviewPeriod;
    from: string;
    to: string;
    bucketUnit: "day" | "week" | "month";
    buckets: AttendanceOverviewBucket[];
  };
  timeline: {
    totalCheckIns: number;
    totalCheckOuts: number;
    activeEmployees: number;
    employees: AttendanceTimelineEmployee[];
  };
}
