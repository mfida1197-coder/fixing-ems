import { NextFunction, Response, Router } from "express";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import { pool } from "../db";
import { audit } from "../audit";
import { AuthedRequest, requireAuth, requirePermission, requireSelectedMode } from "../middleware/auth";

const router = Router();
const GENERIC_RESPONSE =
  "If the provided information matches an employee account, the password reset request has been submitted for review.";

const resetLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 5,
  message: { error: "Too many password reset attempts. Try again in 30 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

function normalizeCnic(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function validatePassword(value: unknown): string | null {
  if (typeof value !== "string") return "New password is required";
  if (value.length < 10) return "New password must be at least 10 characters";
  if (value.length > 128) return "New password must be 128 characters or fewer";
  return null;
}

router.post("/request", resetLimiter, async (req, res, next) => {
  try {
    const cnic = normalizeCnic(req.body?.cnic);
    const password = req.body?.new_password;
    const confirmation = req.body?.confirm_password;
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });
    if (password !== confirmation) return res.status(400).json({ error: "New password and confirmation do not match" });

    // Hash before account lookup so validly shaped requests take the expensive path
    // regardless of whether the CNIC exists. The raw value is never persisted or logged.
    const pendingHash = await bcrypt.hash(password, 12);
    if (cnic.length !== 13) return res.json({ message: GENERIC_RESPONSE });

    const connection = await pool.getConnection();
    let notificationEmployeeId: number | null = null;
    try {
      await connection.beginTransaction();
      const [accountRows] = await connection.execute(
        `SELECT u.id AS user_id, u.employee_id
         FROM users u
         JOIN employees e ON e.id = u.employee_id
         WHERE u.cnic = ? AND e.cnic = ? AND u.is_active = TRUE
         LIMIT 1 FOR UPDATE`,
        [cnic, cnic],
      );
      const account = (accountRows as Array<{ user_id: number; employee_id: number }>)[0];
      if (account) {
        const [pendingRows] = await connection.execute(
          `SELECT id FROM password_reset_requests
           WHERE user_id = ? AND status = 'pending'
           ORDER BY id DESC LIMIT 1 FOR UPDATE`,
          [account.user_id],
        );
        if (!(pendingRows as unknown[]).length) {
          await connection.execute(
            `INSERT INTO password_reset_requests
               (employee_id, user_id, pending_password_hash, status)
             VALUES (?, ?, ?, 'pending')`,
            [account.employee_id, account.user_id, pendingHash],
          );
          notificationEmployeeId = account.employee_id;
        }
      }
      await connection.commit();
      if (notificationEmployeeId) void notifyEmployeeRequest(notificationEmployeeId, "Password Reset");
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return res.json({ message: GENERIC_RESPONSE });
  } catch (error) {
    next(error);
  }
});

router.use(requireAuth, requireSelectedMode, requirePermission("password_resets:manage"));

router.get("/", async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "all";
    if (!["all", "pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid reset-request status" });
    }
    const where = status === "all" ? "" : "WHERE pr.status = ?";
    const params = status === "all" ? [] : [status];
    const [rows] = await pool.execute(
      `SELECT pr.id, pr.status, pr.requested_at, pr.reviewed_at, pr.rejection_reason,
              e.id AS employee_id, e.employee_code, e.full_name,
              u.cnic, reviewer.full_name AS reviewed_by_name
       FROM password_reset_requests pr
       JOIN employees e ON e.id = pr.employee_id
       JOIN users u ON u.id = pr.user_id
       LEFT JOIN users reviewer ON reviewer.id = pr.reviewed_by
       ${where}
       ORDER BY (pr.status = 'pending') DESC, pr.requested_at DESC
       LIMIT 200`,
      params,
    );
    const requests = (rows as Array<Record<string, unknown>>).map((row) => {
      const cnic = String(row.cnic ?? "");
      const { cnic: _cnic, ...safe } = row;
      return { ...safe, username_masked: cnic ? `${"*".repeat(Math.max(0, cnic.length - 4))}${cnic.slice(-4)}` : "—" };
    });
    return res.json({ requests });
  } catch (error) {
    next(error);
  }
});

async function reviewRequest(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
  decision: "approved" | "rejected",
) {
  const requestId = Number(req.params.id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return res.status(400).json({ error: "Invalid password reset request ID" });
  }
  const rejectionReason = decision === "rejected" && typeof req.body?.reason === "string"
    ? req.body.reason.trim().slice(0, 300) || null
    : null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, employee_id, user_id, pending_password_hash, status
       FROM password_reset_requests WHERE id = ? LIMIT 1 FOR UPDATE`,
      [requestId],
    );
    const reset = (rows as Array<{
      id: number;
      employee_id: number;
      user_id: number;
      pending_password_hash: string | null;
      status: string;
    }>)[0];
    if (!reset) {
      await connection.rollback();
      return res.status(404).json({ error: "Password reset request not found" });
    }
    if (reset.status !== "pending") {
      await connection.rollback();
      return res.status(409).json({ error: "This password reset request has already been reviewed" });
    }
    if (decision === "approved") {
      if (!reset.pending_password_hash) {
        await connection.rollback();
        return res.status(409).json({ error: "This request no longer contains an approvable password" });
      }
      await connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", [reset.pending_password_hash, reset.user_id]);
    }
    await connection.execute(
      `UPDATE password_reset_requests
       SET status = ?, pending_password_hash = NULL, reviewed_at = NOW(), reviewed_by = ?, rejection_reason = ?
       WHERE id = ?`,
      [decision, req.user!.id, rejectionReason, requestId],
    );
    await audit(
      req.user!.id,
      "update",
      "password_reset_request",
      requestId,
      { decision, employee_id: reset.employee_id, request_id: requestId },
      req.ip ?? null,
      connection,
    );
    await connection.commit();
    return res.json({ ok: true, status: decision });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
}

router.post("/:id/approve", (req: AuthedRequest, res, next) => reviewRequest(req, res, next, "approved"));
router.post("/:id/reject", (req: AuthedRequest, res, next) => reviewRequest(req, res, next, "rejected"));

export default router;
import { notifyEmployeeRequest } from "../email/gmail";
