import { Response, Router } from "express";
import fs from "fs";
import path from "path";
import { pool } from "../db";
import { getPortalNotifications, readPortalNotification } from "../employees/portalNotifications";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth";
import { groupRequirementRows, RequirementVersionRow } from "../projects/requirements";
import { loadProjectBilling } from "../finance/projectBilling";
import { parseRequirementAttachment, storeRequirementAttachment, removeRequirementAttachment, streamRequirementAttachment } from "../projects/requirementAttachments";

const router = Router();
router.use(requireAuth, requireRole("client"));
const transactionUploadDir = path.join(process.cwd(), "uploads", "transactions");

router.get("/notifications", getPortalNotifications);
router.post("/notifications/read", readPortalNotification);

router.get("/projects", async (req: AuthedRequest, res, next) => {
  try {
    const clientId = req.user!.client_id;
    if (!clientId) return res.status(403).json({ error: "Client account is not linked" });
    const [rows] = await pool.execute(
      `SELECT p.id, p.name, p.description, p.status, p.start_date, p.end_date,
              p.expected_handover_date, p.project_value, p.sales_tax_percent, p.value_currency,
              COALESCE((SELECT ppu.progress_percent FROM project_progress_updates ppu
                        WHERE ppu.project_id = p.id ORDER BY ppu.created_at DESC, ppu.id DESC LIMIT 1), 0) AS current_progress,
              (SELECT ppu.report FROM project_progress_updates ppu
               WHERE ppu.project_id = p.id ORDER BY ppu.created_at DESC, ppu.id DESC LIMIT 1) AS latest_update
       FROM projects p
       WHERE p.client_id = ?
       ORDER BY FIELD(p.status, 'ongoing', 'upcoming', 'done', 'handed_over'), p.name`,
      [clientId],
    );
    res.json({ projects: rows });
  } catch (error) { next(error); }
});

router.get("/projects/:id", async (req: AuthedRequest, res, next) => {
  try {
    const clientId = req.user!.client_id;
    if (!clientId) return res.status(403).json({ error: "Client account is not linked" });
    const [rows] = await pool.execute(
      `SELECT p.id, p.name, p.description, p.status, p.start_date, p.end_date,
              p.expected_handover_date, p.project_value, p.sales_tax_percent, p.value_currency,
              COALESCE((SELECT ppu.progress_percent FROM project_progress_updates ppu
                        WHERE ppu.project_id = p.id ORDER BY ppu.created_at DESC, ppu.id DESC LIMIT 1), 0) AS current_progress
       FROM projects p WHERE p.id = ? AND p.client_id = ? LIMIT 1`,
      [req.params.id, clientId],
    );
    const project = (rows as any[])[0];
    if (!project) return res.status(404).json({ error: "Project not found" });
    const [updates] = await pool.execute(
      `SELECT id, progress_percent, report, created_at
       FROM project_progress_updates WHERE project_id = ?
       ORDER BY created_at DESC, id DESC`,
      [project.id],
    );
    const [requirementRows] = await pool.execute(
      `SELECT pr.id AS requirement_id, pr.project_id, pr.client_id, pr.current_version,
              pr.created_at AS requirement_created_at, pr.updated_at AS requirement_updated_at, pr.attachment_name,
              prv.version_number, prv.content, prv.created_at AS version_created_at
       FROM project_requirements pr JOIN project_requirement_versions prv ON prv.requirement_id = pr.id
       WHERE pr.project_id = ? AND pr.client_id = ?
       ORDER BY pr.updated_at DESC, pr.id DESC, prv.version_number DESC`,
      [project.id, clientId],
    );
    const [transactions] = await pool.execute(
      `SELECT t.id, t.txn_date, t.invoice_number, t.description, t.amount, t.currency,
              COALESCE(NULLIF(t.custom_category, ''), fc.name) AS category,
              (t.invoice_path IS NOT NULL) AS has_invoice,
              (t.attachment_path IS NOT NULL) AS has_receipt,
              t.attachment_name
       FROM transactions t
       JOIN finance_categories fc ON fc.id = t.category_id
       JOIN projects owned_project ON owned_project.id = t.project_id AND owned_project.client_id = ?
       WHERE t.project_id = ?
       ORDER BY t.txn_date DESC, t.id DESC`,
      [clientId, project.id],
    );
    const billing = await loadProjectBilling(Number(project.id));
    res.json({ project: billing ? { ...project, ...billing } : project, progress_updates: updates, requirements: groupRequirementRows(requirementRows as RequirementVersionRow[]), transactions });
  } catch (error) { next(error); }
});

async function streamOwnedTransactionDocument(
  req: AuthedRequest,
  res: Response,
  kind: "invoice" | "receipt",
) {
  const clientId = req.user!.client_id;
  if (!clientId) return res.status(403).json({ error: "Client account is not linked" });
  const [rows] = await pool.execute(
    `SELECT t.invoice_number, t.invoice_path, t.attachment_path, t.attachment_name, t.attachment_mime, t.txn_date
     FROM transactions t
     JOIN projects p ON p.id = t.project_id
     WHERE t.id = ? AND p.client_id = ?
     LIMIT 1`,
    [req.params.id, clientId],
  );
  const transaction = (rows as Array<Record<string, unknown>>)[0];
  const storedPath = kind === "invoice" ? transaction?.invoice_path : transaction?.attachment_path;
  if (!transaction || typeof storedPath !== "string" || !storedPath) {
    return res.status(404).json({ error: kind === "invoice" ? "Invoice not found" : "Receipt not found" });
  }
  const safeFilename = path.basename(storedPath);
  const fullPath = path.join(transactionUploadDir, safeFilename);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "Document file not found" });

  const displayName = kind === "invoice"
    ? `${String(transaction.invoice_number || `Project-Transaction-${String(transaction.txn_date).slice(0, 10)}`)}.pdf`
    : String(transaction.attachment_name || safeFilename);
  const encodedName = encodeURIComponent(displayName);
  res.setHeader("Content-Type", kind === "invoice" ? "application/pdf" : String(transaction.attachment_mime || "application/octet-stream"));
  res.setHeader("Content-Disposition", `${req.query.preview === "1" ? "inline" : "attachment"}; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
  fs.createReadStream(fullPath).pipe(res);
}

router.get("/transactions/:id/invoice", async (req: AuthedRequest, res, next) => {
  try { await streamOwnedTransactionDocument(req, res, "invoice"); } catch (error) { next(error); }
});

router.get("/transactions/:id/receipt", async (req: AuthedRequest, res, next) => {
  try { await streamOwnedTransactionDocument(req, res, "receipt"); } catch (error) { next(error); }
});

router.get("/requirements/:id/attachment", streamRequirementAttachment);

router.post("/projects/:id/requirements", parseRequirementAttachment, async (req: AuthedRequest, res, next) => {
  const clientId = req.user!.client_id;
  const projectId = Number(req.params.id);
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!clientId) return res.status(403).json({ error: "Client account is not linked" });
  if (!Number.isInteger(projectId) || projectId <= 0) return res.status(400).json({ error: "Invalid project ID" });
  if (!content || content.length > 4000) return res.status(400).json({ error: "Requirement must be between 1 and 4000 characters" });
  const connection = await pool.getConnection();
  let attachment: ReturnType<typeof storeRequirementAttachment> = null;
  try {
    await connection.beginTransaction();
    const [projects] = await connection.execute("SELECT id FROM projects WHERE id = ? AND client_id = ? LIMIT 1 FOR UPDATE", [projectId, clientId]);
    if (!(projects as object[]).length) { await connection.rollback(); return res.status(404).json({ error: "Project not found" }); }
    try { attachment = storeRequirementAttachment(req.file); } catch { await connection.rollback(); return res.status(400).json({ error: "Invalid attachment content" }); }
    const [result] = await connection.execute("INSERT INTO project_requirements (project_id, client_id, current_version, attachment_path, attachment_name, attachment_mime, attachment_size) VALUES (?, ?, 1, ?, ?, ?, ?)", [projectId, clientId, attachment?.filename ?? null, attachment?.name ?? null, attachment?.mime ?? null, attachment?.size ?? null]);
    const requirementId = Number((result as any).insertId);
    await connection.execute("INSERT INTO project_requirement_versions (requirement_id, version_number, content) VALUES (?, 1, ?)", [requirementId, content]);
    await connection.commit();
    res.status(201).json({ id: requirementId });
  } catch (error) { await connection.rollback(); if (attachment) removeRequirementAttachment(attachment.filename); next(error); }
  finally { connection.release(); }
});

router.put("/requirements/:id", async (req: AuthedRequest, res, next) => {
  const clientId = req.user!.client_id;
  const requirementId = Number(req.params.id);
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!clientId) return res.status(403).json({ error: "Client account is not linked" });
  if (!Number.isInteger(requirementId) || requirementId <= 0) return res.status(400).json({ error: "Invalid requirement ID" });
  if (!content || content.length > 4000) return res.status(400).json({ error: "Requirement must be between 1 and 4000 characters" });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT pr.id, pr.current_version FROM project_requirements pr
       JOIN projects p ON p.id = pr.project_id
       WHERE pr.id = ? AND pr.client_id = ? AND p.client_id = ? FOR UPDATE`,
      [requirementId, clientId, clientId],
    );
    const requirement = (rows as any[])[0];
    if (!requirement) { await connection.rollback(); return res.status(404).json({ error: "Requirement not found" }); }
    const nextVersion = Number(requirement.current_version) + 1;
    await connection.execute("INSERT INTO project_requirement_versions (requirement_id, version_number, content) VALUES (?, ?, ?)", [requirementId, nextVersion, content]);
    await connection.execute("UPDATE project_requirements SET current_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [nextVersion, requirementId]);
    await connection.commit();
    res.json({ ok: true, version: nextVersion });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

export default router;
