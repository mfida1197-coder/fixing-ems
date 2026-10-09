import { Router } from "express";
import { pool } from "../db";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();
router.use(requireAuth, requireRole("employee", "admin", "super_admin"));

router.get("/summary", async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === "employee") {
      if (!req.user!.employee_id) return res.json({ unread_count: 0 });
      const [rows] = await pool.execute(
        `SELECT
          (SELECT COUNT(*) FROM leave_requests lr
           LEFT JOIN request_notification_reads rnr ON rnr.user_id = ? AND rnr.request_type = 'leave' AND rnr.request_id = lr.id
           WHERE lr.employee_id = ? AND lr.status IN ('approved','rejected') AND rnr.request_id IS NULL)
          +
          (SELECT COUNT(*) FROM general_applications ga
           LEFT JOIN request_notification_reads rnr ON rnr.user_id = ? AND rnr.request_type = 'application' AND rnr.request_id = ga.id
           WHERE ga.submitted_by = ? AND ga.status IN ('approved','rejected') AND rnr.request_id IS NULL)
          AS unread_count`,
        [req.user!.id, req.user!.employee_id, req.user!.id, req.user!.id],
      );
      return res.json({ unread_count: Number((rows as Array<{ unread_count: number }>)[0]?.unread_count || 0) });
    }

    const [rows] = await pool.execute(
      `SELECT
        (SELECT COUNT(*) FROM leave_requests lr
         LEFT JOIN request_notification_reads rnr ON rnr.user_id = ? AND rnr.request_type = 'leave' AND rnr.request_id = lr.id
         WHERE lr.status = 'pending' AND rnr.request_id IS NULL)
        +
        (SELECT COUNT(*) FROM general_applications ga
         LEFT JOIN request_notification_reads rnr ON rnr.user_id = ? AND rnr.request_type = 'application' AND rnr.request_id = ga.id
         WHERE ga.status = 'pending' AND rnr.request_id IS NULL)
        +
        (SELECT COUNT(*) FROM password_reset_requests prr
         LEFT JOIN request_notification_reads rnr ON rnr.user_id = ? AND rnr.request_type = 'password_reset' AND rnr.request_id = prr.id
         WHERE prr.status = 'pending' AND rnr.request_id IS NULL)
        AS unread_count`,
      [req.user!.id, req.user!.id, req.user!.id],
    );
    res.json({ unread_count: Number((rows as Array<{ unread_count: number }>)[0]?.unread_count || 0) });
  } catch (error) { next(error); }
});

router.post("/mark-read", async (req: AuthedRequest, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (req.user!.role === "employee") {
      if (req.user!.employee_id) {
        await connection.execute(
          `INSERT IGNORE INTO request_notification_reads (user_id, request_type, request_id)
           SELECT ?, 'leave', lr.id FROM leave_requests lr
           WHERE lr.employee_id = ? AND lr.status IN ('approved','rejected')`,
          [req.user!.id, req.user!.employee_id],
        );
        await connection.execute(
          `INSERT IGNORE INTO request_notification_reads (user_id, request_type, request_id)
           SELECT ?, 'application', ga.id FROM general_applications ga
           WHERE ga.submitted_by = ? AND ga.status IN ('approved','rejected')`,
          [req.user!.id, req.user!.id],
        );
      }
    } else {
      await connection.execute(
        `INSERT IGNORE INTO request_notification_reads (user_id, request_type, request_id)
         SELECT ?, 'leave', id FROM leave_requests WHERE status = 'pending'`,
        [req.user!.id],
      );
      await connection.execute(
        `INSERT IGNORE INTO request_notification_reads (user_id, request_type, request_id)
         SELECT ?, 'application', id FROM general_applications WHERE status = 'pending'`,
        [req.user!.id],
      );
      await connection.execute(
        `INSERT IGNORE INTO request_notification_reads (user_id, request_type, request_id)
         SELECT ?, 'password_reset', id FROM password_reset_requests WHERE status = 'pending'`,
        [req.user!.id],
      );
    }
    await connection.commit();
    res.json({ ok: true, unread_count: 0 });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

export default router;
