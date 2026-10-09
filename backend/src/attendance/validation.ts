import {
  AttendanceMode,
  EmployeeAttendanceSettingsInput,
  GpsCoordinates,
  LeaveRequestInput,
  OrganizationAttendanceSettingsInput,
} from "./types";
import { isValidTimeZone } from "./time";

export type ValidationResult = { valid: true } | { valid: false; errors: string[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
export const MAX_OFFICE_RADIUS_METERS = 100_000;
export const MAX_WEEKLY_TARGET_MINUTES = 7 * 24 * 60;
export const MAX_MONTHLY_TARGET_MINUTES = 31 * 24 * 60;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
  );
}

export function isLocalTime(value: string): boolean {
  return LOCAL_TIME.test(value);
}

export function validateOrganizationAttendanceSettings(
  input: OrganizationAttendanceSettingsInput,
): ValidationResult {
  const errors: string[] = [];
  const { officeLatitude, officeLongitude, allowedRadiusMeters, officeTimezone } = input;
  const locationValues = [officeLatitude, officeLongitude, allowedRadiusMeters];
  const configuredCount = locationValues.filter((value) => value !== null).length;

  if (!isValidTimeZone(officeTimezone)) errors.push("officeTimezone must be a valid IANA timezone");
  if (configuredCount !== 0 && configuredCount !== 3) {
    errors.push("officeLatitude, officeLongitude, and allowedRadiusMeters must be configured together");
  }
  if (officeLatitude !== null && (!Number.isFinite(officeLatitude) || officeLatitude < -90 || officeLatitude > 90)) {
    errors.push("officeLatitude must be between -90 and 90");
  }
  if (officeLongitude !== null && (!Number.isFinite(officeLongitude) || officeLongitude < -180 || officeLongitude > 180)) {
    errors.push("officeLongitude must be between -180 and 180");
  }
  if (
    allowedRadiusMeters !== null
    && (!Number.isFinite(allowedRadiusMeters) || allowedRadiusMeters <= 0 || allowedRadiusMeters > MAX_OFFICE_RADIUS_METERS)
  ) {
    errors.push(`allowedRadiusMeters must be greater than zero and no more than ${MAX_OFFICE_RADIUS_METERS}`);
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function validateGpsCoordinates(input: GpsCoordinates): ValidationResult {
  const errors: string[] = [];
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
    errors.push("latitude must be between -90 and 90");
  }
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    errors.push("longitude must be between -180 and 180");
  }
  if (
    input.accuracyMeters !== undefined
    && input.accuracyMeters !== null
    && (!Number.isFinite(input.accuracyMeters) || input.accuracyMeters < 0)
  ) {
    errors.push("accuracyMeters must be a non-negative number when provided");
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function validateEmployeeAttendanceSettings(
  input: EmployeeAttendanceSettingsInput,
): ValidationResult {
  const errors: string[] = [];
  const allowedModes: AttendanceMode[] = ["gps", "remote"];
  if (!allowedModes.includes(input.attendanceMode)) errors.push("attendanceMode must be gps or remote");
  if (
    !Number.isInteger(input.weeklyTargetMinutes)
    || input.weeklyTargetMinutes < 0
    || input.weeklyTargetMinutes > MAX_WEEKLY_TARGET_MINUTES
  ) {
    errors.push(`weeklyTargetMinutes must be an integer between 0 and ${MAX_WEEKLY_TARGET_MINUTES}`);
  }
  if (
    !Number.isInteger(input.monthlyTargetMinutes)
    || input.monthlyTargetMinutes < 0
    || input.monthlyTargetMinutes > MAX_MONTHLY_TARGET_MINUTES
  ) {
    errors.push(`monthlyTargetMinutes must be an integer between 0 and ${MAX_MONTHLY_TARGET_MINUTES}`);
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function validateLeaveRequest(input: LeaveRequestInput): ValidationResult {
  const errors: string[] = [];
  if (!isIsoDate(input.startDate)) errors.push("startDate must be a valid YYYY-MM-DD date");
  if (!isIsoDate(input.endDate)) errors.push("endDate must be a valid YYYY-MM-DD date");
  if (isIsoDate(input.startDate) && isIsoDate(input.endDate) && input.endDate < input.startDate) {
    errors.push("endDate must not be before startDate");
  }

  const startTime = input.startTime || null;
  const endTime = input.endTime || null;
  if (input.leaveType === "full_day") {
    if (startTime !== null || endTime !== null) errors.push("full-day leave must not include start or end times");
  } else if (input.leaveType === "short_hours") {
    if (input.startDate !== input.endDate) errors.push("short-hours leave must start and end on the same date");
    if (!startTime || !isLocalTime(startTime)) errors.push("short-hours leave requires a valid startTime");
    if (!endTime || !isLocalTime(endTime)) errors.push("short-hours leave requires a valid endTime");
    if (startTime && endTime && isLocalTime(startTime) && isLocalTime(endTime) && endTime <= startTime) {
      errors.push("short-hours leave endTime must be after startTime");
    }
  } else {
    errors.push("leaveType must be full_day or short_hours");
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
