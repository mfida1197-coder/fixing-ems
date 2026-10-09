export type LeaveType = "full_day" | "short_hours";
export type LeaveStatus = "pending" | "approved" | "rejected";

export type LeaveRequest = {
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
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LeaveRequestInput = {
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
};

export type Holiday = {
  id: number;
  holidayDate: string;
  name: string;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
};
