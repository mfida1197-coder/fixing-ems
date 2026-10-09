import { NextFunction, Response, Router } from "express";
import { ResultSetHeader } from "mysql2/promise";
import { audit } from "../audit";
import { buildApplicationPdf } from "../applications/applicationPdf";
import { pool } from "../db";
import { karachiDate } from "../finance/invoice";
import { AuthedRequest, requireAuth, requirePermission, requireSelectedMode } from "../middleware/auth";

const router = Router();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(["pending", "approved", "rejected"]);

type ApplicationInput = {
  category: string;
  subject: string;
  applicationDate: string;
  body: string;
};

type EmployeeSnapshot = {
  id: number;
  employee_code: string;
  full_name: string;
  designation: string;
};

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseInput(body: Record<string, unknown>): { value?: ApplicationInput; error?: string } {
  const category = cleanText(body.category, 100);
  const subject = cleanText(body.subject, 200);
  const applicationDate = cleanText(body.application_date, 10);
  const applicationBody = cleanText(body.body, 12000);
  if (category.length < 2) return { error: "Application type/category is required" };
  if (subject.length < 3) return { error: "Subject must be at least 3 characters" };
  if (!DATE_PATTERN.test(applicationDate)) return { error: "A valid application date is required" };
  if (applicationDate > karachiDate()) return { error: "Application date cannot be in the future" };
  if (applicationBody.length < 10) return { error: "Application body must be at least 10 characters" };
  return { value: { category, subject, applicationDate, body: applicationBody } };
}

function selfEmployeeId(req: AuthedRequest): number | null {
  if (req.user?.role !== "employee") return null;
  return positiveId(req.user.employee_id);
}

async function employeeSnapshot(employeeId: number): Promise<EmployeeSnapshot | null> {
  const [rows] = await pool.execute(
    "SELECT id, employee_code, full_name, designation FROM employees WHERE id = ? LIMIT 1",
    [employeeId],
  );
  return (rows as EmployeeSnapshot[])[0] ?? null;
}

function safeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "EMPLOYEE";
}

function applicationFilename(employeeCode: string, applicationDate: string, id?: number): string {
  return `APPLICATION-${safeCode(employeeCode)}-${applicationDate}${id ? `-${id}` : "-PREVIEW"}.pdf`;
}

function sqlDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").slice(0, 10);
}

async function renderApplication(row: Record<string, unknown>): Promise<Buffer> {
  return buildApplicationPdf({
    applicationDate: sqlDate(row.application_date),
    category: String(row.category),
    subject: String(row.subject),
    body: String(row.body_text),
    employeeName: String(row.employee_name_snapshot),
    employeeCode: String(row.employee_code_snapshot),
    designation: String(row.designation_snapshot),
    submittedAt: row.submitted_at ? String(row.submitted_at) : null,
    status: row.status ? String(row.status) : null,
  });
}

function sendExpected(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof Error && error.message.startsWith("APP_")) {
    const [code, message] = error.message.split("|", 2);
    const status = code === "APP_NOT_FOUND" ? 404 : code === "APP_FINAL" ? 409 : 400;
    return res.status(status).json({ error: message, code });
  }
  next(error);
}

router.use(requireAuth, requireSelectedMode);

router.get("/me", async (req: AuthedRequest, res, next) => {
  try {
    const employeeId = selfEmployeeId(req);
    if (!employeeId) return res.status(403).json({ error: "Employee mode with a linked employee record is required" });
    const [rows] = await pool.execute(
      `SELECT a.id, a.category, a.subject, a.application_date, a.status, a.submitted_at,
              a.reviewed_at, a.review_note, reviewer.full_name AS reviewed_by_name
       FROM general_applications a
       LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by
       WHERE a.employee_id = ?
       ORDER BY a.submitted_at DESC, a.id DESC
       LIMIT 200`,
      [employeeId],
    );
    return res.json({ applications: rows });
  } catch (error) {
    next(error);
  }
});

router.post("/me/preview", async (req: AuthedRequest, res, next) => {
  try {
    const employeeId = selfEmployeeId(req);
    if (!employeeId) return res.status(403).json({ error: "Employee mode with a linked employee record is required" });
    const parsed = parseInput(req.body ?? {});
    if (!parsed.value) return res.status(400).json({ error: parsed.error });
    const employee = await employeeSnapshot(employeeId);
    if (!employee) return res.status(404).json({ error: "Employee record not found" });
    const pdf = await buildApplicationPdf({
      applicationDate: parsed.value.applicationDate,
      category: parsed.value.category,
      subject: parsed.value.subject,
      body: parsed.value.body,
      employeeName: employee.full_name,
      employeeCode: employee.employee_code,
      designation: employee.designation,
      status: "Draft preview",
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${applicationFilename(employee.employee_code, parsed.value.applicationDate)}"`);
    return res.send(pdf);
  } catch (error) {
    next(error);
  }
});

router.post("/me", async (req: AuthedRequest, res, next) => {
  try {
    const employeeId = selfEmployeeId(req);
    if (!employeeId) return res.status(403).json({ error: "Employee mode with a linked employee record is required" });
    const parsed = parseInput(req.body ?? {});
    if (!parsed.value) return res.status(400).json({ error: parsed.error });
    const employee = await employeeSnapshot(employeeId);
    if (!employee) return res.status(404).json({ error: "Employee record not found" });
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO general_applications
         (employee_id, submitted_by, category, subject, application_date, body_text, status,
          employee_name_snapshot, employee_code_snapshot, designation_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        employeeId, req.user!.id, parsed.value.category, parsed.value.subject,
        parsed.value.applicationDate, parsed.value.body, employee.full_name,
        employee.employee_code, employee.designation,
      ],
    );
    void notifyEmployeeRequest(employeeId, "General Application");
    return res.status(201).json({ id: result.insertId, status: "pending" });
  } catch (error) {
    next(error);
  }
});

router.get("/me/:id", async (req: AuthedRequest, res, next) => {
  try {
    const employeeId = selfEmployeeId(req);
    const id = positiveId(req.params.id);
    if (!employeeId) return res.status(403).json({ error: "Employee mode with a linked employee record is required" });
    if (!id) return res.status(400).json({ error: "Invalid application ID" });
    const [rows] = await pool.execute(
      `SELECT a.id, a.category, a.subject, a.application_date, a.body_text, a.status,
              a.submitted_at, a.reviewed_at, a.review_note, reviewer.full_name AS reviewed_by_name
       FROM general_applications a
       LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by
       WHERE a.id = ? AND a.employee_id = ? LIMIT 1`,
      [id, employeeId],
    );
    const application = (rows as object[])[0];
    if (!application) return res.status(404).json({ error: "Application not found" });
    return res.json({ application });
  } catch (error) {
    next(error);
  }
});

router.get("/me/:id/pdf", async (req: AuthedRequest, res, next) => {
  try {
    const employeeId = selfEmployeeId(req);
    const id = positiveId(req.params.id);
    if (!employeeId) return res.status(403).json({ error: "Employee mode with a linked employee record is required" });
    if (!id) return res.status(400).json({ error: "Invalid application ID" });
    const [rows] = await pool.execute("SELECT * FROM general_applications WHERE id = ? AND employee_id = ? LIMIT 1", [id, employeeId]);
    const application = (rows as Array<Record<string, unknown>>)[0];
    if (!application) return res.status(404).json({ error: "Application not found" });
    const pdf = await renderApplication(application);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${applicationFilename(String(application.employee_code_snapshot), sqlDate(application.application_date), id)}"`);
    return res.send(pdf);
  } catch (error) {
    next(error);
  }
});

router.use(requirePermission("applications:manage"));

router.get("/", async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "all";
    if (status !== "all" && !STATUSES.has(status)) return res.status(400).json({ error: "Invalid application status" });
    const where = status === "all" ? "" : "WHERE a.status = ?";
    const [rows] = await pool.execute(
      `SELECT a.id, a.employee_id, a.category, a.subject, a.application_date, a.status,
              a.submitted_at, a.reviewed_at, a.review_note, a.employee_name_snapshot,
              a.employee_code_snapshot, a.designation_snapshot,
              reviewer.full_name AS reviewed_by_name
       FROM general_applications a
       LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by
       ${where}
       ORDER BY (a.status = 'pending') DESC, a.submitted_at DESC, a.id DESC
       LIMIT 300`,
      status === "all" ? [] : [status],
    );
    return res.json({ applications: rows });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid application ID" });
    const [rows] = await pool.execute(
      `SELECT a.*, reviewer.full_name AS reviewed_by_name
       FROM general_applications a
       LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by
       WHERE a.id = ? LIMIT 1`,
      [id],
    );
    const application = (rows as object[])[0];
    if (!application) return res.status(404).json({ error: "Application not found" });
    return res.json({ application });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/pdf", async (req, res, next) => {
  try {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid application ID" });
    const [rows] = await pool.execute("SELECT * FROM general_applications WHERE id = ? LIMIT 1", [id]);
    const application = (rows as Array<Record<string, unknown>>)[0];
    if (!application) return res.status(404).json({ error: "Application not found" });
    const pdf = await renderApplication(application);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${applicationFilename(String(application.employee_code_snapshot), sqlDate(application.application_date), id)}"`);
    return res.send(pdf);
  } catch (error) {
    next(error);
  }
});

async function decide(req: AuthedRequest, res: Response, next: NextFunction, status: "approved" | "rejected") {
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid application ID" });
  const note = cleanText(req.body?.note, 500) || null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT id, employee_id, status FROM general_applications WHERE id = ? LIMIT 1 FOR UPDATE",
      [id],
    );
    const application = (rows as Array<{ id: number; employee_id: number; status: string }>)[0];
    if (!application) throw new Error("APP_NOT_FOUND|Application not found");
    if (application.status !== "pending") throw new Error("APP_FINAL|This application has already been reviewed");
    await connection.execute(
      "UPDATE general_applications SET status = ?, reviewed_at = NOW(), reviewed_by = ?, review_note = ? WHERE id = ?",
      [status, req.user!.id, note, id],
    );
    await audit(
      req.user!.id,
      "update",
      "general_application",
      id,
      { decision: status, employee_id: application.employee_id, has_review_note: Boolean(note) },
      req.ip ?? null,
      connection,
    );
    await connection.commit();
    return res.json({ ok: true, status });
  } catch (error) {
    await connection.rollback();
    return sendExpected(error, res, next);
  } finally {
    connection.release();
  }
}

router.post("/:id/approve", (req: AuthedRequest, res, next) => decide(req, res, next, "approved"));
router.post("/:id/reject", (req: AuthedRequest, res, next) => decide(req, res, next, "rejected"));

export default router;
import { notifyEmployeeRequest } from "../email/gmail";
