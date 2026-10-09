import { NextFunction, Response, Router } from "express";
import { LeaveRequestInput, LeaveStatus, LeaveType } from "../attendance/types";
import { isIsoDate } from "../attendance/validation";
import { LeaveManagementError } from "../leave/errors";
import { leaveService } from "../leave/leaveService";
import { LeaveListFilters } from "../leave/types";
import { AuthedRequest, requireAuth, requirePermission, requireSelectedMode } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();
const LEAVE_TYPES: LeaveType[] = ["full_day", "short_hours"];
const LEAVE_STATUSES: LeaveStatus[] = ["pending", "approved", "rejected"];

router.use(requireAuth, requireSelectedMode);

function selfEmployeeId(req: AuthedRequest): number {
  if (req.user?.role !== "employee" || !req.user.employee_id) {
    throw new LeaveManagementError(403, "EMPLOYEE_MODE_REQUIRED", "Employee mode with a linked employee record is required");
  }
  return req.user.employee_id;
}

function positiveId(value: string, field: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new LeaveManagementError(400, "INVALID_ID", `${field} must be a positive integer`);
  }
  return id;
}

function requestInput(req: AuthedRequest): LeaveRequestInput {
  const leaveType = typeof req.body?.leaveType === "string" ? req.body.leaveType : "";
  return {
    leaveType: leaveType as LeaveType,
    startDate: typeof req.body?.startDate === "string" ? req.body.startDate : "",
    endDate: typeof req.body?.endDate === "string" ? req.body.endDate : "",
    startTime: typeof req.body?.startTime === "string" ? req.body.startTime : null,
    endTime: typeof req.body?.endTime === "string" ? req.body.endTime : null,
    reason: typeof req.body?.reason === "string" ? req.body.reason : null,
  };
}

function managementFilters(req: AuthedRequest): LeaveListFilters {
  const filters: LeaveListFilters = {};
  if (typeof req.query.status === "string") {
    if (!LEAVE_STATUSES.includes(req.query.status as LeaveStatus)) {
      throw new LeaveManagementError(400, "INVALID_LEAVE_STATUS", "status must be pending, approved, or rejected");
    }
    filters.status = req.query.status as LeaveStatus;
  }
  if (typeof req.query.leaveType === "string") {
    if (!LEAVE_TYPES.includes(req.query.leaveType as LeaveType)) {
      throw new LeaveManagementError(400, "INVALID_LEAVE_TYPE", "leaveType must be full_day or short_hours");
    }
    filters.leaveType = req.query.leaveType as LeaveType;
  }
  if (typeof req.query.employeeId === "string") {
    filters.employeeId = positiveId(req.query.employeeId, "employeeId");
  }
  for (const field of ["from", "to"] as const) {
    const value = req.query[field];
    if (typeof value === "string") {
      if (!isIsoDate(value)) throw new LeaveManagementError(400, "INVALID_DATE_FILTER", `${field} must be a valid YYYY-MM-DD date`);
      filters[field] = value;
    }
  }
  if (filters.from && filters.to && filters.from > filters.to) {
    throw new LeaveManagementError(400, "INVALID_DATE_FILTER", "from must not be after to");
  }
  return filters;
}

function sendError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof LeaveManagementError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
    });
  }
  next(error);
}

router.get("/me", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    res.json({ requests: await leaveService.listOwn(selfEmployeeId(req)) });
  } catch (error) {
    sendError(error, res, next);
  }
}));

router.get("/me/:id", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    res.json(await leaveService.getOwnById(selfEmployeeId(req), positiveId(req.params.id, "id")));
  } catch (error) {
    sendError(error, res, next);
  }
}));

router.post("/me", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    const employeeId = selfEmployeeId(req);
    const result = await leaveService.createOwnRequest(employeeId, req.user!.id, requestInput(req));
    void notifyEmployeeRequest(employeeId, "Leave Request");
    res.status(201).json(result);
  } catch (error) {
    sendError(error, res, next);
  }
}));

router.use(requirePermission("leave:manage"));

router.get("/", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    res.json({ requests: await leaveService.listForManagement(managementFilters(req)) });
  } catch (error) {
    sendError(error, res, next);
  }
}));

const decisionRoute = (decision: "approved" | "rejected") => asyncHandler(
  async (req: AuthedRequest, res, next) => {
    try {
      res.json(await leaveService.decide(positiveId(req.params.id, "id"), decision, req.user!.id, req.ip ?? null));
    } catch (error) {
      sendError(error, res, next);
    }
  },
);

router.patch("/:id/approve", decisionRoute("approved"));
router.patch("/:id/reject", decisionRoute("rejected"));

export default router;
import { notifyEmployeeRequest } from "../email/gmail";
