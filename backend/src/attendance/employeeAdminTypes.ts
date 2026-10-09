import {
  AttendanceDayStatus,
  AttendanceMode,
  AttendancePeriodSummary,
  DailyAttendanceSummary,
  EmployeeAttendanceSettings,
  OrganizationAttendanceSettings,
} from "./types";

export type AttendanceEmployeeLiveState =
  | "working"
  | "on_break"
  | AttendanceDayStatus;

export interface AttendanceEmployeeDirectoryRow {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  designation: string;
  employmentStatus: "active" | "resigned" | "terminated";
  employmentType: "full_time" | "part_time" | "contract" | "intern";
  department: string | null;
  assignedProject: string | null;
  assignedRole: string | null;
  systemRole: string | null;
  accountActive: boolean | null;
  attendanceMode: AttendanceMode;
  attendanceState: AttendanceEmployeeLiveState;
  attendanceStateLabel: string;
  selectedDateWorkedSeconds: number;
  weekly: AttendancePeriodSummary;
  hasAttendanceHistory: boolean;
}

export interface AttendanceEmployeeDirectoryResult {
  timezone: string;
  today: string;
  selectedDate: string;
  generatedAtUtc: Date;
  organizationGpsConfigured: boolean;
  employees: AttendanceEmployeeDirectoryRow[];
}

export interface AttendanceEmployeeProfileOverview {
  selectedDate: string;
  selectedDay: DailyAttendanceSummary;
  settings: EmployeeAttendanceSettings;
  organizationSettings: OrganizationAttendanceSettings;
  summary: {
    asOfWorkDate: string;
    weekly: AttendancePeriodSummary;
    monthly: AttendancePeriodSummary;
  };
}
