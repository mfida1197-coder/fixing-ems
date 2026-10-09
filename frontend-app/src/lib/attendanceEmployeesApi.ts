import { api } from "./api";
import type { AttendanceCalendar, AttendanceHistory, AttendanceSummary } from "../types/attendance";
import type {
  AttendanceEmployeeDirectory,
  AttendanceEmployeeProfileOverview,
  CanonicalEmployeeDetail,
  EmployeeAttendanceSettings,
  OrganizationAttendanceSettings,
} from "../types/attendanceEmployees";
import type { LeaveRequest } from "../types/leave";

export function getAttendanceEmployees(date: string) {
  return api<AttendanceEmployeeDirectory>(
    `/api/attendance/employees?date=${encodeURIComponent(date)}`,
  );
}

export function getAttendanceEmployeeOverview(employeeId: number, date: string) {
  return api<AttendanceEmployeeProfileOverview>(
    `/api/attendance/employees/${employeeId}/profile?date=${encodeURIComponent(date)}`,
  );
}

export function getAdminEmployeeHistory(employeeId: number, from: string, to: string) {
  return api<AttendanceHistory>(
    `/api/attendance/employees/${employeeId}/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
}

export function getAdminEmployeeCalendar(employeeId: number, from: string, to: string) {
  return api<AttendanceCalendar>(
    `/api/attendance/employees/${employeeId}/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
}

export function getAdminEmployeeSummary(employeeId: number, date: string) {
  return api<AttendanceSummary>(
    `/api/attendance/employees/${employeeId}/summary?date=${encodeURIComponent(date)}`,
  );
}

export function getEmployeeLeaveHistory(employeeId: number) {
  return api<{ requests: LeaveRequest[] }>(`/api/leaves?employeeId=${employeeId}`);
}

export function getCanonicalEmployeeDetail(employeeId: number) {
  return api<{ employee: CanonicalEmployeeDetail }>(`/api/employees/${employeeId}`);
}

export function updateAttendanceEmployeeSettings(
  employeeId: number,
  input: { attendanceMode: "gps" | "remote"; weeklyTargetMinutes: number; monthlyTargetMinutes: number },
) {
  return api<EmployeeAttendanceSettings>(`/api/attendance/employees/${employeeId}/settings`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function getOrganizationAttendanceSettings() {
  return api<OrganizationAttendanceSettings>("/api/attendance/settings/organization");
}

export function updateOrganizationAttendanceSettings(input: {
  officeLatitude: number | null;
  officeLongitude: number | null;
  allowedRadiusMeters: number | null;
}) {
  return api<OrganizationAttendanceSettings>("/api/attendance/settings/organization", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
