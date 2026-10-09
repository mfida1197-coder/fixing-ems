import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { pool } from "../db";
import { audit } from "../audit";
import { requireAuth, requirePermission, requireSuperPassword, AuthedRequest } from "../middleware/auth";
import { buildInvoiceNumber, calculateInvoiceAmounts, karachiDate, minorToDecimal, parseMoneyToMinor } from "../finance/invoice";
import { buildInvoicePdf as buildClientInvoicePdf, InvoicePdfData } from "../finance/invoicePdf";
import { loadProjectBilling, ProjectBilling } from "../finance/projectBilling";
import { calculateProjectPayment } from "../finance/projectPayment";
import { accountAppliedSql, calculateAccountPayment } from "../finance/accountPayment";
import { netSalarySql } from "../finance/salary";
import { listPayroll, validatePayrollPeriod, lockPayrollEmployee, finalizePayroll } from "../finance/payroll";

const router = Router();
router.use(requireAuth, requirePermission("finance:manage"));

// Secure upload directory outside public static folders
const uploadDir = path.join(process.cwd(), "uploads", "transactions");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Allowed MIME types and extensions for invoice/receipt documents
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
];

const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
    cb(null, uniqueSuffix);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext) || !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error("Invalid file type. Only PDF, JPG, JPEG, PNG, and WEBP files are allowed."));
    }
    cb(null, true);
  },
});

async function allocateInvoiceSequence(conn: any, clientId: number, projectId: number): Promise<number> {
  await conn.query(
    `INSERT IGNORE INTO invoice_sequences (client_id, project_id, last_sequence)
     VALUES (?, ?, 0)`,
    [clientId, projectId],
  );
  const [rows] = await conn.query(
    `SELECT last_sequence FROM invoice_sequences
     WHERE client_id = ? AND project_id = ? FOR UPDATE`,
    [clientId, projectId],
  );
  const current = Number((rows as Array<{ last_sequence: number }>)[0]?.last_sequence ?? 0);
  const next = current + 1;
  await conn.query(
    `UPDATE invoice_sequences SET last_sequence = ?
     WHERE client_id = ? AND project_id = ?`,
    [next, clientId, projectId],
  );
  return next;
}

// CATEGORIES
router.get("/categories", async (_req, res) => {
  const [rows] = await pool.execute("SELECT id, type, name FROM finance_categories ORDER BY type, name");
  res.json({ categories: rows });
});

// Salary choices use the same net salary formula shown in Employee Details.
router.get("/payroll", async (req, res, next) => {
  try { res.json({ payroll: await listPayroll(req.query.period) }); }
  catch (error) { if ((error as any).statusCode) return res.status((error as any).statusCode).json({ error: (error as Error).message }); next(error); }
});
router.get("/salary-employees", async (_req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, employee_code, full_name, salary_currency,
            ${netSalarySql()} AS final_salary
     FROM employees
     WHERE status <> 'inactive'
       AND (basic_salary IS NOT NULL OR allowances IS NOT NULL OR deductions IS NOT NULL)
     ORDER BY full_name ASC`,
  );
  res.json({ employees: rows });
});

// ACCOUNTS CRUD & BALANCES
// LIST accounts with dynamic balance calculated from transactions
router.get("/accounts", async (_req, res) => {
  const [rows] = await pool.execute(
    `SELECT fa.id, fa.account_name, fa.bank_name, fa.account_number, fa.account_type,
            fa.currency, fa.initial_balance, fa.status, fa.created_at, fa.updated_at,
            CASE WHEN EXISTS (SELECT 1 FROM transactions t WHERE t.account_id = fa.id AND ${accountAppliedSql("fa.currency")} IS NULL) THEN NULL ELSE ROUND(fa.initial_balance
              + COALESCE((SELECT SUM(CASE
                  WHEN t.type = 'inflow' THEN ${accountAppliedSql("fa.currency")}
                  WHEN t.type = 'outflow' THEN -${accountAppliedSql("fa.currency")}
                  ELSE 0 END)
                FROM transactions t WHERE t.account_id = fa.id), 0)
              + COALESCE((SELECT SUM(ft.amount) FROM finance_account_transfers ft WHERE ft.to_account_id = fa.id), 0)
              - COALESCE((SELECT SUM(ft.amount) FROM finance_account_transfers ft WHERE ft.from_account_id = fa.id), 0), 2
            ) END AS current_balance,
            ((SELECT COUNT(*) FROM transactions t WHERE t.account_id = fa.id)
              + (SELECT COUNT(*) FROM finance_account_transfers ft
                 WHERE ft.from_account_id = fa.id OR ft.to_account_id = fa.id)) AS transaction_count
     FROM finance_accounts fa
     ORDER BY fa.status = 'active' DESC, fa.account_name ASC`
  );
  res.json({ accounts: rows });
});

// Account details and authoritative transaction/transfer history.
router.get("/accounts/:id/history", async (req, res) => {
  const accountId = Number(req.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) return res.status(400).json({ error: "Invalid account ID" });

  const [accountRows] = await pool.execute(
    `SELECT fa.id, fa.account_name, fa.bank_name, fa.account_number, fa.account_type,
            fa.currency, fa.initial_balance, fa.status,
            CASE WHEN EXISTS (SELECT 1 FROM transactions t WHERE t.account_id = fa.id AND ${accountAppliedSql("fa.currency")} IS NULL) THEN NULL ELSE ROUND(fa.initial_balance
              + COALESCE((SELECT SUM(CASE
                  WHEN t.type = 'inflow' THEN ${accountAppliedSql("fa.currency")}
                  WHEN t.type = 'outflow' THEN -${accountAppliedSql("fa.currency")}
                  ELSE 0 END)
                FROM transactions t WHERE t.account_id = fa.id), 0)
              + COALESCE((SELECT SUM(ft.amount) FROM finance_account_transfers ft WHERE ft.to_account_id = fa.id), 0)
              - COALESCE((SELECT SUM(ft.amount) FROM finance_account_transfers ft WHERE ft.from_account_id = fa.id), 0), 2
            ) END AS current_balance
     FROM finance_accounts fa WHERE fa.id = ? LIMIT 1`,
    [accountId],
  );
  const account = (accountRows as any[])[0];
  if (!account) return res.status(404).json({ error: "Account not found" });

  const [transactionRows] = await pool.execute(
    `SELECT t.id, 'transaction' AS source, DATE_FORMAT(t.txn_date, '%Y-%m-%d') AS entry_date, t.created_at,
            t.invoice_number, t.description, t.type, t.amount, t.currency,
            t.exchange_rate, t.amount_pkr, t.account_exchange_rate,
            ${accountAppliedSql("fa.currency")} AS account_amount,
            CASE WHEN t.type = 'inflow'
              THEN ${accountAppliedSql("fa.currency")}
              ELSE -${accountAppliedSql("fa.currency")} END AS balance_change,
            c.company_name AS client_name, p.name AS project_name
     FROM transactions t
     JOIN finance_accounts fa ON fa.id = t.account_id
     LEFT JOIN clients c ON c.id = t.client_id
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.account_id = ?`,
    [accountId],
  );
  const [transferRows] = await pool.execute(
    `SELECT ft.id, 'transfer' AS source, DATE_FORMAT(ft.transfer_date, '%Y-%m-%d') AS entry_date, ft.created_at,
            NULL AS invoice_number, ft.description,
            CASE WHEN ft.to_account_id = ? THEN 'inflow' ELSE 'outflow' END AS type,
            ft.amount, ft.currency, 1 AS exchange_rate, ft.amount AS amount_pkr,
            ft.amount AS account_amount,
            CASE WHEN ft.to_account_id = ? THEN ft.amount ELSE -ft.amount END AS balance_change,
            NULL AS client_name, NULL AS project_name,
            source.account_name AS from_account_name, destination.account_name AS to_account_name
     FROM finance_account_transfers ft
     JOIN finance_accounts source ON source.id = ft.from_account_id
     JOIN finance_accounts destination ON destination.id = ft.to_account_id
     WHERE ft.from_account_id = ? OR ft.to_account_id = ?`,
    [accountId, accountId, accountId, accountId],
  );

  const entries = [...(transactionRows as any[]), ...(transferRows as any[])]
    .sort((left, right) => String(left.entry_date).localeCompare(String(right.entry_date))
      || new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
      || Number(left.id) - Number(right.id));
  let runningBalance: number | null = Number(account.initial_balance);
  const history = entries.map((entry) => {
    runningBalance = runningBalance === null || entry.balance_change === null ? null : Math.round((runningBalance + Number(entry.balance_change)) * 100) / 100;
    return { ...entry, resulting_balance: runningBalance };
  }).reverse();
  res.json({ account, history });
});

// Internal movement of existing company money. Kept outside transactions so
// Finance revenue/expense totals remain unchanged.
router.post("/accounts/transfers", async (req: AuthedRequest, res) => {
  const fromAccountId = Number(req.body?.from_account_id);
  const toAccountId = Number(req.body?.to_account_id);
  const amount = Number(req.body?.amount);
  const transferDate = String(req.body?.transfer_date ?? "").slice(0, 10);
  const description = req.body?.description ? String(req.body.description).trim().slice(0, 255) : null;

  if (!Number.isInteger(fromAccountId) || !Number.isInteger(toAccountId) || fromAccountId <= 0 || toAccountId <= 0) {
    return res.status(400).json({ error: "Valid From and To accounts are required" });
  }
  if (fromAccountId === toAccountId) return res.status(400).json({ error: "From and To accounts must be different" });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Transfer amount must be greater than 0" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) return res.status(400).json({ error: "A valid transfer date is required" });
  if (transferDate > karachiDate()) return res.status(400).json({ error: "Transfer date cannot be in the future" });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ids = [fromAccountId, toAccountId].sort((a, b) => a - b);
    const [rows] = await connection.query(
      `SELECT id, account_name, currency, status FROM finance_accounts
       WHERE id IN (?, ?) ORDER BY id FOR UPDATE`,
      ids,
    );
    const accounts = rows as Array<{ id: number; account_name: string; currency: string; status: string }>;
    const fromAccount = accounts.find((item) => Number(item.id) === fromAccountId);
    const toAccount = accounts.find((item) => Number(item.id) === toAccountId);
    if (!fromAccount || !toAccount) {
      await connection.rollback();
      return res.status(404).json({ error: "One or both transfer accounts do not exist" });
    }
    if (fromAccount.status !== "active" || toAccount.status !== "active") {
      await connection.rollback();
      return res.status(400).json({ error: "Transfers require two active accounts" });
    }
    if (fromAccount.currency !== toAccount.currency) {
      await connection.rollback();
      return res.status(400).json({ error: "Transfers currently require accounts with the same currency" });
    }
    const [result] = await connection.query(
      `INSERT INTO finance_account_transfers
         (from_account_id, to_account_id, transfer_date, amount, currency, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [fromAccountId, toAccountId, transferDate, amount, fromAccount.currency, description, req.user!.id],
    );
    const transferId = Number((result as any).insertId);
    await connection.commit();
    await audit(req.user!.id, "create", "finance_account_transfer", transferId, {
      from_account_id: fromAccountId,
      to_account_id: toAccountId,
      amount,
      currency: fromAccount.currency,
      transfer_date: transferDate,
    }, req.ip ?? null);
    res.status(201).json({ ok: true, id: transferId });
  } catch (error: any) {
    await connection.rollback();
    res.status(500).json({ error: error.message || "Failed to transfer funds" });
  } finally {
    connection.release();
  }
});

// CREATE account (Admin only)
router.post("/accounts", async (req: AuthedRequest, res) => {
  const { account_name, bank_name, account_number, account_type, currency, initial_balance, status } = req.body ?? {};

  if (!account_name || !String(account_name).trim()) {
    return res.status(400).json({ error: "Account name is required" });
  }

  const cleanName = String(account_name).trim();
  const cleanBank = bank_name ? String(bank_name).trim() : null;
  const cleanNumber = account_number ? String(account_number).trim() : null;
  if (account_type !== undefined && !["bank", "cash"].includes(account_type)) {
    return res.status(400).json({ error: "Account type must be Bank or Cash" });
  }
  const type = account_type ?? "bank";
  const cur = currency ? String(currency).trim().toUpperCase() : "PKR";
  const initBal = initial_balance !== undefined && initial_balance !== null && initial_balance !== "" ? Number(initial_balance) : 0;
  const stat = status === "inactive" ? "inactive" : "active";

  if (isNaN(initBal)) {
    return res.status(400).json({ error: "Initial balance must be a valid number" });
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO finance_accounts
         (account_name, bank_name, account_number, account_type, currency, initial_balance, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cleanName, cleanBank, cleanNumber, type, cur, initBal, stat]
    );
    const insertId = (result as any).insertId;

    await audit(req.user!.id, "create", "finance_account", insertId, {
      account_name: cleanName,
      account_type: type,
      currency: cur,
      initial_balance: initBal,
      status: stat,
    }, req.ip ?? null);

    res.status(201).json({ ok: true, id: insertId });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "An account with this name already exists" });
    }
    res.status(500).json({ error: err.message || "Failed to create account" });
  }
});

// UPDATE account (Admin/Super Admin, requires Super Password)
router.put("/accounts/:id", requireSuperPassword, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [existingRows] = await pool.execute("SELECT * FROM finance_accounts WHERE id = ? LIMIT 1", [id]);
  const account = (existingRows as any[])[0];
  if (!account) return res.status(404).json({ error: "Account not found" });

  const { account_name, bank_name, account_number, account_type, currency, initial_balance, status } = req.body ?? {};

  const cleanName = (account_name !== undefined && String(account_name).trim()) ? String(account_name).trim() : account.account_name;
  if (!cleanName) {
    return res.status(400).json({ error: "Account name is required" });
  }

  const cleanBank = bank_name !== undefined ? (bank_name ? String(bank_name).trim() : null) : account.bank_name;
  const cleanNumber = account_number !== undefined ? (account_number ? String(account_number).trim() : null) : account.account_number;
  if (account_type !== undefined && !["bank", "cash"].includes(account_type)) {
    return res.status(400).json({ error: "Account type must be Bank or Cash" });
  }
  const type = account_type ?? account.account_type;
  const cur = currency ? String(currency).trim().toUpperCase() : account.currency;
  const initBal = initial_balance !== undefined && initial_balance !== null && initial_balance !== "" ? Number(initial_balance) : account.initial_balance;
  const stat = status !== undefined ? (status === "inactive" ? "inactive" : "active") : account.status;

  if (isNaN(initBal)) {
    return res.status(400).json({ error: "Initial balance must be a valid number" });
  }

  try {
    await pool.execute(
      `UPDATE finance_accounts
       SET account_name = ?, bank_name = ?, account_number = ?, account_type = ?, currency = ?, initial_balance = ?, status = ?
       WHERE id = ?`,
      [cleanName, cleanBank, cleanNumber, type, cur, initBal, stat, id]
    );

    await audit(req.user!.id, "update", "finance_account", id, {
      account_name: cleanName,
      status: stat,
      initial_balance: initBal,
    }, req.ip ?? null);

    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "An account with this name already exists" });
    }
    res.status(500).json({ error: err.message || "Failed to update account" });
  }
});

// DELETE account (Admin/Super Admin, requires Super Password, blocked if transactions exist)
router.delete("/accounts/:id", requireSuperPassword, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [existingRows] = await pool.execute("SELECT * FROM finance_accounts WHERE id = ? LIMIT 1", [id]);
  const account = (existingRows as any[])[0];
  if (!account) return res.status(404).json({ error: "Account not found" });

  // Safety check: verify if historical transactions exist for this account
  const [countRows] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM transactions WHERE account_id = ?)
       + (SELECT COUNT(*) FROM finance_account_transfers WHERE from_account_id = ? OR to_account_id = ?) AS c`,
    [id, id, id],
  );
  const txnCount = (countRows as any[])[0]?.c || 0;
  if (txnCount > 0) {
    return res.status(400).json({
      error: "This account cannot be deleted because it has transaction history. Please deactivate the account instead.",
    });
  }

  await pool.execute("DELETE FROM finance_accounts WHERE id = ?", [id]);
  await audit(req.user!.id, "delete", "finance_account", id, { account_name: account.account_name }, req.ip ?? null);
  res.json({ ok: true });
});

// LIST transactions
router.get("/transactions", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  if (search.length > 80) return res.status(400).json({ error: "Search is too long" });
  const projectId = req.query.project_id === undefined ? null : Number(req.query.project_id);
  if (projectId !== null && (!Number.isInteger(projectId) || projectId <= 0)) return res.status(400).json({ error: "Invalid project ID" });
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (search) { conditions.push("t.invoice_number LIKE ?"); params.push(`%${search}%`); }
  if (projectId !== null) { conditions.push("t.project_id = ?"); params.push(projectId); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await pool.execute(
    `SELECT t.id, t.type, t.txn_date, t.description, t.amount, t.currency,
            t.exchange_rate, t.amount_pkr, t.payment_method, t.currency_name, t.transaction_id, t.project_applied_amount, t.project_applied_currency, t.project_exchange_rate, t.account_applied_amount, t.account_applied_currency, t.account_exchange_rate,
            t.account_id, t.bank_name AS sender_bank_name, t.account_number AS sender_account_number,
            t.invoice_number, t.invoice_sequence, t.invoice_issue_date, t.invoice_currency,
            t.invoice_subtotal, t.invoice_tax_rate, t.invoice_tax_applied, t.invoice_tax_amount, t.invoice_total,
            fa.account_name, fa.bank_name AS receiving_bank_name, fa.account_type AS fa_type,
            t.attachment_path, t.attachment_name, t.attachment_mime, t.attachment_size,
            t.invoice_path,
            t.created_at, t.created_by,
            COALESCE(fc.name, 'Uncategorized') AS category, t.custom_category, t.salary_base_amount, t.salary_bonus_amount,
            COALESCE(pc.company_name, c.company_name) AS client_name,
            p.name AS project_name,
            e.full_name AS employee_name,
            u.full_name AS created_by_name
     FROM transactions t
     LEFT JOIN finance_categories fc ON fc.id = t.category_id
     LEFT JOIN finance_accounts fa ON fa.id = t.account_id
     LEFT JOIN clients c ON c.id = t.client_id
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN clients pc ON pc.id = p.client_id
     LEFT JOIN employees e ON e.id = t.employee_id
     LEFT JOIN users u ON u.id = t.created_by
     ${where}
     ORDER BY t.txn_date DESC, t.id DESC
     LIMIT 200`,
    params,
  );
  res.json({ transactions: rows });
});

// GET single transaction details
router.get("/transactions/:id", async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT t.id, t.type, t.txn_date, t.description, t.amount, t.currency,
            t.exchange_rate, t.amount_pkr, t.payment_method, t.currency_name, t.transaction_id, t.project_applied_amount, t.project_applied_currency, t.project_exchange_rate, t.account_applied_amount, t.account_applied_currency, t.account_exchange_rate,
            t.account_id, t.bank_name AS sender_bank_name, t.account_number AS sender_account_number,
            t.invoice_number, t.invoice_sequence, t.invoice_issue_date, t.invoice_currency,
            t.invoice_subtotal, t.invoice_tax_rate, t.invoice_tax_applied, t.invoice_tax_amount, t.invoice_total,
            fa.account_name, fa.bank_name AS receiving_bank_name, fa.account_type AS fa_type,
            t.attachment_path, t.attachment_name, t.attachment_mime, t.attachment_size,
            t.invoice_path,
            t.created_at, t.created_by,
            fc.name AS category, t.custom_category, t.salary_base_amount, t.salary_bonus_amount,
            c.company_name AS client_name,
            p.name AS project_name,
            e.full_name AS employee_name,
            u.full_name AS created_by_name
     FROM transactions t
     JOIN finance_categories fc ON fc.id = t.category_id
     LEFT JOIN finance_accounts fa ON fa.id = t.account_id
     LEFT JOIN clients c ON c.id = t.client_id
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN employees e ON e.id = t.employee_id
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.id = ?
     LIMIT 1`,
    [req.params.id]
  );
  const txn = (rows as any[])[0];
  if (!txn) return res.status(404).json({ error: "Transaction not found" });
  res.json({ transaction: txn });
});

// GET transaction attachment (securely authenticated streaming)
router.get("/transactions/:id/attachment", async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT id, attachment_path, attachment_name, attachment_mime FROM transactions WHERE id = ? LIMIT 1",
    [req.params.id]
  );
  const txn = (rows as any[])[0];
  if (!txn || !txn.attachment_path) {
    return res.status(404).json({ error: "Attachment not found" });
  }

  // Prevent path traversal
  const safeFilename = path.basename(txn.attachment_path);
  const fullPath = path.join(uploadDir, safeFilename);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: "Attachment file not found on disk" });
  }

  const mime = txn.attachment_mime || "application/octet-stream";
  res.setHeader("Content-Type", mime);
  const encodedName = encodeURIComponent(txn.attachment_name || safeFilename);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${encodedName}"; filename*=UTF-8''${encodedName}`
  );
  fs.createReadStream(fullPath).pipe(res);
});

// GET transaction invoice (securely authenticated streaming)
router.get("/transactions/:id/invoice", async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT id, invoice_number, invoice_path, txn_date FROM transactions WHERE id = ? LIMIT 1",
    [req.params.id]
  );
  const txn = (rows as any[])[0];
  if (!txn || !txn.invoice_path) {
    return res.status(404).json({ error: "Invoice not found" });
  }

  // Prevent path traversal — only the basename is used
  const safeFilename = path.basename(txn.invoice_path);
  const fullPath = path.join(uploadDir, safeFilename);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: "Invoice file not found on disk" });
  }

  const documentName = txn.invoice_number || `Transaction-Document-${String(txn.txn_date).slice(0, 10)}`;
  const encodedName = encodeURIComponent(`${documentName}.pdf`);
  const disposition = req.query.preview === "1" ? "inline" : "attachment";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${encodedName}"; filename*=UTF-8''${encodedName}`
  );
  fs.createReadStream(fullPath).pipe(res);
});

// MONTHLY SUMMARY
router.get("/summary", async (_req, res) => {
  const [rows] = await pool.execute(
    `SELECT type, SUM(amount_pkr) AS total_pkr
     FROM transactions

     GROUP BY type`
  );
  const summary = { inflow_pkr: 0, outflow_pkr: 0 };
  for (const r of rows as any[]) {
    if (r.type === "inflow") summary.inflow_pkr = Number(r.total_pkr);
    if (r.type === "outflow") summary.outflow_pkr = Number(r.total_pkr);
  }
  res.json({ summary });
});

// ─── Invoice PDF Generator ───────────────────────────────────────────────────
async function generateInvoicePdf(txnData: {
  invoice_number?: string | null;
  type: string;
  category: string;
  description: string | null;
  txn_date: string;
  created_at: string;
  amount: number;
  currency: string;
  exchange_rate: number;
  amount_pkr: number;
  payment_method: string;
  client_name: string | null;
  project_name: string | null;
  employee_name: string | null;
  account_name?: string | null;
  custom_category?: string | null;
  salary_base_amount?: number | null;
  salary_bonus_amount?: number | null;
  created_by_name: string | null;
}): Promise<Buffer> {
  const pdfMake = require("pdfmake/build/pdfmake");
  const pdfFonts = require("pdfmake/build/vfs_fonts");
  pdfMake.vfs = pdfFonts.pdfMake.vfs;

  const orange = "#F97316";
  const orangeBg = "#FFF7ED";
  const orangeLight = "#FDBA74";
  const dark = "#1a1a1a";
  const gray = "#6b7280";
  const lightGray = "#F9FAFB";
  const borderColor = "#E5E7EB";

  // Load logo from candidate paths (supports running from src, routes, dist, or project root)
  const candidateLogoPaths = [
    path.join(__dirname, "..", "ashtech-logo.png"),
    path.join(__dirname, "ashtech-logo.png"),
    path.join(process.cwd(), "src", "ashtech-logo.png"),
    path.join(process.cwd(), "ashtech-logo.png"),
    path.join(process.cwd(), "T LOGO.png"),
    path.join(__dirname, "..", "..", "T LOGO.png"),
    path.join(__dirname, "..", "ashtech-logo-full.png"),
  ];
  let logoBase64: string | null = null;
  for (const lp of candidateLogoPaths) {
    try {
      if (fs.existsSync(lp)) {
        logoBase64 = fs.readFileSync(lp).toString("base64");
        break;
      }
    } catch {}
  }

  // Format the transaction date and creation date/time
  const txnDate = String(txnData.txn_date).slice(0, 10);
  const createdAt = new Date(txnData.created_at);
  const createdDateStr = createdAt.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
  const createdTimeStr = createdAt.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  });

  const typeLabel = txnData.type === "inflow" ? "Inflow (Income)" : "Outflow (Expense)";
  const amountFormatted = `${txnData.currency} ${Number(txnData.amount).toLocaleString()}`;
  const pkrFormatted = `PKR ${Number(txnData.amount_pkr).toLocaleString()}`;
  const categoryLabel = (txnData.custom_category || txnData.category).replace(/_/g, " ");
  const paymentLabel = txnData.payment_method.replace(/_/g, " ");

  // Determine linked entity
  let linkedEntity = "—";
  if (txnData.client_name) linkedEntity = `Client: ${txnData.client_name}`;
  else if (txnData.project_name) linkedEntity = `Project: ${txnData.project_name}`;
  else if (txnData.employee_name) linkedEntity = `Employee: ${txnData.employee_name}`;

  const content: any[] = [];

  // ── Header: Logo + Company + Document title ─────────────────────────────
  const headerLeft: any[] = [];
  if (logoBase64) {
    headerLeft.push({
      columns: [
        { image: `data:image/png;base64,${logoBase64}`, width: 44 },
        {
          stack: [
            { text: "Ashtech Digital Solutions", fontSize: 15, bold: true, color: dark },
            { text: "www.ashtechdigitalsolutions.com", fontSize: 8, color: gray },
          ],
          margin: [10, 4, 0, 0],
        },
      ],
      margin: [0, 0, 0, 4],
    });
  } else {
    headerLeft.push({ text: "Ashtech Digital Solutions", fontSize: 15, bold: true, color: dark });
    headerLeft.push({ text: "www.ashtechdigitalsolutions.com", fontSize: 8, color: gray, margin: [0, 2, 0, 4] });
  }

  content.push({
    columns: [
      { stack: headerLeft, width: "*" },
      {
        stack: [
          { text: txnData.type === "inflow" ? "TRANSACTION RECEIPT" : "PAYMENT VOUCHER", fontSize: 18, bold: true, color: orange, alignment: "right" },
          ...(txnData.invoice_number ? [{ text: txnData.invoice_number, fontSize: 9, color: gray, alignment: "right", margin: [0, 3, 0, 0] }] : []),
        ],
        width: "auto",
      },
    ],
    margin: [0, 0, 0, 10],
  });

  // Orange divider
  content.push({
    canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: orange }],
    margin: [0, 0, 0, 14],
  });

  // ── Dates Row ────────────────────────────────────────────────────────────
  content.push({
    columns: [
      {
        stack: [
          { text: "TRANSACTION DATE", fontSize: 7, bold: true, color: orange, characterSpacing: 0.5 },
          { text: txnDate, fontSize: 11, bold: true, color: dark, margin: [0, 2, 0, 0] },
        ],
        width: "*",
      },
      {
        stack: [
          { text: "CREATED DATE", fontSize: 7, bold: true, color: orange, characterSpacing: 0.5 },
          { text: createdDateStr, fontSize: 11, bold: true, color: dark, margin: [0, 2, 0, 0] },
        ],
        width: "*",
        alignment: "center",
      },
      {
        stack: [
          { text: "CREATED TIME", fontSize: 7, bold: true, color: orange, characterSpacing: 0.5 },
          { text: createdTimeStr, fontSize: 11, bold: true, color: dark, margin: [0, 2, 0, 0] },
        ],
        width: "*",
        alignment: "right",
      },
    ],
    margin: [0, 0, 0, 14],
  });

  // Light divider
  content.push({
    canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: borderColor }],
    margin: [0, 0, 0, 14],
  });

  // ── Transaction Details Section Title ────────────────────────────────────
  content.push({ text: "TRANSACTION DETAILS", fontSize: 8, bold: true, color: orange, characterSpacing: 1, margin: [0, 0, 0, 8] });

  // Detail rows helper
  const makeDetailRow = (label: string, value: string, isLast = false, valueColor = dark, valueBold = false): any[] => [
    {
      text: label,
      fontSize: 8,
      color: gray,
      fillColor: lightGray,
      border: [false, false, false, !isLast],
      borderColor: ["", "", "", borderColor],
      margin: [8, 6, 4, 6],
    },
    {
      text: value,
      fontSize: 9,
      bold: valueBold,
      color: valueColor,
      fillColor: "#ffffff",
      border: [false, false, false, !isLast],
      borderColor: ["", "", "", borderColor],
      margin: [8, 6, 8, 6],
    },
  ];

  const typeColor = txnData.type === "inflow" ? "#15803D" : "#DC2626";

  const detailBody = [
    makeDetailRow("Transaction Type", typeLabel, false, typeColor, true),
    makeDetailRow("Category", categoryLabel),
    makeDetailRow("Amount", amountFormatted),
    makeDetailRow("PKR Value (Locked)", pkrFormatted, false, txnData.type === "inflow" ? "#15803D" : "#DC2626", true),
    ...(txnData.currency !== "PKR"
      ? [makeDetailRow("Exchange Rate", `1 ${txnData.currency} = PKR ${txnData.exchange_rate}`)]
      : []),
    makeDetailRow("Payment Method", paymentLabel),
    ...(txnData.account_name ? [makeDetailRow(txnData.type === "inflow" ? "Received In" : "Paid From", txnData.account_name)] : []),
    makeDetailRow("Linked Entity", linkedEntity),
    ...(txnData.salary_base_amount != null ? [makeDetailRow("Final Employee Salary", `${txnData.currency} ${Number(txnData.salary_base_amount).toLocaleString("en-PK")}`)] : []),
    ...(Number(txnData.salary_bonus_amount || 0) > 0 ? [makeDetailRow("Bonus", `${txnData.currency} ${Number(txnData.salary_bonus_amount).toLocaleString("en-PK")}`)] : []),
    makeDetailRow("Description", txnData.description || "—"),
    makeDetailRow("Created By", txnData.created_by_name || "Administrator", true),
  ];

  content.push({
    table: {
      widths: [130, "*"],
      body: detailBody,
    },
    layout: {
      hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 0.5 : 0.3),
      vLineWidth: () => 0,
      hLineColor: () => borderColor,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    margin: [0, 0, 0, 20],
  });

  // ── Amount Summary Box ───────────────────────────────────────────────────
  content.push({
    table: {
      widths: ["*", "auto"],
      body: [
        [
          {
            text: `Total Amount (${txnData.currency})`,
            fontSize: 9, color: gray,
            fillColor: orangeBg,
            border: [false, false, false, false],
            margin: [12, 10, 8, 10],
          },
          {
            text: amountFormatted,
            fontSize: 11, bold: true, color: dark, alignment: "right",
            fillColor: orangeBg,
            border: [false, false, false, false],
            margin: [8, 10, 12, 10],
          },
        ],
        [
          {
            text: "PKR Value (Permanently Locked at Rate)",
            fontSize: 9, color: gray,
            fillColor: "#ffffff",
            border: [false, false, false, false],
            margin: [12, 10, 8, 10],
          },
          {
            text: pkrFormatted,
            fontSize: 13, bold: true,
            color: txnData.type === "inflow" ? "#15803D" : "#DC2626",
            alignment: "right",
            fillColor: "#ffffff",
            border: [false, false, false, false],
            margin: [8, 10, 12, 10],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0, paddingRight: () => 0,
      paddingTop: () => 0, paddingBottom: () => 0,
    },
    margin: [0, 0, 0, 20],
  });

  // Orange divider
  content.push({
    canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.5, lineColor: orange }],
    margin: [0, 0, 0, 10],
  });

  // Footer note
  content.push({
    text: "This is a system-generated transaction receipt from Ashtech Digital Solutions EMS. No signature required.",
    fontSize: 7,
    color: gray,
    italics: true,
    alignment: "center",
    margin: [0, 0, 0, 0],
  });

  const docDef: any = {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 50],
    content,
    footer: (currentPage: number, pageCount: number) => ({
      text: `Ashtech Digital Solutions EMS  ·  Generated ${new Date().toLocaleString("en-PK")}  ·  Page ${currentPage} of ${pageCount}`,
      fontSize: 7, color: gray, alignment: "center", margin: [40, 8, 40, 0],
    }),
    defaultStyle: { font: "Roboto" },
  };

  return new Promise((resolve, reject) => {
    try {
      const pdfDoc = pdfMake.createPdf(docDef);
      pdfDoc.getBuffer((buffer: Uint8Array) => {
        resolve(Buffer.from(buffer));
      });
    } catch (err) {
      reject(err);
    }
  });
}

// CREATE transaction — locks the PKR value at entry time and supports optional attachment + invoice
router.post(
  "/transactions",
  (req, res, next) => {
    upload.single("attachment")(req, res, (err: any) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ error: "Attachment file size exceeds the 10MB limit" });
        }
        return res.status(400).json({ error: err.message });
      } else if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  async (req: AuthedRequest, res) => {
    const file = req.file;

    // Helper to cleanup uploaded file on validation error
    const cleanupUploadedFile = () => {
      if (file && fs.existsSync(file.path)) {
        try { fs.unlinkSync(file.path); } catch {}
      }
    };

    let invoiceFilename: string | null = null;
    let invoiceNumber: string | null = null;
    let invoiceSequence: number | null = null;
    let invoiceIssueDate: string | null = null;
    let invoiceAmounts: ReturnType<typeof calculateInvoiceAmounts> | null = null;
    let invoicePdfData: InvoicePdfData | null = null;
    let paymentBilling: (ProjectBilling & { previous_paid: string }) | null = null;
    let projectPayment: ReturnType<typeof calculateProjectPayment> | null = null;

    try {
      const {
        type, category_id, description, txn_date, amount, currency,
        exchange_rate, payment_method, client_id, project_id,
        account_id, account_number, sender_bank_name, generate_invoice,
        custom_category, employee_id, bonus, currency_name, transaction_id, project_exchange_rate, account_exchange_rate, payroll_period,
      } = req.body ?? {};

      const shouldGenerateInvoice = generate_invoice === "true" || generate_invoice === true || generate_invoice === "1";

      const optionalId = (value: unknown, label: string): number | null => {
        if (value === undefined || value === null || value === "") return null;
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${label}`);
        return parsed;
      };

      let cleanClientId: number | null;
      let cleanProjectId: number | null;
      let cleanEmployeeId: number | null;
      try {
        cleanClientId = optionalId(client_id, "client ID");
        cleanProjectId = optionalId(project_id, "project ID");
        cleanEmployeeId = optionalId(employee_id, "employee ID");
      } catch (validationError) {
        cleanupUploadedFile();
        return res.status(400).json({ error: (validationError as Error).message });
      }

      if (!type || !["inflow", "outflow"].includes(type)) {
        cleanupUploadedFile();
        return res.status(400).json({ error: "type must be inflow or outflow" });
      }
      if (!category_id || !txn_date || amount === undefined || amount === null || amount === "") {
        cleanupUploadedFile();
        return res.status(400).json({ error: "category, date, and amount are required" });
      }

      // Validate account_id if provided
      let cleanAccountId: number | null = null;
      let selectedAccount: { account_name: string; bank_name: string | null; status: string; currency: string } | null = null;
      if (account_id !== undefined && account_id !== null && account_id !== "") {
        cleanAccountId = Number(account_id);
        if (isNaN(cleanAccountId) || cleanAccountId <= 0) {
          cleanupUploadedFile();
          return res.status(400).json({ error: "Invalid account ID" });
        }
        const [accRows] = await pool.execute(
          "SELECT id, account_name, bank_name, status, currency FROM finance_accounts WHERE id = ? LIMIT 1",
          [cleanAccountId]
        );
        const acc = (accRows as any[])[0];
        if (!acc) {
          cleanupUploadedFile();
          return res.status(400).json({ error: "Selected account does not exist" });
        }
        if (acc.status !== "active") {
          cleanupUploadedFile();
          return res.status(400).json({ error: "Selected account is inactive" });
        }
        selectedAccount = acc;
      }
      if (!cleanAccountId || !selectedAccount) {
        cleanupUploadedFile();
        return res.status(400).json({ error: type === "inflow" ? "A receiving EMS account is required" : "A Pay From EMS account is required" });
      }

      // This transaction-level number is the sender/client account, never Ashtech's receiving account.
      let cleanSenderAccountNumber: string | null = null;
      let cleanSenderBankName: string | null = null;
      const cleanPaymentMethod = payment_method ?? "bank_transfer";

      if (!["bank_transfer", "cash"].includes(cleanPaymentMethod)) {
        cleanupUploadedFile();
        return res.status(400).json({ error: "Invalid payment method" });
      }

      if (type === "inflow" && cleanPaymentMethod === "bank_transfer") {
        cleanSenderBankName = typeof sender_bank_name === "string" ? sender_bank_name.trim() : "";
        if (!cleanSenderBankName || cleanSenderBankName.length > 100) {
          cleanupUploadedFile();
          return res.status(400).json({ error: "Sender Bank is required for a bank transfer" });
        }
        if (account_number && String(account_number).trim()) {
          const rawAccNum = String(account_number).trim();
          // Reject arbitrary alphabetic strings or invalid characters
          if (!/^[0-9A-Za-z\s\-_]+$/.test(rawAccNum)) {
            cleanupUploadedFile();
            return res.status(400).json({ error: "Invalid account number format" });
          }
          cleanSenderAccountNumber = rawAccNum;
        }
        if (!cleanSenderAccountNumber) {
          cleanupUploadedFile();
          return res.status(400).json({ error: "Client/Sender Account Number is required for a bank transfer" });
        }
      }

      let clientRow: { company_name: string; ntn: string | null } | null = null;
      if (cleanClientId) {
        const [rows] = await pool.execute(
          "SELECT company_name, ntn FROM clients WHERE id = ? LIMIT 1",
          [cleanClientId],
        );
        clientRow = (rows as Array<{ company_name: string; ntn: string | null }>)[0] ?? null;
        if (!clientRow) {
          cleanupUploadedFile();
          return res.status(400).json({ error: "Selected client does not exist" });
        }
      }

      let projectRow: { name: string; client_id: number; project_value: number | null; sales_tax_percent: number | null; value_currency: string } | null = null;
      if (cleanProjectId) {
        const [rows] = await pool.execute(
          "SELECT name, client_id, project_value, sales_tax_percent, value_currency FROM projects WHERE id = ? LIMIT 1",
          [cleanProjectId],
        );
        projectRow = (rows as Array<{ name: string; client_id: number; project_value: number | null; sales_tax_percent: number | null; value_currency: string }>)[0] ?? null;
        if (!projectRow) {
          cleanupUploadedFile();
          return res.status(400).json({ error: "Selected project does not exist" });
        }
        if (!cleanClientId || Number(projectRow.client_id) !== cleanClientId) {
          cleanupUploadedFile();
          return res.status(400).json({ error: "Selected project does not belong to the selected client" });
        }
      }

      const [categoryRows] = await pool.execute(
        "SELECT id, type, name FROM finance_categories WHERE id = ? LIMIT 1",
        [category_id],
      );
      const category = (categoryRows as Array<{ id: number; type: string; name: string }>)[0];
      if (!category || category.type !== type) {
        cleanupUploadedFile();
        return res.status(400).json({ error: "Selected category does not match the transaction type" });
      }

      const otherCategory = category.name === "other_income" || category.name === "other_expense" || category.name === "other";
      const cleanCustomCategory = otherCategory && typeof custom_category === "string" ? custom_category.trim() : "";
      if (otherCategory && (!cleanCustomCategory || cleanCustomCategory.length > 120)) {
        cleanupUploadedFile();
        return res.status(400).json({ error: "Specify Category is required for an Other transaction" });
      }

      const isClientPayment = type === "inflow" && category.name === "client_payment";
      if (isClientPayment && (!cleanClientId || !clientRow || !cleanProjectId || !projectRow)) {
        cleanupUploadedFile();
        return res.status(400).json({ error: "Client and project are required for a client payment" });
      }
      if (!isClientPayment) {
        cleanClientId = null;
        cleanProjectId = null;
        clientRow = null;
        projectRow = null;
      }

      const isSalary = type === "outflow" && category.name === "salary";
      let salaryBaseAmount: number | null = null;
      let salaryBonusAmount: number | null = null;
      let employeeName: string | null = null;
      let transactionAmount = Number(amount);
      const payrollPeriod = payroll_period ? validatePayrollPeriod(payroll_period) : null;
      let payrollEmployee: any = null;
      if (payrollPeriod && !isSalary) { cleanupUploadedFile(); return res.status(400).json({ error: "Payroll payments must be Salary outflows" }); }
      if (isSalary) {
        if (!cleanEmployeeId) {
          cleanupUploadedFile();
          return res.status(400).json({ error: "Employee is required for a salary payment" });
        }
        const [employeeRows] = await pool.execute(
          `SELECT full_name, status, salary_currency, basic_salary, allowances, deductions, ${netSalarySql()} AS final_salary
           FROM employees WHERE id = ? LIMIT 1`,
          [cleanEmployeeId],
        );
        const employee = (employeeRows as any[])[0];
        if (!employee || employee.status === "inactive"
          || (employee.basic_salary == null && employee.allowances == null && employee.deductions == null)) {
          cleanupUploadedFile();
          return res.status(400).json({ error: "Selected employee is inactive or has no salary configured" });
        }
        salaryBaseAmount = Number(employee.final_salary);
        salaryBonusAmount = bonus === undefined || bonus === "" ? 0 : Number(bonus);
        if (!Number.isFinite(salaryBaseAmount) || salaryBaseAmount < 0 || !Number.isFinite(salaryBonusAmount) || salaryBonusAmount < 0) {
          cleanupUploadedFile();
          return res.status(400).json({ error: "Salary and bonus must be valid non-negative amounts" });
        }
        if (String(employee.salary_currency || "PKR").toUpperCase() !== String(currency || "PKR").toUpperCase()) {
          cleanupUploadedFile();
          return res.status(400).json({ error: `Salary payment currency must be ${String(employee.salary_currency || "PKR").toUpperCase()}` });
        }
        transactionAmount = salaryBaseAmount + salaryBonusAmount;
        employeeName = employee.full_name;
      } else {
        cleanEmployeeId = null;
      }

      const numAmount = transactionAmount;
      if (isNaN(numAmount) || !isFinite(numAmount) || numAmount <= 0) {
        cleanupUploadedFile();
        return res.status(400).json({ error: "Amount must be a valid positive number" });
      }

      // Validate transaction date format and ensure it cannot be in the future
      const dateRegex = /^\d{4}-\d{2}-\d{2}/;
      if (!dateRegex.test(String(txn_date))) {
        cleanupUploadedFile();
        return res.status(400).json({ error: "Invalid transaction date format" });
      }
      const txnDateStr = String(txn_date).slice(0, 10);
      const now = new Date();
      const serverToday = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const utcToday = now.toISOString().slice(0, 10);
      const maxAllowed = serverToday > utcToday ? serverToday : utcToday;
      if (txnDateStr > maxAllowed) {
        cleanupUploadedFile();
        return res.status(400).json({ error: "Transaction date cannot be in the future" });
      }

      const cur = String(currency ?? "PKR").trim().toUpperCase();
      const currencyName = String(currency_name ?? "").trim();
      const transactionId = String(transaction_id ?? "").trim();
      if (!/^[A-Z]{3}$/.test(cur) || currencyName.length > 80 || transactionId.length > 120 || /[\x00-\x1f\x7f]/.test(currencyName + transactionId)) {
        cleanupUploadedFile();
        return res.status(400).json({ error: "Invalid currency or transaction reference" });
      }
      let rate = cur === "PKR" ? 1 : Number(exchange_rate);
      if (cur !== "PKR" && (isNaN(rate) || !isFinite(rate) || rate <= 0)) {
        cleanupUploadedFile();
        return res.status(400).json({ error: "Exchange rate must be a valid positive number for non-PKR amounts" });
      }

      let accountPayment;
      try { accountPayment = calculateAccountPayment(String(numAmount), cur, exchange_rate, selectedAccount.currency, account_exchange_rate); }
      catch (error) { cleanupUploadedFile(); return res.status(400).json({ error: (error as Error).message }); }
      let amountPkr = Number(accountPayment.amountPkr);

      if (shouldGenerateInvoice) {
        try {
          if (!isClientPayment) invoiceAmounts = calculateInvoiceAmounts(String(numAmount), String(numAmount), 0);
        } catch (validationError) {
          cleanupUploadedFile();
          return res.status(400).json({ error: (validationError as Error).message });
        }
        invoiceIssueDate = karachiDate();
      }

      const attachmentPath = file ? file.filename : null;
      const attachmentName = file ? file.originalname : null;
      const attachmentMime = file ? file.mimetype : null;
      const attachmentSize = file ? file.size : null;

      const conn = await pool.getConnection();
      let insertId = 0;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        attempts++;
        try {
          await conn.beginTransaction();

          if (payrollPeriod) {
            payrollEmployee = await lockPayrollEmployee(conn, cleanEmployeeId!, payrollPeriod);
            if (Number(payrollEmployee.final_salary) !== salaryBaseAmount || payrollEmployee.salary_currency !== cur) {
              throw Object.assign(new Error("Employee salary changed; reload Payroll before payment"), { statusCode: 409 });
            }
          }

          const [lockedAccountRows] = await conn.query("SELECT currency, status FROM finance_accounts WHERE id = ? FOR UPDATE", [cleanAccountId]);
          const lockedAccount = (lockedAccountRows as Array<{ currency: string; status: string }>)[0];
          if (!lockedAccount || lockedAccount.status !== "active" || lockedAccount.currency !== selectedAccount.currency) {
            const error = new Error("Finance account changed; reload and confirm the account exchange rate") as Error & { statusCode: number };
            error.statusCode = 409;
            throw error;
          }

          if (isClientPayment && cleanProjectId) {
            const billing = await loadProjectBilling(cleanProjectId, conn, true);
            if (!billing) {
              const error = new Error("The selected project must have a valid Project Value before accepting payments") as Error & { statusCode?: number };
              error.statusCode = 400;
              throw error;
            }
            try { projectPayment = calculateProjectPayment(numAmount, cur, rate, String(billing.value_currency).toUpperCase(), project_exchange_rate); }
            catch (error) { (error as Error & { statusCode: number }).statusCode = 400; throw error; }
            rate = Number(projectPayment.paymentRateToPkr);
            amountPkr = Number(projectPayment.amountPkr);
            const paymentMinor = parseMoneyToMinor(projectPayment.appliedAmount, "Applied payment amount");
            const remainingMinor = Number(billing.remaining_balance) > 0 ? parseMoneyToMinor(billing.remaining_balance, "Remaining balance") : 0n;
            if (paymentMinor > remainingMinor) {
              const error = new Error(`Payment cannot exceed the remaining balance of ${billing.value_currency} ${billing.remaining_balance}`) as Error & { statusCode?: number };
              error.statusCode = 400;
              throw error;
            }
            const previousMinor = Number(billing.total_paid) > 0 ? parseMoneyToMinor(billing.total_paid, "Previous paid") : 0n;
            const totalPaidMinor = previousMinor + paymentMinor;
            paymentBilling = {
              ...billing,
              previous_paid: billing.total_paid,
              total_paid: minorToDecimal(totalPaidMinor),
              remaining_balance: minorToDecimal(remainingMinor - paymentMinor),
            };
            if (shouldGenerateInvoice) {
              invoiceAmounts = {
                ...calculateInvoiceAmounts(billing.project_value, projectPayment.appliedAmount, billing.sales_tax_percent),
                amountPaid: paymentBilling.total_paid,
                remainingBalance: paymentBilling.remaining_balance,
              };
            }
          }

          if (shouldGenerateInvoice && cleanClientId && cleanProjectId && clientRow && projectRow) {
            invoiceSequence = await allocateInvoiceSequence(conn, cleanClientId, cleanProjectId);
            invoiceNumber = buildInvoiceNumber(clientRow.company_name, projectRow.name, invoiceSequence);
          }

          const [result] = await conn.query(
            `INSERT INTO transactions
               (invoice_number, invoice_sequence, invoice_issue_date,
                invoice_currency, invoice_subtotal, invoice_tax_rate, invoice_tax_applied, invoice_tax_amount, invoice_total,
                type, category_id, custom_category, description, txn_date, amount, currency,
                exchange_rate, amount_pkr, payment_method, account_id, bank_name, account_number,
                client_id, project_id, employee_id, salary_base_amount, salary_bonus_amount,
                attachment_path, attachment_name, attachment_mime, attachment_size, created_by, currency_name, transaction_id, project_applied_amount, project_applied_currency, project_exchange_rate, account_applied_amount, account_applied_currency, account_exchange_rate)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              invoiceNumber, invoiceSequence, invoiceIssueDate,
              shouldGenerateInvoice ? projectPayment?.appliedCurrency ?? cur : null,
              invoiceAmounts?.subtotal ?? null,
              invoiceAmounts?.taxRate ?? null,
              shouldGenerateInvoice ? (invoiceAmounts?.taxApplied ? 1 : 0) : null,
              invoiceAmounts?.taxAmount ?? null,
              invoiceAmounts?.total ?? null,
              type, category_id, cleanCustomCategory || null, description ?? null, txn_date, numAmount, cur,
              rate, amountPkr, cleanPaymentMethod, cleanAccountId, cleanSenderBankName, cleanSenderAccountNumber,
              cleanClientId, cleanProjectId, cleanEmployeeId, salaryBaseAmount, salaryBonusAmount,
              attachmentPath, attachmentName, attachmentMime, attachmentSize,
              req.user!.id, currencyName || null, transactionId || null,
              projectPayment?.appliedAmount ?? null, projectPayment?.appliedCurrency ?? null, projectPayment?.projectRateToPkr ?? null,
              accountPayment.amount, accountPayment.currency, accountPayment.rate,
            ]
          );
          insertId = (result as any).insertId;
          if (payrollPeriod) await finalizePayroll(conn, payrollEmployee, payrollPeriod, insertId);

          if (shouldGenerateInvoice && !invoiceNumber) {
            invoiceNumber = `ASH-${type === "inflow" ? "REC" : "PAY"}-${String(insertId).padStart(6, "0")}`;
            await conn.query(
              `UPDATE transactions SET invoice_number = ?, invoice_issue_date = ?, invoice_currency = ?,
                 invoice_subtotal = ?, invoice_tax_rate = ?, invoice_tax_applied = ?, invoice_tax_amount = ?, invoice_total = ?
               WHERE id = ?`,
              [invoiceNumber, invoiceIssueDate, cur, invoiceAmounts?.subtotal ?? numAmount, invoiceAmounts?.taxRate ?? 0,
                0, invoiceAmounts?.taxAmount ?? 0, invoiceAmounts?.total ?? numAmount, insertId],
            );
          }

          await conn.commit();
          break;
        } catch (err: any) {
          await conn.rollback();
          if (err.code === "ER_DUP_ENTRY" && attempts < maxAttempts) {
            continue; // retry with next sequence number
          }
          conn.release();
          throw err;
        }
      }

      conn.release();

      // ── Optionally generate invoice PDF ────────────────────────────────
      if (shouldGenerateInvoice && invoiceNumber && invoiceIssueDate && invoiceAmounts && selectedAccount) {
        try {
          let pdfBuffer: Buffer;
          if (isClientPayment && clientRow && projectRow) {
            invoicePdfData = {
              invoiceNumber, issueDate: invoiceIssueDate, clientName: clientRow.company_name, clientNtn: clientRow.ntn,
              transactionId,
              projectName: projectRow.name, currency: projectPayment?.appliedCurrency ?? cur, subtotal: invoiceAmounts.subtotal,
              taxApplied: invoiceAmounts.taxApplied, taxRate: invoiceAmounts.taxRate, taxAmount: invoiceAmounts.taxAmount,
              total: invoiceAmounts.total, amountPaid: invoiceAmounts.amountPaid, remainingBalance: invoiceAmounts.remainingBalance,
              paymentMethod: cleanPaymentMethod, senderBankName: cleanSenderBankName,
              receivingAccountName: selectedAccount.account_name, receivingBankName: selectedAccount.bank_name,
              senderAccountNumber: cleanSenderAccountNumber,
              documentTitle: "RECEIPT",
              lineDescription: `Payment toward ${projectRow.name}`,
              paymentDetails: projectPayment && cur !== projectPayment.appliedCurrency ? [
                { label: "Actual Payment Received", value: `${cur} ${numAmount.toFixed(2)}` },
                { label: "Payment Exchange Rate", value: `1 ${cur} = PKR ${projectPayment.paymentRateToPkr}` },
                { label: "Project Exchange Rate", value: `1 ${projectPayment.appliedCurrency} = PKR ${projectPayment.projectRateToPkr}` },
                { label: "Applied to Project", value: `${projectPayment.appliedCurrency} ${projectPayment.appliedAmount}` },
              ] : undefined,
              summaryRows: paymentBilling ? [
                { label: "PROJECT VALUE", value: `${projectPayment?.appliedCurrency ?? cur} ${Number(paymentBilling.project_value).toLocaleString("en-PK", { minimumFractionDigits: 2 })}` },
                { label: paymentBilling.sales_tax_percent == null ? "SALES TAX (NOT SELECTED)" : `SALES TAX (${Number(paymentBilling.sales_tax_percent).toFixed(2)}%)`, value: `${projectPayment?.appliedCurrency ?? cur} ${Number(paymentBilling.tax_amount).toLocaleString("en-PK", { minimumFractionDigits: 2 })}` },
                { label: "TOTAL PAYABLE", value: `${projectPayment?.appliedCurrency ?? cur} ${Number(paymentBilling.total_payable).toLocaleString("en-PK", { minimumFractionDigits: 2 })}` },
                { label: "PREVIOUS PAID", value: `${projectPayment?.appliedCurrency ?? cur} ${Number(paymentBilling.previous_paid).toLocaleString("en-PK", { minimumFractionDigits: 2 })}` },
                { label: "THIS PAYMENT", value: `${projectPayment?.appliedCurrency ?? cur} ${Number(projectPayment?.appliedAmount ?? numAmount).toLocaleString("en-PK", { minimumFractionDigits: 2 })}` },
                { label: "TOTAL PAID", value: `${projectPayment?.appliedCurrency ?? cur} ${Number(paymentBilling.total_paid).toLocaleString("en-PK", { minimumFractionDigits: 2 })}`, accent: "green" },
                { label: "REMAINING BALANCE", value: `${projectPayment?.appliedCurrency ?? cur} ${Number(paymentBilling.remaining_balance).toLocaleString("en-PK", { minimumFractionDigits: 2 })}`, accent: "orange" },
              ] : undefined,
            };
            pdfBuffer = await buildClientInvoicePdf(invoicePdfData);
          } else {
            const documentTitle = type === "inflow" ? "RECEIPT" : "PAYMENT VOUCHER";
            const categoryLabel = (cleanCustomCategory || category.name).replace(/_/g, " ");
            const linkedName = employeeName || clientRow?.company_name || projectRow?.name || categoryLabel;
            const formattedAmount = `${cur} ${numAmount.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const paymentDetails = [
              { label: "Category", value: categoryLabel },
              { label: "Payment Method", value: cleanPaymentMethod.replace(/_/g, " ") },
              { label: type === "inflow" ? "Received In" : "Paid From", value: selectedAccount.account_name },
              ...(clientRow ? [{ label: "Client", value: clientRow.company_name }] : []),
              ...(projectRow ? [{ label: "Project", value: projectRow.name }] : []),
              ...(employeeName ? [{ label: "Employee", value: employeeName }] : []),
              ...(salaryBaseAmount != null ? [{ label: "Final Employee Salary", value: `${cur} ${Number(salaryBaseAmount).toLocaleString("en-PK", { minimumFractionDigits: 2 })}` }] : []),
              ...(Number(salaryBonusAmount || 0) > 0 ? [{ label: "Bonus", value: `${cur} ${Number(salaryBonusAmount).toLocaleString("en-PK", { minimumFractionDigits: 2 })}` }] : []),
              ...(cur !== "PKR" ? [{ label: "Exchange Rate", value: `1 ${cur} = PKR ${rate.toLocaleString("en-PK")}` }] : []),
              ...(description ? [{ label: "Description", value: description }] : []),
            ];
            pdfBuffer = await buildClientInvoicePdf({
              invoiceNumber, issueDate: invoiceIssueDate, clientName: linkedName, clientNtn: null, transactionId,
              projectName: projectRow?.name || description || categoryLabel, currency: cur,
              subtotal: String(numAmount), taxApplied: false, taxRate: "0", taxAmount: "0",
              total: String(numAmount), amountPaid: String(numAmount), remainingBalance: "0",
              paymentMethod: cleanPaymentMethod, senderBankName: cleanSenderBankName,
              receivingAccountName: selectedAccount.account_name, receivingBankName: selectedAccount.bank_name,
              senderAccountNumber: cleanSenderAccountNumber, documentTitle,
              partyLabel: type === "inflow" ? "RECEIVED FROM" : "PAYMENT FOR",
              partyReference: categoryLabel, lineDescription: description || categoryLabel,
              summaryRows: [
                ...(salaryBaseAmount != null ? [{ label: "FINAL EMPLOYEE SALARY", value: `${cur} ${Number(salaryBaseAmount).toLocaleString("en-PK", { minimumFractionDigits: 2 })}` }] : []),
                ...(Number(salaryBonusAmount || 0) > 0 ? [{ label: "BONUS", value: `${cur} ${Number(salaryBonusAmount).toLocaleString("en-PK", { minimumFractionDigits: 2 })}` }] : []),
                ...(cur !== "PKR" ? [{ label: "PKR VALUE (LOCKED)", value: `PKR ${amountPkr.toLocaleString("en-PK", { minimumFractionDigits: 2 })}` }] : []),
                { label: type === "inflow" ? "TOTAL RECEIPT" : "TOTAL PAYMENT", value: formattedAmount, accent: "orange" },
              ],
              paymentDetails,
              footerStatement: type === "inflow" ? "Payment received and recorded by Ashtech Digital Solutions." : "Payment issued and recorded by Ashtech Digital Solutions.",
            });
          }
          const safeNum = invoiceNumber.replace(/[^A-Za-z0-9\-_]/g, "");
          invoiceFilename = `${safeNum}.pdf`;
          const invoiceFullPath = path.join(uploadDir, invoiceFilename);
          fs.writeFileSync(invoiceFullPath, pdfBuffer);

          // Save invoice_path to DB
          await pool.execute(
            "UPDATE transactions SET invoice_path = ? WHERE id = ?",
            [invoiceFilename, insertId]
          );
        } catch (invoiceErr: any) {
          // Invoice generation failed — log but do not fail the transaction creation
          console.error("[invoice] Failed to generate invoice:", invoiceErr?.message);
          invoiceFilename = null;
        }
      }

      await audit(
        req.user!.id,
        "create",
        "transaction",
        insertId,
        {
          type,
          amount: numAmount,
          currency: cur,
          amount_pkr: amountPkr,
          invoice_number: invoiceNumber,
          invoice_tax_applied: shouldGenerateInvoice ? invoiceAmounts?.taxApplied : null,
          has_attachment: !!file,
          has_invoice: !!invoiceFilename,
        },
        req.ip ?? null
      );

      res.status(201).json({
        id: insertId,
        invoice_number: invoiceNumber,
        amount_pkr: amountPkr,
        invoice: invoiceAmounts,
        invoice_generated: !!invoiceFilename,
      });
    } catch (err: any) {
      cleanupUploadedFile();
      res.status([400, 409].includes(err?.statusCode) ? err.statusCode : 500).json({ error: err.message || "Failed to create transaction" });
    }
  }
);

// DELETE — requires Super Password and cleans up attachment + invoice files
router.delete("/transactions/:id", requireSuperPassword, async (req: AuthedRequest, res) => {
  const [rows] = await pool.execute(
    "SELECT id, attachment_path, invoice_path FROM transactions WHERE id = ?",
    [req.params.id]
  );
  const txn = (rows as any[])[0];

  await pool.execute("DELETE FROM transactions WHERE id = ?", [req.params.id]);

  // Clean up uploaded attachment file
  if (txn?.attachment_path) {
    const safeFilename = path.basename(txn.attachment_path);
    const fullPath = path.join(uploadDir, safeFilename);
    if (fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); } catch {}
    }
  }

  // Clean up generated invoice file
  if (txn?.invoice_path) {
    const safeFilename = path.basename(txn.invoice_path);
    const fullPath = path.join(uploadDir, safeFilename);
    if (fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); } catch {}
    }
  }

  await audit(req.user!.id, "delete", "transaction", Number(req.params.id), null, req.ip ?? null);
  res.json({ ok: true });
});

export default router;
