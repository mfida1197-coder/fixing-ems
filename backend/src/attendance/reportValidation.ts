import { AttendanceError } from "./errors";
import { addDays } from "./calculations";
import { AttendanceDayStatus, AttendanceMode } from "./types";
import { isIsoDate } from "./validation";
import { AttendanceReportFilters, ReportEmploymentStatus } from "./reportTypes";

export const MAX_ATTENDANCE_REPORT_DAYS = 366;
export const MAX_ATTENDANCE_REPORT_PAGE_SIZE = 100;

const ATTENDANCE_STATUSES: AttendanceDayStatus[] = [
  "future", "holiday", "leave", "short_leave", "present", "pending", "incomplete", "absent",
];
const ATTENDANCE_MODES: AttendanceMode[] = ["gps", "remote"];
const EMPLOYMENT_STATUSES: ReportEmploymentStatus[] = ["active", "resigned", "terminated"];

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T | null {
  if (value === undefined || value === null || value === "" || value === "all") return null;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new AttendanceError(400, "INVALID_REPORT_FILTER", `${field} is not supported`);
  }
  return value as T;
}

function positiveInteger(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new AttendanceError(400, "INVALID_REPORT_PAGINATION", `${field} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

export function validateAttendanceReportQuery(query: Record<string, unknown>): {
  filters: AttendanceReportFilters;
  page: number;
  pageSize: number;
} {
  const from = typeof query.from === "string" ? query.from : "";
  const to = typeof query.to === "string" ? query.to : "";
  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new AttendanceError(400, "INVALID_DATE_RANGE", "from and to must be valid YYYY-MM-DD dates");
  }
  if (from > to) throw new AttendanceError(400, "INVALID_DATE_RANGE", "from must not be after to");
  if (addDays(from, MAX_ATTENDANCE_REPORT_DAYS - 1) < to) {
    throw new AttendanceError(
      400,
      "DATE_RANGE_TOO_LARGE",
      `Attendance reports are limited to ${MAX_ATTENDANCE_REPORT_DAYS} days`,
    );
  }

  let employeeId: number | null = null;
  if (query.employeeId !== undefined && query.employeeId !== null && query.employeeId !== "" && query.employeeId !== "all") {
    const parsed = Number(query.employeeId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new AttendanceError(400, "INVALID_EMPLOYEE_ID", "employeeId must be a positive integer");
    }
    employeeId = parsed;
  }

  return {
    filters: {
      from,
      to,
      employeeId,
      attendanceMode: optionalEnum(query.attendanceMode, ATTENDANCE_MODES, "attendanceMode"),
      attendanceStatus: optionalEnum(query.attendanceStatus, ATTENDANCE_STATUSES, "attendanceStatus"),
      employmentStatus: optionalEnum(query.employmentStatus, EMPLOYMENT_STATUSES, "employmentStatus"),
    },
    page: positiveInteger(query.page, 1, 1_000_000, "page"),
    pageSize: positiveInteger(query.pageSize, 25, MAX_ATTENDANCE_REPORT_PAGE_SIZE, "pageSize"),
  };
}

