import { api, ApiError, BASE } from "./api";
import type {
  AttendanceReportData,
  AttendanceReportEmployeeOption,
  AttendanceReportFilters,
} from "../types/attendanceReports";

function queryString(filters: AttendanceReportFilters, page?: number, pageSize?: number): string {
  const query = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.employeeId !== null) query.set("employeeId", String(filters.employeeId));
  if (filters.attendanceMode !== null) query.set("attendanceMode", filters.attendanceMode);
  if (filters.attendanceStatus !== null) query.set("attendanceStatus", filters.attendanceStatus);
  if (filters.employmentStatus !== null) query.set("employmentStatus", filters.employmentStatus);
  if (page !== undefined) query.set("page", String(page));
  if (pageSize !== undefined) query.set("pageSize", String(pageSize));
  return query.toString();
}

export function getAttendanceReportOptions(): Promise<{ employees: AttendanceReportEmployeeOption[] }> {
  return api("/api/attendance/reports/options");
}

export function getAttendanceReport(
  filters: AttendanceReportFilters,
  page = 1,
  pageSize = 25,
): Promise<AttendanceReportData> {
  return api(`/api/attendance/reports/preview?${queryString(filters, page, pageSize)}`);
}

export async function downloadAttendanceReport(filters: AttendanceReportFilters): Promise<string> {
  const token = sessionStorage.getItem("ems_token");
  const response = await fetch(`${BASE}/api/attendance/reports/attendance.pdf?${queryString(filters)}`, {
    headers: { Authorization: `Bearer ${token ?? ""}` },
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message = typeof payload === "object" && payload !== null && "error" in payload
      && typeof (payload as { error?: unknown }).error === "string"
      ? String((payload as { error: string }).error)
      : "Attendance report could not be downloaded.";
    throw new ApiError(message, response.status);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const matched = /filename="([^"]+)"/.exec(disposition);
  const filename = matched?.[1] ?? `attendance-report-${filters.from}-to-${filters.to}.pdf`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return filename;
}

