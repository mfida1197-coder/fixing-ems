import type {
  AttendanceDayStatus,
  AttendanceHistory,
  AttendanceMode,
  AttendancePeriodSummary,
  AttendanceSummary,
  DailyAttendanceSummary,
} from "./attendance";

export type AttendanceEmployeeLiveState = "working" | "on_break" | AttendanceDayStatus;

export type AttendanceEmployeeDirectoryRow = {
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
};

export type AttendanceEmployeeDirectory = {
  timezone: string;
  today: string;
  selectedDate: string;
  generatedAtUtc: string;
  organizationGpsConfigured: boolean;
  employees: AttendanceEmployeeDirectoryRow[];
};

export type EmployeeAttendanceSettings = {
  employeeId: number;
  attendanceMode: AttendanceMode;
  weeklyTargetMinutes: number;
  monthlyTargetMinutes: number;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationAttendanceSettings = {
  id: 1;
  officeTimezone: string;
  officeLatitude: number | null;
  officeLongitude: number | null;
  allowedRadiusMeters: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
};

export type AttendanceEmployeeProfileOverview = {
  selectedDate: string;
  selectedDay: DailyAttendanceSummary;
  settings: EmployeeAttendanceSettings;
  organizationSettings: OrganizationAttendanceSettings;
  summary: AttendanceSummary;
};

export type CanonicalEmployeeDetail = {
  id: number;
  employee_code: string;
  full_name: string;
  father_name: string | null;
  email: string | null;
  phone: string | null;
  designation: string;
  department_id: number | null;
  joining_date: string;
  leaving_date: string | null;
  employment_type: string;
  status: string;
  salary_currency: string;
  basic_salary: number | null;
  allowances: number | null;
  deductions: number | null;
  cnic: string | null;
  address: string | null;
  bank_name: string | null;
  bank_account: string | null;
  assigned_project: string | null;
  assigned_role: string | null;
  system_role: string | null;
};

export type EmployeeAttendanceProfileData = {
  overview: AttendanceEmployeeProfileOverview;
  employee: CanonicalEmployeeDetail;
  history: AttendanceHistory;
};
