import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { audit } from "../audit";
import { pool } from "../db";
import { AttendanceError } from "./errors";
import {
  ATTENDANCE_TIME_ZONE,
  AttendanceMode,
  EmployeeAttendanceSettings,
  OrganizationAttendanceSettings,
  EmployeeAttendanceSettingsInput,
  OrganizationAttendanceSettingsInput,
} from "./types";
import { validateEmployeeAttendanceSettings, validateOrganizationAttendanceSettings } from "./validation";

interface OrganizationSettingsRow extends RowDataPacket {
  id: 1;
  office_timezone: string;
  office_latitude: number | null;
  office_longitude: number | null;
  allowed_radius_meters: number | null;
  updated_by: number | null;
  created_at: Date;
  updated_at: Date;
}

interface EmployeeSettingsRow extends RowDataPacket {
  employee_id: number;
  attendance_mode: AttendanceMode;
  weekly_target_minutes: number;
  monthly_target_minutes: number;
  updated_by: number | null;
  created_at: Date;
  updated_at: Date;
}

export async function getOrganizationAttendanceSettings(): Promise<OrganizationAttendanceSettings> {
  const [rows] = await pool.execute<OrganizationSettingsRow[]>(
    `SELECT id, office_timezone, office_latitude, office_longitude,
            allowed_radius_meters, updated_by, created_at, updated_at
     FROM organization_attendance_settings
     WHERE id = 1
     LIMIT 1`,
  );
  const row = rows[0];
  if (!row) throw new Error("Organization attendance settings are not initialized");
  return {
    id: 1,
    officeTimezone: row.office_timezone,
    officeLatitude: row.office_latitude,
    officeLongitude: row.office_longitude,
    allowedRadiusMeters: row.allowed_radius_meters,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureEmployeeAttendanceSettings(employeeId: number): Promise<void> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT IGNORE INTO employee_attendance_settings
       (employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes)
     VALUES (?, 'remote', 0, 0)`,
    [employeeId],
  );
  if (result.affectedRows > 1) {
    throw new Error("Unexpected employee attendance settings result");
  }
}

export async function getEmployeeAttendanceSettings(
  employeeId: number,
): Promise<EmployeeAttendanceSettings> {
  await ensureEmployeeAttendanceSettings(employeeId);
  const [rows] = await pool.execute<EmployeeSettingsRow[]>(
    `SELECT employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes,
            updated_by, created_at, updated_at
     FROM employee_attendance_settings
     WHERE employee_id = ?
     LIMIT 1`,
    [employeeId],
  );
  const row = rows[0];
  if (!row) throw new Error("Employee attendance settings could not be initialized");
  return {
    employeeId: row.employee_id,
    attendanceMode: row.attendance_mode,
    weeklyTargetMinutes: row.weekly_target_minutes,
    monthlyTargetMinutes: row.monthly_target_minutes,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function requireConfiguredOfficeLocation(settings: OrganizationAttendanceSettings) {
  if (
    settings.officeLatitude === null
    || settings.officeLongitude === null
    || settings.allowedRadiusMeters === null
  ) {
    throw new Error("Office attendance location is not configured");
  }
  return {
    latitude: settings.officeLatitude,
    longitude: settings.officeLongitude,
    radiusMeters: settings.allowedRadiusMeters,
    timeZone: settings.officeTimezone || ATTENDANCE_TIME_ZONE,
  };
}

export async function updateEmployeeAttendanceSettings(
  employeeId: number,
  input: EmployeeAttendanceSettingsInput,
  actorId: number,
  ip: string | null,
): Promise<EmployeeAttendanceSettings> {
  const validation = validateEmployeeAttendanceSettings(input);
  if (!validation.valid) {
    throw new AttendanceError(400, "INVALID_ATTENDANCE_SETTINGS", "Employee attendance settings are invalid", {
      errors: validation.errors,
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [employees] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM employees WHERE id = ? LIMIT 1 FOR UPDATE",
      [employeeId],
    );
    if (!employees[0]) throw new AttendanceError(404, "EMPLOYEE_NOT_FOUND", "Employee record was not found");
    await connection.execute<ResultSetHeader>(
      `INSERT IGNORE INTO employee_attendance_settings
         (employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes)
       VALUES (?, 'remote', 0, 0)`,
      [employeeId],
    );
    const [beforeRows] = await connection.execute<EmployeeSettingsRow[]>(
      `SELECT employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes,
              updated_by, created_at, updated_at
       FROM employee_attendance_settings WHERE employee_id = ? LIMIT 1 FOR UPDATE`,
      [employeeId],
    );
    const before = beforeRows[0];
    if (!before) throw new AttendanceError(409, "ATTENDANCE_SETTINGS_MISSING", "Attendance settings could not be initialized");
    await connection.execute<ResultSetHeader>(
      `UPDATE employee_attendance_settings
       SET attendance_mode = ?, weekly_target_minutes = ?, monthly_target_minutes = ?, updated_by = ?
       WHERE employee_id = ?`,
      [input.attendanceMode, input.weeklyTargetMinutes, input.monthlyTargetMinutes, actorId, employeeId],
    );
    await audit(actorId, "update", "employee_attendance_settings", employeeId, {
      employee_id: employeeId,
      attendance_mode: { from: before.attendance_mode, to: input.attendanceMode },
      weekly_target_minutes: { from: Number(before.weekly_target_minutes), to: input.weeklyTargetMinutes },
      monthly_target_minutes: { from: Number(before.monthly_target_minutes), to: input.monthlyTargetMinutes },
      history_rewritten: false,
    }, ip, connection);
    await connection.commit();
    return getEmployeeAttendanceSettings(employeeId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateOrganizationAttendanceSettings(
  input: OrganizationAttendanceSettingsInput,
  actorId: number,
  ip: string | null,
): Promise<OrganizationAttendanceSettings> {
  const normalized: OrganizationAttendanceSettingsInput = {
    ...input,
    officeTimezone: ATTENDANCE_TIME_ZONE,
  };
  const validation = validateOrganizationAttendanceSettings(normalized);
  if (!validation.valid) {
    throw new AttendanceError(400, "INVALID_ORGANIZATION_ATTENDANCE_SETTINGS", "Organization attendance settings are invalid", {
      errors: validation.errors,
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<OrganizationSettingsRow[]>(
      `SELECT id, office_timezone, office_latitude, office_longitude, allowed_radius_meters,
              updated_by, created_at, updated_at
       FROM organization_attendance_settings WHERE id = 1 LIMIT 1 FOR UPDATE`,
    );
    const before = rows[0];
    if (!before) throw new AttendanceError(409, "ORGANIZATION_SETTINGS_MISSING", "Organization attendance settings are not initialized");
    await connection.execute<ResultSetHeader>(
      `UPDATE organization_attendance_settings
       SET office_timezone = ?, office_latitude = ?, office_longitude = ?,
           allowed_radius_meters = ?, updated_by = ?
       WHERE id = 1`,
      [
        normalized.officeTimezone,
        normalized.officeLatitude,
        normalized.officeLongitude,
        normalized.allowedRadiusMeters,
        actorId,
      ],
    );
    await audit(actorId, "update", "organization_attendance_settings", 1, {
      office_timezone: { from: before.office_timezone, to: normalized.officeTimezone },
      office_latitude: { from: before.office_latitude, to: normalized.officeLatitude },
      office_longitude: { from: before.office_longitude, to: normalized.officeLongitude },
      allowed_radius_meters: { from: before.allowed_radius_meters, to: normalized.allowedRadiusMeters },
    }, ip, connection);
    await connection.commit();
    return getOrganizationAttendanceSettings();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
