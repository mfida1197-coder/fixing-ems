import { api } from "./api";
import type {
  AttendanceActionResult,
  AttendanceCalendar,
  AttendanceCurrentState,
  AttendanceHistory,
  AttendanceSummary,
  GpsCoordinates,
} from "../types/attendance";

export type AttendanceAction = "check-in" | "break-out" | "break-in" | "check-out";

export function getCurrentAttendance() {
  return api<AttendanceCurrentState>("/api/attendance/me/current");
}

export function getAttendanceHistory(from: string, to: string) {
  return api<AttendanceHistory>(
    `/api/attendance/me/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
}

export function getAttendanceCalendar(from: string, to: string) {
  return api<AttendanceCalendar>(
    `/api/attendance/me/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
}

export function getAttendanceSummary(date: string) {
  return api<AttendanceSummary>(`/api/attendance/me/summary?date=${encodeURIComponent(date)}`);
}

export function submitAttendanceAction(action: AttendanceAction, coordinates?: GpsCoordinates) {
  return api<AttendanceActionResult>(`/api/attendance/me/${action}`, {
    method: "POST",
    body: JSON.stringify(coordinates ? { coordinates } : {}),
  });
}
