import { Router } from "express";
import { pool } from "../db";
import { audit } from "../audit";
import { requireAuth, requirePermission, requireSelectedMode, requireSuperPassword, AuthedRequest } from "../middleware/auth";
import { groupRequirementRows, RequirementVersionRow } from "../projects/requirements";
import { loadProjectBilling } from "../finance/projectBilling";
import { projectAppliedSql } from "../finance/projectPayment";
import { streamRequirementAttachment } from "../projects/requirementAttachments";

const router = Router();
router.use(requireAuth, requireSelectedMode);

// Employee projection deliberately excludes team, client and all financial fields.
router.get(["/me/assigned", "/me/assigned/:id"], async (req: AuthedRequest, res, next) => {
  if (req.user?.mode !== "employee") return res.status(403).json({ error: "Forbidden" });
  const projectId = req.params.id === undefined ? null : Number(req.params.id);
  if (projectId !== null && (!Number.isSafeInteger(projectId) || projectId <= 0)) return res.status(400).json({ error: "Invalid project" });
  try {
    const [rows] = await pool.execute(
      `SELECT p.id, p.name, p.description, p.status, p.expected_handover_date,
              COALESCE((SELECT progress_percent FROM project_progress_updates WHERE project_id = p.id ORDER BY created_at DESC, id DESC LIMIT 1), 0) AS current_progress,
              (SELECT report FROM project_progress_updates WHERE project_id = p.id ORDER BY created_at DESC, id DESC LIMIT 1) AS latest_update
       FROM projects p WHERE p.status <> 'handed_over' AND p.handover_date IS NULL
       AND EXISTS (SELECT 1 FROM project_assignments pa JOIN employees e ON e.id = pa.employee_id
                   WHERE pa.project_id = p.id AND pa.removed_at IS NULL AND e.id = (SELECT employee_id FROM users WHERE id = ?))
       ${projectId === null ? "" : "AND p.id = ?"} ORDER BY p.name`,
      projectId === null ? [req.user.id] : [req.user.id, projectId],
    );
    const projects = rows as Array<{ id: number }>;
    if (projectId === null) return res.json({ projects });
    if (!projects.length) return res.status(404).json({ error: "Project not found" });
    const [updates] = await pool.execute(
      "SELECT id, progress_percent, report, created_at FROM project_progress_updates WHERE project_id = ? ORDER BY created_at DESC, id DESC", [projectId],
    );
    const [requirements] = await pool.execute(
      `SELECT pr.id, pr.attachment_name, prv.content FROM project_requirements pr
       JOIN project_requirement_versions prv ON prv.requirement_id = pr.id AND prv.version_number = pr.current_version
       WHERE pr.project_id = ? ORDER BY pr.updated_at DESC, pr.id DESC`, [projectId],
    );
    return res.json({ project: projects[0], progress_updates: updates, requirements });
  } catch (error) { next(error); }
});

router.get("/requirements/:id/attachment", streamRequirementAttachment);

router.post("/:id/progress", (req: AuthedRequest, res, next) => {
  if (req.user?.mode === "employee") return next();
  return requirePermission("projects:manage")(req, res, next);
}, async (req: AuthedRequest, res, next) => {
  const projectId = Number(req.params.id);
  const progress = Number(req.body?.progress_percent);
  const report = typeof req.body?.report === "string" ? req.body.report.trim() : "";
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return res.status(400).json({ error: "Invalid project ID" });
  if (req.body?.progress_percent === "" || req.body?.progress_percent == null || !Number.isInteger(progress) || progress < 0 || progress > 100) return res.status(400).json({ error: "Progress must be a whole number from 0 to 100" });
  if (!report || report.length > 4000) return res.status(400).json({ error: "A progress report of up to 4000 characters is required" });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [projects] = await conn.execute("SELECT id, status, handover_date FROM projects WHERE id = ? FOR UPDATE", [projectId]);
    const project = (projects as Array<{ status: string; handover_date: string | null }>)[0];
    if (!project) { await conn.rollback(); return res.status(404).json({ error: "Project not found" }); }
    if (req.user!.mode === "employee") {
      const [assignments] = await conn.execute("SELECT pa.id FROM project_assignments pa JOIN employees e ON e.id = pa.employee_id WHERE pa.project_id = ? AND pa.removed_at IS NULL AND e.id = (SELECT employee_id FROM users WHERE id = ?) FOR UPDATE", [projectId, req.user!.id]);
      if (!(assignments as object[]).length || project.status === "handed_over" || project.handover_date !== null) { await conn.rollback(); return res.status(404).json({ error: "Project not found" }); }
    }
    const [result] = await conn.execute("INSERT INTO project_progress_updates (project_id, progress_percent, report, created_by) VALUES (?, ?, ?, ?)", [projectId, progress, report, req.user!.id]);
    const id = Number((result as { insertId: number }).insertId);
    await audit(req.user!.id, "update", "project", projectId, { progress_update_id: id, progress_percent: progress }, req.ip ?? null, conn);
    await conn.commit();
    res.status(201).json({ id });
  } catch (error) { await conn.rollback(); next(error); } finally { conn.release(); }
});

router.use(requirePermission("projects:manage"));

router.get("/", async (_req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.id, p.name, p.status, p.start_date, p.end_date, p.handover_date,
              p.expected_handover_date, p.project_value, p.value_currency,
              p.sales_tax_percent,
              ROUND(COALESCE(p.project_value, 0) * COALESCE(p.sales_tax_percent, 0) / 100, 2) AS tax_amount,
              ROUND(COALESCE(p.project_value, 0) * (1 + COALESCE(p.sales_tax_percent, 0) / 100), 2) AS total_payable,
              COALESCE((SELECT SUM(${projectAppliedSql("p.value_currency")}) FROM transactions t JOIN finance_categories fc ON fc.id = t.category_id
                        WHERE t.project_id = p.id AND t.type = 'inflow' AND fc.name = 'client_payment'), 0) AS total_paid,
              GREATEST(ROUND(COALESCE(p.project_value, 0) * (1 + COALESCE(p.sales_tax_percent, 0) / 100), 2) -
                COALESCE((SELECT SUM(${projectAppliedSql("p.value_currency")}) FROM transactions t JOIN finance_categories fc ON fc.id = t.category_id
                          WHERE t.project_id = p.id AND t.type = 'inflow' AND fc.name = 'client_payment'), 0), 0) AS remaining_balance,
              c.id AS client_id, c.company_name AS client_name,
              COUNT(pa.id) AS team_size,
              COALESCE((SELECT ppu.progress_percent FROM project_progress_updates ppu WHERE ppu.project_id = p.id ORDER BY ppu.created_at DESC, ppu.id DESC LIMIT 1), 0) AS current_progress,
              (SELECT ppu.report FROM project_progress_updates ppu WHERE ppu.project_id = p.id ORDER BY ppu.created_at DESC, ppu.id DESC LIMIT 1) AS latest_update
       FROM projects p
       JOIN clients c ON c.id = p.client_id
       LEFT JOIN project_assignments pa ON pa.project_id = p.id AND pa.removed_at IS NULL
       GROUP BY p.id
       ORDER BY FIELD(p.status, 'ongoing', 'upcoming', 'done', 'handed_over'), p.name`
    );
    res.json({ projects: rows });
  } catch (err) { next(err); }
});

router.post("/", async (req: AuthedRequest, res, next) => {
  try {
    const { client_id, name, description, status, start_date, end_date, expected_handover_date, project_value, sales_tax_percent = null, value_currency } = req.body ?? {};
    if (!client_id || !name || !expected_handover_date) return res.status(400).json({ error: "Client, project name, and expected handover date are required" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expected_handover_date))) return res.status(400).json({ error: "Expected handover date is invalid" });
    const taxPercent = sales_tax_percent === null ? null : Number(sales_tax_percent);
    if (taxPercent !== null && (typeof sales_tax_percent === "boolean" || String(sales_tax_percent).trim() === "" || !Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100)) return res.status(400).json({ error: "Sales tax must be between 0 and 100 percent" });

    if (start_date && ((end_date && end_date < start_date) || expected_handover_date < start_date)) {
      return res.status(400).json({ error: "End/expected handover date cannot be before the start date" });
    }

    const [result] = await pool.execute(
      `INSERT INTO projects (client_id, name, description, status, start_date, end_date, expected_handover_date, project_value, sales_tax_percent, value_currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [client_id, name, description ?? null, status ?? "upcoming", start_date ?? null, end_date ?? null, expected_handover_date,
       project_value ?? null, taxPercent, value_currency ?? "USD"]
    );
    const id = (result as any).insertId;
    await audit(req.user!.id, "create", "project", id, { name }, req.ip ?? null);
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.*, c.company_name AS client_name
       FROM projects p JOIN clients c ON c.id = p.client_id
       WHERE p.id = ? LIMIT 1`,
      [req.params.id]
    );
    const project = (rows as any[])[0];
    if (!project) return res.status(404).json({ error: "Project not found" });

    const [team] = await pool.execute(
      `SELECT pa.id AS assignment_id, e.id AS employee_id, e.full_name, e.designation,
              pa.role_on_project, pa.assigned_at
       FROM project_assignments pa
       JOIN employees e ON e.id = pa.employee_id
       WHERE pa.project_id = ? AND pa.removed_at IS NULL
       ORDER BY e.full_name`,
      [req.params.id]
    );
    const [progress] = await pool.execute(
      `SELECT ppu.id, ppu.progress_percent, ppu.report, ppu.created_at, u.full_name AS created_by_name
       FROM project_progress_updates ppu JOIN users u ON u.id = ppu.created_by
       WHERE ppu.project_id = ? ORDER BY ppu.created_at DESC, ppu.id DESC`,
      [req.params.id],
    );
    const [requirementRows] = await pool.execute(
      `SELECT pr.id AS requirement_id, pr.project_id, pr.client_id, pr.current_version,
              pr.created_at AS requirement_created_at, pr.updated_at AS requirement_updated_at,
              c.company_name AS client_name, pr.attachment_name, prv.version_number, prv.content, prv.created_at AS version_created_at
       FROM project_requirements pr
       JOIN clients c ON c.id = pr.client_id
       JOIN project_requirement_versions prv ON prv.requirement_id = pr.id
       WHERE pr.project_id = ?
       ORDER BY pr.updated_at DESC, pr.id DESC, prv.version_number DESC`,
      [req.params.id],
    );
    const billing = await loadProjectBilling(Number(req.params.id));
    res.json({ project: billing ? { ...project, ...billing } : project, team, progress_updates: progress, requirements: groupRequirementRows(requirementRows as RequirementVersionRow[]) });
  } catch (err) { next(err); }
});

router.put("/:id", requireSuperPassword, async (req: AuthedRequest, res, next) => {
  try {
    const [dateRows] = await pool.execute("SELECT start_date, end_date, expected_handover_date, sales_tax_percent FROM projects WHERE id = ?", [req.params.id]);
    const currentDates = (dateRows as any[])[0];
    if (!currentDates) return res.status(404).json({ error: "Project not found" });
    const dateKey = (value: any) => value instanceof Date ? value.toISOString().slice(0, 10) : value;
    const start = dateKey(req.body.start_date !== undefined ? req.body.start_date : currentDates.start_date);
    const end = dateKey(req.body.end_date !== undefined ? req.body.end_date : currentDates.end_date);
    const expected = dateKey(req.body.expected_handover_date !== undefined ? req.body.expected_handover_date : currentDates.expected_handover_date);
    if (start && ((end && end < start) || (expected && expected < start))) {
      return res.status(400).json({ error: "End/expected handover date cannot be before the start date" });
    }
    if (req.body.expected_handover_date !== undefined
      && !/^\d{4}-\d{2}-\d{2}$/.test(String(req.body.expected_handover_date))) {
      return res.status(400).json({ error: "Expected handover date is required and must be valid" });
    }
    if (req.body.sales_tax_percent !== undefined) {
      const taxPercent = req.body.sales_tax_percent === null ? null : Number(req.body.sales_tax_percent);
      if (taxPercent !== null && (typeof req.body.sales_tax_percent === "boolean" || String(req.body.sales_tax_percent).trim() === "" || !Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100)) return res.status(400).json({ error: "Sales tax must be between 0 and 100 percent" });
      req.body.sales_tax_percent = taxPercent;
    }

    const allowed = ["client_id", "name", "description", "status", "start_date", "end_date",
                     "expected_handover_date", "handover_date", "project_value", "sales_tax_percent", "value_currency"];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(req.body[key]); }
    }
    if (req.body.status === "handed_over" && req.body.handover_date === undefined) {
      sets.push("handover_date = CURDATE()");
    }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    vals.push(req.params.id);
    await pool.execute(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`, vals);
    await audit(req.user!.id, "update", "project", Number(req.params.id), { fields: sets.map(s => s.split(" ")[0]) }, req.ip ?? null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});


router.post("/:id/assign", async (req: AuthedRequest, res, next) => {
  try {
    const { employee_id, role_on_project } = req.body ?? {};
    if (!employee_id) return res.status(400).json({ error: "employee_id is required" });
    try {
      await pool.execute(
        `INSERT INTO project_assignments (project_id, employee_id, role_on_project, assigned_at)
         VALUES (?, ?, ?, CURDATE())`,
        [req.params.id, employee_id, role_on_project ?? null]
      );
    } catch (e: any) {
      if (e.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "Already assigned to this project" });
      throw e;
    }
    await audit(req.user!.id, "update", "project", Number(req.params.id), { assigned: employee_id }, req.ip ?? null);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

router.delete("/:id/assign/:assignmentId", async (req: AuthedRequest, res, next) => {
  try {
    await pool.execute(
      "UPDATE project_assignments SET removed_at = CURDATE() WHERE id = ? AND project_id = ?",
      [req.params.assignmentId, req.params.id]
    );
    await audit(req.user!.id, "update", "project", Number(req.params.id), { unassigned: req.params.assignmentId }, req.ip ?? null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE — requires Super Password; blocked if project has linked transactions
router.delete("/:id", requireSuperPassword, async (req: AuthedRequest, res, next) => {
  try {
    // Check for linked transactions first
    const [txnCheck] = await pool.execute(
      "SELECT COUNT(*) AS c FROM transactions WHERE project_id = ?",
      [req.params.id]
    );
    if ((txnCheck as any[])[0].c > 0) {
      return res.status(409).json({
        error: "Cannot delete this project — it has linked transactions. Go to Finance, filter by this project, delete those transactions first, then delete the project."
      });
    }

    // Check for other FK references
    await pool.execute("DELETE FROM project_assignments WHERE project_id = ?", [req.params.id]);
    await pool.execute("DELETE FROM projects WHERE id = ?", [req.params.id]);
    await audit(req.user!.id, "delete", "project", Number(req.params.id), null, req.ip ?? null);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(409).json({
        error: "Cannot delete this project — it has linked records. Remove linked transactions first."
      });
    }
    next(err);
  }
});

export default router;
