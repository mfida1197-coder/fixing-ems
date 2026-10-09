import { Router } from "express";
import { pool } from "../db";
import { AuthedRequest, requireAuth, requirePermission } from "../middleware/auth";
import { hasPermission } from "../permissions";

const router = Router();
router.use(requireAuth);

router.get("/activity", requirePermission("recent_activity:view"), async (_req, res) => {
  const [activity] = await pool.execute(
    `SELECT a.action, a.entity_type, a.entity_id, a.created_at,
            COALESCE(u.full_name, 'Deleted user') AS full_name
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC LIMIT 8`,
  );
  res.json({ activity });
});

router.get("/", requirePermission("dashboard:view"), async (req: AuthedRequest, res) => {
  const [[empRow]] = await pool.execute(
    "SELECT COUNT(*) AS c FROM employees WHERE status = 'active'"
  ) as any;

  const [projRows] = await pool.execute(
    "SELECT status, COUNT(*) AS c FROM projects GROUP BY status"
  );
  const projects: Record<string, number> = { upcoming: 0, ongoing: 0, done: 0, handed_over: 0 };
  for (const r of projRows as any[]) projects[r.status] = Number(r.c);

  let finance: { inflow_pkr: number; outflow_pkr: number } | undefined;
  if (hasPermission(req.user?.role, "finance:manage")) {
    const [finRows] = await pool.execute(
      `SELECT type, SUM(amount_pkr) AS total
       FROM transactions

       GROUP BY type`,
    );
    finance = { inflow_pkr: 0, outflow_pkr: 0 };
    for (const r of finRows as any[]) {
      if (r.type === "inflow") finance.inflow_pkr = Number(r.total);
      if (r.type === "outflow") finance.outflow_pkr = Number(r.total);
    }
  }

  const [[clientRow]] = await pool.execute(
    "SELECT COUNT(*) AS c FROM clients WHERE status = 'active'"
  ) as any;

  const response: Record<string, unknown> = {
    headcount: Number(empRow.c),
    active_clients: Number(clientRow.c),
    projects,
  };
  if (finance) response.finance = finance;
  res.json(response);
});

export default router;
