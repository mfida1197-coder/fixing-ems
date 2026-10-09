import { api } from "./api";
import type { AdminAttendanceDashboardData, AttendanceOverviewPeriod } from "../types/attendanceDashboard";

export function getAttendanceDashboard(date: string, period: AttendanceOverviewPeriod) {
  const query = new URLSearchParams({ date, period: String(period) });
  return api<AdminAttendanceDashboardData>(`/api/attendance/dashboard?${query}`);
}
