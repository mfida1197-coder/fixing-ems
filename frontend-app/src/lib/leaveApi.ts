import { api } from "./api";
import type { Holiday, LeaveRequest, LeaveRequestInput, LeaveStatus, LeaveType } from "../types/leave";

export function getMyLeaveRequests() {
  return api<{ requests: LeaveRequest[] }>("/api/leaves/me");
}

export function createMyLeaveRequest(input: LeaveRequestInput) {
  return api<LeaveRequest>("/api/leaves/me", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type LeaveManagementFilters = {
  status?: LeaveStatus | "all";
  leaveType?: LeaveType | "all";
};

export function getManagedLeaveRequests(filters: LeaveManagementFilters = {}) {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.leaveType && filters.leaveType !== "all") params.set("leaveType", filters.leaveType);
  const query = params.toString();
  return api<{ requests: LeaveRequest[] }>(`/api/leaves${query ? `?${query}` : ""}`);
}

export function decideLeaveRequest(id: number, decision: "approve" | "reject") {
  return api<LeaveRequest>(`/api/leaves/${id}/${decision}`, { method: "PATCH" });
}

export function getHolidays() {
  return api<{ holidays: Holiday[] }>("/api/holidays");
}

export function createHoliday(input: { holidayDate: string; name: string }) {
  return api<Holiday>("/api/holidays", { method: "POST", body: JSON.stringify(input) });
}

export function updateHoliday(id: number, input: { holidayDate: string; name: string }) {
  return api<Holiday>(`/api/holidays/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteHoliday(id: number) {
  return api<{ deleted: Holiday }>(`/api/holidays/${id}`, { method: "DELETE" });
}
