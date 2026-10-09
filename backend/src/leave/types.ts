import { LeaveStatus, LeaveType } from "../attendance/types";

export interface LeaveRequestView {
  id: number;
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  employeeDesignation: string;
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
  reviewerName: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface HolidayView {
  id: number;
  holidayDate: string;
  name: string;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeaveListFilters {
  status?: LeaveStatus;
  leaveType?: LeaveType;
  employeeId?: number;
  from?: string;
  to?: string;
}
