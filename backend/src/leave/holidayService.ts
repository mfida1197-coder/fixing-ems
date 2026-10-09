import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { audit } from "../audit";
import { isIsoDate } from "../attendance/validation";
import { workDateForInstant } from "../attendance/time";
import { pool as applicationPool } from "../db";
import { isDuplicateEntry, LeaveManagementError } from "./errors";
import { HolidayView } from "./types";

interface HolidayRow extends RowDataPacket {
  id: number;
  holiday_date: string;
  name: string;
  created_by: number | null;
  updated_by: number | null;
  created_at: Date;
  updated_at: Date;
}

type Queryable = Pool | PoolConnection;

function mapHoliday(row: HolidayRow): HolidayView {
  return {
    id: Number(row.id),
    holidayDate: row.holiday_date,
    name: row.name,
    createdBy: row.created_by === null ? null : Number(row.created_by),
    updatedBy: row.updated_by === null ? null : Number(row.updated_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateHoliday(holidayDate: string, name: string) {
  if (!isIsoDate(holidayDate)) {
    throw new LeaveManagementError(400, "INVALID_HOLIDAY_DATE", "holidayDate must be a valid YYYY-MM-DD date");
  }
  const trimmedName = name.trim();
  if (!trimmedName) throw new LeaveManagementError(400, "HOLIDAY_NAME_REQUIRED", "Holiday name is required");
  if (trimmedName.length > 120) {
    throw new LeaveManagementError(400, "HOLIDAY_NAME_TOO_LONG", "Holiday name must not exceed 120 characters");
  }
  return trimmedName;
}

export class HolidayService {
  constructor(private readonly database: Pool = applicationPool) {}

  async list(): Promise<HolidayView[]> {
    const [rows] = await this.database.execute<HolidayRow[]>(
      `SELECT id, DATE_FORMAT(holiday_date, '%Y-%m-%d') AS holiday_date, name,
              created_by, updated_by, created_at, updated_at
       FROM holidays ORDER BY holiday_date DESC, id DESC LIMIT 500`,
    );
    return rows.map(mapHoliday);
  }

  async create(holidayDate: string, name: string, userId: number, ip: string | null): Promise<HolidayView> {
    const cleanName = validateHoliday(holidayDate, name);
    if (holidayDate < workDateForInstant(new Date())) {
      throw new LeaveManagementError(400, "HOLIDAY_DATE_PAST", "New holidays cannot be created before today");
    }
    const connection = await this.database.getConnection();
    try {
      await connection.beginTransaction();
      const [insert] = await connection.execute<ResultSetHeader>(
        "INSERT INTO holidays (holiday_date, name, created_by, updated_by) VALUES (?, ?, ?, ?)",
        [holidayDate, cleanName, userId, userId],
      );
      await audit(userId, "create", "holiday", insert.insertId, { holiday_date: holidayDate, name: cleanName }, ip, connection);
      const created = await this.getById(connection, insert.insertId);
      await connection.commit();
      return created;
    } catch (error) {
      await connection.rollback();
      if (isDuplicateEntry(error)) {
        throw new LeaveManagementError(409, "HOLIDAY_DATE_EXISTS", "A holiday already exists for this date");
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async update(id: number, holidayDate: string, name: string, userId: number, ip: string | null): Promise<HolidayView> {
    const cleanName = validateHoliday(holidayDate, name);
    const connection = await this.database.getConnection();
    try {
      await connection.beginTransaction();
      const current = await this.getById(connection, id, true);
      await connection.execute(
        "UPDATE holidays SET holiday_date = ?, name = ?, updated_by = ? WHERE id = ?",
        [holidayDate, cleanName, userId, id],
      );
      await audit(
        userId,
        "update",
        "holiday",
        id,
        { from: { holiday_date: current.holidayDate, name: current.name }, to: { holiday_date: holidayDate, name: cleanName } },
        ip,
        connection,
      );
      const updated = await this.getById(connection, id);
      await connection.commit();
      return updated;
    } catch (error) {
      await connection.rollback();
      if (isDuplicateEntry(error)) {
        throw new LeaveManagementError(409, "HOLIDAY_DATE_EXISTS", "A holiday already exists for this date");
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async delete(id: number, userId: number, ip: string | null): Promise<HolidayView> {
    const connection = await this.database.getConnection();
    try {
      await connection.beginTransaction();
      const current = await this.getById(connection, id, true);
      await connection.execute("DELETE FROM holidays WHERE id = ?", [id]);
      await audit(
        userId,
        "delete",
        "holiday",
        id,
        { holiday_date: current.holidayDate, name: current.name },
        ip,
        connection,
      );
      await connection.commit();
      return current;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async getById(database: Queryable, id: number, lock = false): Promise<HolidayView> {
    const [rows] = await database.execute<HolidayRow[]>(
      `SELECT id, DATE_FORMAT(holiday_date, '%Y-%m-%d') AS holiday_date, name,
              created_by, updated_by, created_at, updated_at
       FROM holidays WHERE id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [id],
    );
    if (!rows[0]) throw new LeaveManagementError(404, "HOLIDAY_NOT_FOUND", "Holiday was not found");
    return mapHoliday(rows[0]);
  }
}

export const holidayService = new HolidayService();
