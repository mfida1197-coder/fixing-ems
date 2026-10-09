import type { AdminAttendanceStatus, AttendanceOverviewPeriod } from "../types/attendanceDashboard";

export const ATTENDANCE_PERIODS: Array<{ value: AttendanceOverviewPeriod; label: string }> = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 60, label: "Last 60 days" },
  { value: 180, label: "Last 6 months" },
];

export const ATTENDANCE_STATUS_COLORS: Record<AdminAttendanceStatus, string> = {
  present: "#10b981",
  absent: "#ef4444",
  leave: "#3b82f6",
  short_leave: "#a855f7",
  holiday: "#f59e0b",
  incomplete: "#dc2626",
  pending: "#ff7a1a",
  future: "#94a3b8",
};
