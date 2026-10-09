import { Router } from "express";
import { pool } from "../db";
import { audit } from "../audit";
import { AuthedRequest, requireAuth, requirePermission, requireSelectedMode } from "../middleware/auth";
import { buildEmployeeLetterPdf, EmployeeLetterPdfData, EmployeeLetterType } from "../employees/employeeLetterPdf";
import { emailValid, senderSlot, sendEmail } from "../email/gmail";
import { generateIssuedLetterPdf } from "../employees/issuedLetterStorage";
import { getPortalNotifications, readPortalNotification } from "../employees/portalNotifications";

const router = Router();
const LETTER_TYPES = new Set<EmployeeLetterType>(["hiring", "promotion", "termination"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

router.use(requireAuth, requireSelectedMode);

const employeeOnly = (req: AuthedRequest, res: import("express").Response, next: import("express").NextFunction) => {
  if (req.user?.mode !== "employee") return res.status(403).json({ error: "Forbidden" });
  next();
};

router.get("/me/notifications", employeeOnly, getPortalNotifications);
router.post("/me/notifications/read", employeeOnly, readPortalNotification);
router.get("/me", employeeOnly, async (req: AuthedRequest, res, next) => {
  try {
    const [rows] = await pool.execute(`SELECT l.id, l.letter_type, l.subject, DATE_FORMAT(l.issue_date, '%Y-%m-%d') AS issue_date, DATE_FORMAT(l.effective_date, '%Y-%m-%d') AS effective_date, l.file_name, (l.employee_read_at IS NULL) AS unread, (l.employee_downloaded_at IS NOT NULL) AS downloaded FROM employee_letters l JOIN employees e ON e.id = l.employee_id WHERE e.id = (SELECT employee_id FROM users WHERE id = ?) AND l.delivered_at IS NOT NULL ORDER BY l.created_at DESC, l.id DESC LIMIT 200`, [req.user!.id]);
    res.json({ letters: rows });
  } catch (error) { next(error); }
});
router.post("/me/read", employeeOnly, async (req: AuthedRequest, res, next) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return res.status(400).json({ error: "Invalid letters" });
  try {
    if (ids.length) await pool.query(`UPDATE employee_letters l JOIN employees e ON e.id = l.employee_id SET l.employee_read_at = COALESCE(l.employee_read_at, UTC_TIMESTAMP(6)) WHERE e.id = (SELECT employee_id FROM users WHERE id = ?) AND l.delivered_at IS NOT NULL AND l.id IN (?)`, [req.user!.id, ids]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});
router.get("/me/:id/pdf", employeeOnly, async (req: AuthedRequest, res, next) => {
  if (req.method === "HEAD") return res.status(405).end();
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid letter" });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(`SELECT l.* FROM employee_letters l JOIN employees e ON e.id = l.employee_id WHERE l.id = ? AND e.id = (SELECT employee_id FROM users WHERE id = ?) AND l.delivered_at IS NOT NULL FOR UPDATE`, [id, req.user!.id]);
    const letter = (rows as Array<Record<string, unknown>>)[0];
    if (!letter) { await conn.rollback(); return res.status(404).json({ error: "Letter not found" }); }
    if (letter.employee_downloaded_at) { await conn.rollback(); return res.status(409).json({ error: "This letter has already been downloaded." }); }
    let pdf: Buffer;
    try { pdf = await generateIssuedLetterPdf(letter); } catch { await conn.rollback(); return res.status(404).json({ error: "Letter PDF unavailable" }); }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${letter.file_name}"`);
    // Hold the row lock until server-side delivery finishes; concurrent downloads
    // cannot both consume the same letter. Aborted responses leave it available.
    const sent = await new Promise<boolean>((resolve) => {
      res.once("finish", () => resolve(true)); res.once("close", () => resolve(res.writableFinished));
      res.send(pdf);
    });
    if (sent) {
      await conn.execute("UPDATE employee_letters SET employee_downloaded_at = UTC_TIMESTAMP(6), employee_read_at = COALESCE(employee_read_at, UTC_TIMESTAMP(6)) WHERE id = ?", [id]);
      await conn.commit();
    } else await conn.rollback();
  } catch (error) { await conn.rollback(); if (!res.headersSent) next(error); else console.error("Employee letter download state could not be finalized"); }
  finally { conn.release(); }
});

router.use(requirePermission("employee_letters:manage"));

type EmployeeSnapshot = {
  id: number;
  employee_code: string;
  full_name: string;
  designation: string;
  assigned_project: string | null;
  email: string | null;
};

type LetterInput = {
  employeeId: number;
  letterType: EmployeeLetterType;
  issueDate: string;
  effectiveDate: string;
  subject: string;
  body: string;
  newDesignation: string | null;
  notes: string | null;
};

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseInput(body: Record<string, unknown>): { value?: LetterInput; error?: string } {
  const employeeId = Number(body.employee_id);
  const letterType = String(body.letter_type ?? "") as EmployeeLetterType;
  const issueDate = cleanText(body.issue_date, 10);
  const effectiveDate = cleanText(body.effective_date, 10);
  const subject = cleanText(body.subject, 200);
  const letterBody = cleanText(body.body, 12000);
  const newDesignation = cleanText(body.new_designation, 100) || null;
  const notes = cleanText(body.notes, 500) || null;
  if (!Number.isInteger(employeeId) || employeeId <= 0) return { error: "Invalid employee ID" };
  if (!LETTER_TYPES.has(letterType)) return { error: "Invalid employee letter type" };
  if (!DATE_PATTERN.test(issueDate) || !DATE_PATTERN.test(effectiveDate)) return { error: "Valid issue and effective dates are required" };
  if (!subject) return { error: "Subject is required" };
  if (!letterBody) return { error: "Letter body is required" };
  if (letterType === "promotion" && !newDesignation) return { error: "New designation is required for a promotion letter" };
  return { value: { employeeId, letterType, issueDate, effectiveDate, subject, body: letterBody, newDesignation, notes } };
}

async function getEmployee(employeeId: number): Promise<EmployeeSnapshot | null> {
  const [rows] = await pool.execute(
    `SELECT e.id, e.employee_code, e.full_name, e.designation, e.email,
            p.name AS assigned_project
     FROM employees e
     LEFT JOIN project_assignments pa ON pa.employee_id = e.id AND pa.removed_at IS NULL
     LEFT JOIN projects p ON p.id = pa.project_id
     WHERE e.id = ?
     ORDER BY pa.id DESC
     LIMIT 1`,
    [employeeId],
  );
  return (rows as EmployeeSnapshot[])[0] ?? null;
}

function safeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "EMPLOYEE";
}

function fileName(letterType: EmployeeLetterType, employeeCode: string, issueDate: string): string {
  return `${letterType.toUpperCase()}-${safeCode(employeeCode)}-${issueDate}.pdf`;
}

function sqlDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? "");
  const direct = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (direct) return direct[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function pdfData(input: LetterInput, employee: EmployeeSnapshot): EmployeeLetterPdfData {
  return {
    letterType: input.letterType,
    issueDate: input.issueDate,
    effectiveDate: input.effectiveDate,
    subject: input.subject,
    body: input.body,
    employeeName: employee.full_name,
    employeeCode: employee.employee_code,
    designation: employee.designation,
    projectName: employee.assigned_project,
    newDesignation: input.newDesignation,
    notes: input.notes,
  };
}

router.get("/employee/:employeeId", async (req, res, next) => {
  try {
    const employeeId = Number(req.params.employeeId);
    if (!Number.isInteger(employeeId) || employeeId <= 0) return res.status(400).json({ error: "Invalid employee ID" });
    const [rows] = await pool.execute(
      `SELECT l.id, l.letter_type, l.issue_date, l.effective_date, l.subject,
              l.new_designation, l.notes, l.file_name, l.created_at,
              u.full_name AS created_by_name
       FROM employee_letters l
       LEFT JOIN users u ON u.id = l.created_by
       WHERE l.employee_id = ?
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT 200`,
      [employeeId],
    );
    return res.json({ letters: rows });
  } catch (error) {
    next(error);
  }
});

router.post("/preview", async (req, res, next) => {
  try {
    const parsed = parseInput(req.body ?? {});
    if (!parsed.value) return res.status(400).json({ error: parsed.error });
    const employee = await getEmployee(parsed.value.employeeId);
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const pdf = await buildEmployeeLetterPdf(pdfData(parsed.value, employee));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${fileName(parsed.value.letterType, employee.employee_code, parsed.value.issueDate)}"`);
    return res.send(pdf);
  } catch (error) {
    next(error);
  }
});

router.post("/send-email", async (req, res) => {
  try {
    const parsed = parseInput(req.body ?? {});
    if (!parsed.value) return res.status(400).json({ error: parsed.error });
    const employee = await getEmployee(parsed.value.employeeId);
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    if (!employee.email || !emailValid(employee.email)) return res.status(400).json({ error: "Employee email is not available. Add an email in Employee Details before sending." });
    let pdf: Buffer;
    if (req.body.letter_id !== undefined) {
      const letterId = Number(req.body.letter_id);
      if (!Number.isSafeInteger(letterId) || letterId <= 0) return res.status(400).json({ error: "Invalid letter" });
      const [rows] = await pool.execute("SELECT * FROM employee_letters WHERE id = ? AND employee_id = ? AND delivered_at IS NOT NULL", [letterId, employee.id]);
      const issued = (rows as Array<Record<string, unknown>>)[0];
      if (!issued) return res.status(404).json({ error: "Letter PDF unavailable" });
      pdf = await generateIssuedLetterPdf(issued);
    } else pdf = await buildEmployeeLetterPdf(pdfData(parsed.value, employee));
    await sendEmail(senderSlot(req.body.senderAccount), employee.email, String(req.body.emailSubject || parsed.value.subject), String(req.body.emailMessage || "Please find your official employee letter attached."), { name: fileName(parsed.value.letterType, employee.employee_code, parsed.value.issueDate), mime: "application/pdf", buffer: pdf });
    return res.json({ message: "Email sent successfully." });
  } catch { return res.status(400).json({ error: "Email could not be sent. Check the company email connection and try again." }); }
});

router.post("/", async (req: AuthedRequest, res, next) => {
  try {
    const parsed = parseInput(req.body ?? {});
    if (!parsed.value) return res.status(400).json({ error: parsed.error });
    const issuanceKey = String(req.body?.issuance_key ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issuanceKey)) return res.status(400).json({ error: "A valid issuance key is required" });
    const [existing] = await pool.execute("SELECT id, file_name FROM employee_letters WHERE created_by = ? AND issuance_key = ?", [req.user!.id, issuanceKey]);
    if ((existing as object[]).length) return res.json((existing as object[])[0]);
    const employee = await getEmployee(parsed.value.employeeId);
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const generatedFileName = fileName(parsed.value.letterType, employee.employee_code, parsed.value.issueDate);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(
        `INSERT INTO employee_letters
           (employee_id, letter_type, issue_date, effective_date, subject, body_text,
            new_designation, notes, employee_name_snapshot, employee_code_snapshot,
            designation_snapshot, project_snapshot, file_name, created_by, pdf_path, delivered_at, issuance_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?)`,
        [
          parsed.value.employeeId, parsed.value.letterType, parsed.value.issueDate,
          parsed.value.effectiveDate, parsed.value.subject, parsed.value.body,
          parsed.value.newDesignation, parsed.value.notes, employee.full_name,
          employee.employee_code, employee.designation, employee.assigned_project,
          generatedFileName, req.user!.id, null, issuanceKey,
        ],
      );
      const id = Number((result as { insertId: number }).insertId);
      await audit(
        req.user!.id,
        "create",
        "employee_letter",
        id,
        { employee_id: employee.id, letter_type: parsed.value.letterType, issue_date: parsed.value.issueDate },
        req.ip ?? null,
        connection,
      );
      await connection.commit();
      return res.status(201).json({ id, file_name: generatedFileName });
    } catch (error) {
      await connection.rollback();
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
        const [rows] = await pool.execute("SELECT id, file_name FROM employee_letters WHERE created_by = ? AND issuance_key = ?", [req.user!.id, issuanceKey]);
        if ((rows as object[]).length) return res.json((rows as object[])[0]);
      }
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
});

router.get("/:id/pdf", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid letter ID" });
    const [rows] = await pool.execute(
      `SELECT id, letter_type, issue_date, effective_date, subject, body_text,
              new_designation, notes, employee_name_snapshot, employee_code_snapshot,
              designation_snapshot, project_snapshot, file_name, pdf_path
       FROM employee_letters WHERE id = ? LIMIT 1`,
      [id],
    );
    const letter = (rows as Array<Record<string, unknown>>)[0];
    if (!letter) return res.status(404).json({ error: "Employee letter not found" });
    const pdf = await generateIssuedLetterPdf(letter);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${String(letter.file_name)}"`);
    return res.send(pdf);
  } catch (error) {
    next(error);
  }
});

export default router;
