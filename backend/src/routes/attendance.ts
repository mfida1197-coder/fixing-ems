import { NextFunction, Response, Router } from "express";
import { addDays } from "../attendance/calculations";
import { AttendanceError } from "../attendance/errors";
import { attendanceService } from "../attendance/attendanceService";
import { attendanceAnalyticsService } from "../attendance/analyticsService";
import { AttendanceOverviewPeriod } from "../attendance/analyticsTypes";
import { attendanceEmployeeAdminService } from "../attendance/employeeAdminService";
import { buildAttendanceReportPdf } from "../attendance/attendanceReportPdf";
import { attendanceReportService } from "../attendance/reportService";
import { validateAttendanceReportQuery } from "../attendance/reportValidation";
import { audit } from "../audit";
import {
  getOrganizationAttendanceSettings,
  updateEmployeeAttendanceSettings,
  updateOrganizationAttendanceSettings,
} from "../attendance/settingsService";
import { workDateForInstant } from "../attendance/time";
import {
  ATTENDANCE_TIME_ZONE,
  AttendanceMode,
  EmployeeAttendanceSettingsInput,
  GpsCoordinates,
  OrganizationAttendanceSettingsInput,
} from "../attendance/types";
import { isIsoDate } from "../attendance/validation";
import {
  AuthedRequest,
  requireAuth,
  requirePermission,
  requireSelectedMode,
} from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();
const MAX_RANGE_DAYS = 366;

router.use(requireAuth, requireSelectedMode);

function employeeIdForSelf(req: AuthedRequest): number {
  if (req.user?.role !== "employee" || !req.user.employee_id) {
    throw new AttendanceError(
      403,
      "EMPLOYEE_MODE_REQUIRED",
      "Employee mode with a linked employee record is required",
    );
  }
  return req.user.employee_id;
}

function employeeIdFromPath(req: AuthedRequest): number {
  const id = Number(req.params.employeeId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AttendanceError(400, "INVALID_EMPLOYEE_ID", "employeeId must be a positive integer");
  }
  return id;
}

function coordinatesFromRequest(req: AuthedRequest): GpsCoordinates | undefined {
  const value = req.body?.coordinates;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AttendanceError(400, "INVALID_GPS_COORDINATES", "coordinates must be an object");
  }
  return {
    latitude: typeof value.latitude === "number" ? value.latitude : Number.NaN,
    longitude: typeof value.longitude === "number" ? value.longitude : Number.NaN,
    accuracyMeters:
      value.accuracyMeters === undefined || value.accuracyMeters === null
        ? null
        : typeof value.accuracyMeters === "number"
          ? value.accuracyMeters
          : Number.NaN,
  };
}

function dateRangeFromRequest(req: AuthedRequest): { from: string; to: string } {
  const today = workDateForInstant(new Date(), ATTENDANCE_TIME_ZONE);
  const to = typeof req.query.to === "string" ? req.query.to : today;
  const from = typeof req.query.from === "string" ? req.query.from : addDays(to, -29);
  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new AttendanceError(400, "INVALID_DATE_RANGE", "from and to must be valid YYYY-MM-DD dates");
  }
  if (from > to) {
    throw new AttendanceError(400, "INVALID_DATE_RANGE", "from must not be after to");
  }
  const spanDays = Math.floor(
    (new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / 86_400_000,
  ) + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    throw new AttendanceError(
      400,
      "DATE_RANGE_TOO_LARGE",
      `Attendance date ranges are limited to ${MAX_RANGE_DAYS} days`,
    );
  }
  return { from, to };
}

function anchorDateFromRequest(req: AuthedRequest): string {
  const date = typeof req.query.date === "string"
    ? req.query.date
    : workDateForInstant(new Date(), ATTENDANCE_TIME_ZONE);
  if (!isIsoDate(date)) {
    throw new AttendanceError(400, "INVALID_DATE", "date must be a valid YYYY-MM-DD date");
  }
  return date;
}

function boundedDateFromRequest(req: AuthedRequest): string {
  const date = anchorDateFromRequest(req);
  const today = workDateForInstant(new Date(), ATTENDANCE_TIME_ZONE);
  const distance = Math.abs(
    new Date(`${date}T00:00:00.000Z`).getTime() - new Date(`${today}T00:00:00.000Z`).getTime(),
  ) / 86_400_000;
  if (distance > MAX_RANGE_DAYS) {
    throw new AttendanceError(400, "DATE_OUT_OF_RANGE", `date must be within ${MAX_RANGE_DAYS} days of today`);
  }
  return date;
}

function employeeSettingsInput(req: AuthedRequest): EmployeeAttendanceSettingsInput {
  const mode = req.body?.attendanceMode;
  return {
    attendanceMode: (mode === "gps" || mode === "remote" ? mode : String(mode ?? "")) as AttendanceMode,
    weeklyTargetMinutes: typeof req.body?.weeklyTargetMinutes === "number"
      ? req.body.weeklyTargetMinutes : Number.NaN,
    monthlyTargetMinutes: typeof req.body?.monthlyTargetMinutes === "number"
      ? req.body.monthlyTargetMinutes : Number.NaN,
  };
}

function nullableNumber(value: unknown): number | null {
  if (value === null) return null;
  return typeof value === "number" ? value : Number.NaN;
}

function organizationSettingsInput(req: AuthedRequest): OrganizationAttendanceSettingsInput {
  return {
    officeTimezone: ATTENDANCE_TIME_ZONE,
    officeLatitude: nullableNumber(req.body?.officeLatitude),
    officeLongitude: nullableNumber(req.body?.officeLongitude),
    allowedRadiusMeters: nullableNumber(req.body?.allowedRadiusMeters),
  };
}

function sendAttendanceError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof AttendanceError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
    });
  }
  next(error);
}

const selfAction = (action: "checkIn" | "breakOut" | "breakIn" | "checkOut") => asyncHandler(
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await attendanceService[action](
        employeeIdForSelf(req),
        coordinatesFromRequest(req),
      );
      res.status(action === "checkIn" ? 201 : 200).json(result);
    } catch (error) {
      sendAttendanceError(error, res, next);
    }
  },
);

router.get("/me/current", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    res.json(await attendanceService.getCurrentState(employeeIdForSelf(req)));
  } catch (error) {
    sendAttendanceError(error, res, next);
  }
}));
router.post("/me/check-in", selfAction("checkIn"));
router.post("/me/break-out", selfAction("breakOut"));
router.post("/me/break-in", selfAction("breakIn"));
router.post("/me/check-out", selfAction("checkOut"));
router.get("/me/history", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    const { from, to } = dateRangeFromRequest(req);
    res.json(await attendanceService.getHistory(employeeIdForSelf(req), from, to));
  } catch (error) {
    sendAttendanceError(error, res, next);
  }
}));
router.get("/me/calendar", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    const { from, to } = dateRangeFromRequest(req);
    res.json({ from, to, days: await attendanceService.getCalendar(employeeIdForSelf(req), from, to) });
  } catch (error) {
    sendAttendanceError(error, res, next);
  }
}));
router.get("/me/summary", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    res.json(await attendanceService.getSummary(employeeIdForSelf(req), anchorDateFromRequest(req)));
  } catch (error) {
    sendAttendanceError(error, res, next);
  }
}));

router.get("/dashboard", requirePermission("attendance:analytics"), asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    const today = workDateForInstant(new Date(), ATTENDANCE_TIME_ZONE);
    const date = typeof req.query.date === "string" ? req.query.date : today;
    if (!isIsoDate(date)) {
      throw new AttendanceError(400, "INVALID_DATE", "date must be a valid YYYY-MM-DD date");
    }
    const distance = Math.abs(
      new Date(`${date}T00:00:00.000Z`).getTime() - new Date(`${today}T00:00:00.000Z`).getTime(),
    ) / 86_400_000;
    if (distance > MAX_RANGE_DAYS) {
      throw new AttendanceError(400, "DATE_OUT_OF_RANGE", `date must be within ${MAX_RANGE_DAYS} days of today`);
    }
    const parsedPeriod = Number(req.query.period ?? 7);
    if (![7, 30, 60, 180].includes(parsedPeriod)) {
      throw new AttendanceError(400, "INVALID_OVERVIEW_PERIOD", "period must be 7, 30, 60, or 180 days");
    }
    res.json(await attendanceAnalyticsService.getDashboard(date, parsedPeriod as AttendanceOverviewPeriod));
  } catch (error) {
    sendAttendanceError(error, res, next);
  }
}));

router.get(
  "/reports/options",
  requirePermission("attendance:reports"),
  asyncHandler(async (_req: AuthedRequest, res, next) => {
    try {
      res.json({ employees: await attendanceReportService.getEmployeeOptions() });
    } catch (error) {
      sendAttendanceError(error, res, next);
    }
  }),
);

router.get(
  "/reports/preview",
  requirePermission("attendance:reports"),
  asyncHandler(async (req: AuthedRequest, res, next) => {
    try {
      const { filters, page, pageSize } = validateAttendanceReportQuery(
        req.query as unknown as Record<string, unknown>,
      );
      res.json(await attendanceReportService.getReport(filters, page, pageSize));
    } catch (error) {
      sendAttendanceError(error, res, next);
    }
  }),
);

router.get(
  "/reports/attendance.pdf",
  requirePermission("attendance:reports"),
  asyncHandler(async (req: AuthedRequest, res, next) => {
    try {
      const { filters } = validateAttendanceReportQuery(req.query as unknown as Record<string, unknown>);
      const report = await attendanceReportService.getCompleteReport(filters);
      const pdf = await buildAttendanceReportPdf(report);
      await audit(req.user!.id, "create", "attendance_report", filters.employeeId, {
        report_type: "attendance",
        date_range: { from: filters.from, to: filters.to },
        employee_filter: filters.employeeId ?? "all",
        attendance_mode: filters.attendanceMode ?? "all",
        attendance_status: filters.attendanceStatus ?? "all",
        employment_status: filters.employmentStatus ?? "all",
        generated_at_utc: report.generatedAtUtc,
        employee_days: report.summary.employeeDays,
      }, req.ip ?? null);
      const filename = `attendance-report-${filters.from}-to-${filters.to}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdf);
    } catch (error) {
      sendAttendanceError(error, res, next);
    }
  }),
);

router.get(
  "/settings/organization",
  requirePermission("attendance:read"),
  asyncHandler(async (_req: AuthedRequest, res, next) => {
    try {
      res.json(await getOrganizationAttendanceSettings());
    } catch (error) {
      sendAttendanceError(error, res, next);
    }
  }),
);

router.put(
  "/settings/organization",
  requirePermission("attendance:settings:manage"),
  asyncHandler(async (req: AuthedRequest, res, next) => {
    try {
      res.json(await updateOrganizationAttendanceSettings(
        organizationSettingsInput(req),
        req.user!.id,
        req.ip ?? null,
      ));
    } catch (error) {
      sendAttendanceError(error, res, next);
    }
  }),
);

router.use("/employees", requirePermission("attendance:read"));
router.get("/employees", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    res.json(await attendanceEmployeeAdminService.getDirectory(boundedDateFromRequest(req)));
  } catch (error) {
    sendAttendanceError(error, res, next);
  }
}));
router.get("/employees/:employeeId/profile", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    res.json(await attendanceEmployeeAdminService.getProfileOverview(
      employeeIdFromPath(req),
      boundedDateFromRequest(req),
    ));
  } catch (error) {
    sendAttendanceError(error, res, next);
  }
}));
router.put(
  "/employees/:employeeId/settings",
  requirePermission("attendance:settings:manage"),
  asyncHandler(async (req: AuthedRequest, res, next) => {
    try {
      res.json(await updateEmployeeAttendanceSettings(
        employeeIdFromPath(req),
        employeeSettingsInput(req),
        req.user!.id,
        req.ip ?? null,
      ));
    } catch (error) {
      sendAttendanceError(error, res, next);
    }
  }),
);
router.get("/employees/:employeeId/current", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    res.json(await attendanceService.getCurrentState(employeeIdFromPath(req)));
  } catch (error) {
    sendAttendanceError(error, res, next);
  }
}));
router.get("/employees/:employeeId/history", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    const { from, to } = dateRangeFromRequest(req);
    res.json(await attendanceService.getHistory(employeeIdFromPath(req), from, to));
  } catch (error) {
    sendAttendanceError(error, res, next);
  }
}));
router.get("/employees/:employeeId/calendar", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    const { from, to } = dateRangeFromRequest(req);
    res.json({
      from,
      to,
      days: await attendanceService.getCalendar(employeeIdFromPath(req), from, to),
    });
  } catch (error) {
    sendAttendanceError(error, res, next);
  }
}));
router.get("/employees/:employeeId/summary", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    res.json(await attendanceService.getSummary(employeeIdFromPath(req), anchorDateFromRequest(req)));
  } catch (error) {
    sendAttendanceError(error, res, next);
  }
}));

export default router;
