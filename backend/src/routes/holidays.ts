import { NextFunction, Response, Router } from "express";
import { LeaveManagementError } from "../leave/errors";
import { holidayService } from "../leave/holidayService";
import { AuthedRequest, requireAuth, requirePermission, requireSelectedMode } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();
router.use(requireAuth, requireSelectedMode, requirePermission("holidays:manage"));

function holidayId(req: AuthedRequest): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new LeaveManagementError(400, "INVALID_HOLIDAY_ID", "Holiday id must be a positive integer");
  }
  return id;
}

function holidayInput(req: AuthedRequest): { holidayDate: string; name: string } {
  return {
    holidayDate: typeof req.body?.holidayDate === "string" ? req.body.holidayDate : "",
    name: typeof req.body?.name === "string" ? req.body.name : "",
  };
}

function sendError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof LeaveManagementError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  next(error);
}

router.get("/", asyncHandler(async (_req, res) => {
  res.json({ holidays: await holidayService.list() });
}));

router.post("/", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    const input = holidayInput(req);
    res.status(201).json(await holidayService.create(input.holidayDate, input.name, req.user!.id, req.ip ?? null));
  } catch (error) {
    sendError(error, res, next);
  }
}));

router.put("/:id", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    const input = holidayInput(req);
    res.json(await holidayService.update(holidayId(req), input.holidayDate, input.name, req.user!.id, req.ip ?? null));
  } catch (error) {
    sendError(error, res, next);
  }
}));

router.delete("/:id", asyncHandler(async (req: AuthedRequest, res, next) => {
  try {
    res.json({ deleted: await holidayService.delete(holidayId(req), req.user!.id, req.ip ?? null) });
  } catch (error) {
    sendError(error, res, next);
  }
}));

export default router;
