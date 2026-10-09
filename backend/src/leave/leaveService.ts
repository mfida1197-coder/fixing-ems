import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { audit } from "../audit";
import { ATTENDANCE_TIME_ZONE, LeaveRequestInput, LeaveStatus, LeaveType } from "../attendance/types";
import { validateLeaveRequest } from "../attendance/validation";
import { pool as applicationPool } from "../db";
import { LeaveManagementError } from "./errors";
import { LeaveListFilters, LeaveRequestView } from "./types";

interface LeaveViewRow extends RowDataPacket {
  id: number;
  employee_id: number;
  employee_code: string;
  employee_name: string;
  employee_designation: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  timezone_name: string;
  reason: string | null;
  status: LeaveStatus;
  requested_by: number | null;
  reviewed_by: number | null;
  reviewer_name: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

type Queryable = Pool | PoolConnection;

const LEAVE_SELECT = `
  SELECT l.id, l.employee_id, e.employee_code, e.full_name AS employee_name,
         e.designation AS employee_designation, l.leave_type,
         DATE_FORMAT(l.start_date, '%Y-%m-%d') AS start_date,
         DATE_FORMAT(l.end_date, '%Y-%m-%d') AS end_date,
         TIME_FORMAT(l.start_time, '%H:%i:%s') AS start_time,
         TIME_FORMAT(l.end_time, '%H:%i:%s') AS end_time,
         l.timezone_name, l.reason, l.status, l.requested_by, l.reviewed_by,
         reviewer.full_name AS reviewer_name, l.reviewed_at, l.created_at, l.updated_at
  FROM leave_requests l
  JOIN employees e ON e.id = l.employee_id
  LEFT JOIN users reviewer ON reviewer.id = l.reviewed_by`;

function mapLeave(row: LeaveViewRow): LeaveRequestView {
  return {
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    employeeCode: row.employee_code,
    employeeName: row.employee_name,
    employeeDesignation: row.employee_designation,
    leaveType: row.leave_type,
    startDate: row.start_date,
    endDate: row.end_date,
    startTime: row.start_time,
    endTime: row.end_time,
    timezoneName: row.timezone_name,
    reason: row.reason,
    status: row.status,
    requestedBy: row.requested_by === null ? null : Number(row.requested_by),
    reviewedBy: row.reviewed_by === null ? null : Number(row.reviewed_by),
    reviewerName: row.reviewer_name,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function daysInRange(from: string, to: string): number {
  return Math.floor(
    (new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / 86_400_000,
  ) + 1;
}

export class LeaveService {
  constructor(private readonly database: Pool = applicationPool) {}

  async createOwnRequest(
    employeeId: number,
    requestedBy: number,
    input: LeaveRequestInput,
  ): Promise<LeaveRequestView> {
    const validation = validateLeaveRequest(input);
    if (!validation.valid) {
      throw new LeaveManagementError(400, "INVALID_LEAVE_REQUEST", "The leave request is invalid", {
        errors: validation.errors,
      });
    }
    if (daysInRange(input.startDate, input.endDate) > 366) {
      throw new LeaveManagementError(400, "LEAVE_RANGE_TOO_LARGE", "Leave requests are limited to 366 days");
    }
    const reason = input.reason?.trim() || null;
    if (reason && reason.length > 2_000) {
      throw new LeaveManagementError(400, "LEAVE_REASON_TOO_LONG", "Leave reason must not exceed 2000 characters");
    }

    const connection = await this.database.getConnection();
    try {
      await connection.beginTransaction();
      const [employeeRows] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM employees WHERE id = ? LIMIT 1 FOR UPDATE",
        [employeeId],
      );
      if (employeeRows.length === 0) {
        throw new LeaveManagementError(404, "EMPLOYEE_NOT_FOUND", "Linked employee record was not found");
      }

      const conflicts = await this.findConflicts(connection, employeeId, input);
      if (conflicts.length > 0) {
        throw new LeaveManagementError(
          409,
          "LEAVE_REQUEST_CONFLICT",
          "This request overlaps an existing pending or approved leave request",
          { conflictingRequestIds: conflicts.map((row) => Number(row.id)) },
        );
      }

      const [insert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO leave_requests
           (employee_id, leave_type, start_date, end_date, start_time, end_time,
            timezone_name, reason, status, requested_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [
          employeeId,
          input.leaveType,
          input.startDate,
          input.endDate,
          input.leaveType === "short_hours" ? input.startTime ?? null : null,
          input.leaveType === "short_hours" ? input.endTime ?? null : null,
          ATTENDANCE_TIME_ZONE,
          reason,
          requestedBy,
        ],
      );
      const created = await this.getById(connection, insert.insertId, employeeId);
      await connection.commit();
      return created;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async listOwn(employeeId: number): Promise<LeaveRequestView[]> {
    const [rows] = await this.database.execute<LeaveViewRow[]>(
      `${LEAVE_SELECT} WHERE l.employee_id = ? ORDER BY l.created_at DESC, l.id DESC LIMIT 200`,
      [employeeId],
    );
    return rows.map(mapLeave);
  }

  getOwnById(employeeId: number, requestId: number): Promise<LeaveRequestView> {
    return this.getById(this.database, requestId, employeeId);
  }

  async listForManagement(filters: LeaveListFilters = {}): Promise<LeaveRequestView[]> {
    const where: string[] = [];
    const values: Array<string | number> = [];
    if (filters.status) {
      where.push("l.status = ?");
      values.push(filters.status);
    }
    if (filters.leaveType) {
      where.push("l.leave_type = ?");
      values.push(filters.leaveType);
    }
    if (filters.employeeId) {
      where.push("l.employee_id = ?");
      values.push(filters.employeeId);
    }
    if (filters.from) {
      where.push("l.end_date >= ?");
      values.push(filters.from);
    }
    if (filters.to) {
      where.push("l.start_date <= ?");
      values.push(filters.to);
    }
    const [rows] = await this.database.execute<LeaveViewRow[]>(
      `${LEAVE_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY FIELD(l.status, 'pending', 'approved', 'rejected'), l.created_at DESC, l.id DESC
       LIMIT 500`,
      values,
    );
    return rows.map(mapLeave);
  }

  async decide(
    requestId: number,
    decision: "approved" | "rejected",
    reviewerId: number,
    ip: string | null,
  ): Promise<LeaveRequestView> {
    const connection = await this.database.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT id, employee_id, leave_type, start_date, end_date, status FROM leave_requests WHERE id = ? FOR UPDATE",
        [requestId],
      );
      const request = rows[0];
      if (!request) throw new LeaveManagementError(404, "LEAVE_REQUEST_NOT_FOUND", "Leave request was not found");
      if (request.status !== "pending") {
        throw new LeaveManagementError(
          409,
          "LEAVE_REQUEST_ALREADY_DECIDED",
          `This leave request is already ${request.status}`,
        );
      }

      const [update] = await connection.execute<ResultSetHeader>(
        `UPDATE leave_requests
         SET status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND status = 'pending'`,
        [decision, reviewerId, requestId],
      );
      if (update.affectedRows !== 1) {
        throw new LeaveManagementError(409, "LEAVE_REQUEST_ALREADY_DECIDED", "Leave request was decided by another request");
      }
      await audit(
        reviewerId,
        "update",
        "leave_request",
        requestId,
        {
          decision,
          employee_id: Number(request.employee_id),
          leave_type: request.leave_type,
          start_date: request.start_date,
          end_date: request.end_date,
        },
        ip,
        connection,
      );
      const decided = await this.getById(connection, requestId);
      await connection.commit();
      return decided;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async getById(database: Queryable, id: number, ownerEmployeeId?: number): Promise<LeaveRequestView> {
    const [rows] = await database.execute<LeaveViewRow[]>(
      `${LEAVE_SELECT} WHERE l.id = ?${ownerEmployeeId ? " AND l.employee_id = ?" : ""} LIMIT 1`,
      ownerEmployeeId ? [id, ownerEmployeeId] : [id],
    );
    if (!rows[0]) throw new LeaveManagementError(404, "LEAVE_REQUEST_NOT_FOUND", "Leave request was not found");
    return mapLeave(rows[0]);
  }

  private findConflicts(connection: PoolConnection, employeeId: number, input: LeaveRequestInput) {
    if (input.leaveType === "full_day") {
      return connection.execute<RowDataPacket[]>(
        `SELECT id FROM leave_requests
         WHERE employee_id = ? AND status IN ('pending', 'approved')
           AND NOT (end_date < ? OR start_date > ?)
         FOR UPDATE`,
        [employeeId, input.startDate, input.endDate],
      ).then(([rows]) => rows);
    }
    return connection.execute<RowDataPacket[]>(
      `SELECT id FROM leave_requests
       WHERE employee_id = ? AND status IN ('pending', 'approved')
         AND (
           (leave_type = 'full_day' AND start_date <= ? AND end_date >= ?)
           OR
           (leave_type = 'short_hours' AND start_date = ? AND start_time < ? AND end_time > ?)
         )
       FOR UPDATE`,
      [employeeId, input.startDate, input.startDate, input.startDate, input.endTime ?? "", input.startTime ?? ""],
    ).then(([rows]) => rows);
  }
}

export const leaveService = new LeaveService();
