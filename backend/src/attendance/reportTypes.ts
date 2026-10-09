import { AttendanceDayStatus, AttendanceMode, AttendanceRecordState, LeaveType } from "./types";

export type ReportEmploymentStatus = "active" | "resigned" | "terminated";

export interface AttendanceReportFilters {
  from: string;
  to: string;
  employeeId: number | null;
  attendanceMode: AttendanceMode | null;
  attendanceStatus: AttendanceDayStatus | null;
  employmentStatus: ReportEmploymentStatus | null;
}

export interface AttendanceReportBreakDetail {
  id: number;
  state: AttendanceRecordState;
  breakOutAtUtc: string;
  breakInAtUtc: string | null;
  completedBreakSeconds: number | null;
}

export interface AttendanceReportSessionDetail {
  id: number;
  sessionNumber: number;
  attendanceMode: AttendanceMode;
  state: AttendanceRecordState;
  checkInAtUtc: string;
  checkOutAtUtc: string | null;
  verifiedWorkedSeconds: number | null;
  completedBreakSeconds: number;
  breaks: AttendanceReportBreakDetail[];
}

export interface AttendanceReportEmployeeDay {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  designation: string;
  employmentStatus: ReportEmploymentStatus;
  attendanceMode: AttendanceMode;
  workDate: string;
  attendanceStatus: AttendanceDayStatus;
  attendanceStatusLabel: string;
  sessionCount: number;
  verifiedWorkedSeconds: number;
  completedBreakSeconds: number;
  holidayName: string | null;
  approvedLeave: {
    leaveType: LeaveType;
    startTime: string | null;
    endTime: string | null;
  } | null;
  sessions: AttendanceReportSessionDetail[];
}

export interface AttendanceReportSummary {
  employeesIncluded: number;
  employeeDays: number;
  presentEmployeeDays: number;
  absentEmployeeDays: number;
  leaveEmployeeDays: number;
  shortLeaveEmployeeDays: number;
  holidayEmployeeDays: number;
  incompleteEmployeeDays: number;
  pendingEmployeeDays: number;
  futureEmployeeDays: number;
  totalVerifiedWorkedSeconds: number;
  totalCompletedBreakSeconds: number;
}

export interface AttendanceReportResult {
  employeeSections: AttendanceReportEmployeeSection[];
  reportTitle: "Attendance Report";
  timezone: "Asia/Karachi";
  generatedAtUtc: string;
  filters: AttendanceReportFilters;
  summary: AttendanceReportSummary;
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  rows: AttendanceReportEmployeeDay[];
}

export interface AttendanceReportEmployeeSection {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  designation: string;
  attendanceMode: AttendanceMode;
  weeklyRequiredMinutes: number | null;
  monthlyRequiredMinutes: number | null;
  days: AttendanceReportEmployeeDay[];
  summary: AttendanceReportSummary;
}

export interface AttendanceReportEmployeeOption {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  designation: string;
  employmentStatus: ReportEmploymentStatus;
  attendanceMode: AttendanceMode;
}

