import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { clientInitials, projectInitials, calculateInvoiceAmounts, karachiDate } from "../src/finance/invoice";
import { pool } from "../src/db";

const BASE_URL = process.env.API_URL || "http://localhost:4000/api";
const PDF_OUTPUT = process.env.PDF_OUTPUT;
const PDF_OUTPUT_OFF = process.env.PDF_OUTPUT_OFF;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`PASS: ${message}`);
}

async function request(
  route: string,
  options: { method?: string; token?: string; json?: unknown; form?: FormData } = {},
) {
  const response = await fetch(`${BASE_URL}${route}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.json === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.form ?? (options.json === undefined ? undefined : JSON.stringify(options.json)),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const disposition = response.headers.get("content-disposition") ?? "";
  if (contentType.includes("application/pdf")) {
    return { status: response.status, contentType, disposition, bytes: new Uint8Array(await response.arrayBuffer()), body: null };
  }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  return { status: response.status, contentType, disposition, bytes: null, body };
}

async function login(email: string, password: string) {
  return request("/auth/login", { method: "POST", json: { email, password } });
}

function invoiceForm(values: {
  categoryId: number;
  clientId: number;
  projectId: number;
  accountId: number;
  amount?: string;
  applyTax?: boolean;
}) {
  const form = new FormData();
  form.set("type", "inflow");
  form.set("category_id", String(values.categoryId));
  form.set("description", "Controlled invoice verification");
  form.set("txn_date", karachiDate());
  form.set("amount", values.amount ?? "40000");
  form.set("currency", "PKR");
  form.set("exchange_rate", "1");
  form.set("payment_method", "bank_transfer");
  form.set("client_id", String(values.clientId));
  form.set("project_id", String(values.projectId));
  form.set("account_id", String(values.accountId));
  form.set("sender_bank_name", "HBL");
  form.set("account_number", "1234567890123");
  form.set("generate_invoice", "true");
  form.set("apply_sales_tax", values.applyTax === false ? "false" : "true");
  return form;
}

async function main() {
  const suffix = Date.now();
  const password = `Finance-${suffix}-safe`;
  const adminEmail = `finance-admin-${suffix}@example.test`;
  const superEmail = `finance-super-${suffix}@example.test`;
  let employeeId: number | null = null;
  let adminUserId: number | null = null;
  let superUserId: number | null = null;
  const clientIds: number[] = [];
  const projectIds: number[] = [];
  const transactionIds: number[] = [];
  let accountId: number | null = null;
  const generatedFiles: string[] = [];

  try {
    check(clientInitials("  Muhammad  Ali Khan ") === "MAK", "client initials normalize spaces and capitalization");
    check(projectInitials("Attendance Management System") === "AM", "project initials omit a generic third ending word");
    check(projectInitials("Attendance System") === "AS", "two-word project initials remain meaningful");
    const calculated = calculateInvoiceAmounts("100000", "40000", 5);
    check(calculated.taxAmount === "5000.00" && calculated.total === "105000.00" && calculated.remainingBalance === "65000.00", "server money calculation produces exact 5% tax and remaining balance");
    const calculatedWithoutTax = calculateInvoiceAmounts("100000", "40000", 0);
    check(!calculatedWithoutTax.taxApplied && calculatedWithoutTax.taxAmount === "0.00" && calculatedWithoutTax.total === "100000.00", "server money calculation safely omits optional sales tax");

    const [roleRows] = await pool.execute<RowDataPacket[]>(
      "SELECT id, name FROM roles WHERE name IN ('employee','admin','super_admin') AND is_active = 1",
    );
    const role = (name: string) => Number(roleRows.find((row) => row.name === name)?.id);
    check(role("employee") > 0 && role("admin") > 0 && role("super_admin") > 0, "required roles exist");

    const hash = await bcrypt.hash(password, 12);
    const [employee] = await pool.execute<ResultSetHeader>(
      `INSERT INTO employees
         (employee_code, full_name, email, designation, joining_date, employment_type, status)
       VALUES (?, 'Finance Promoted Admin', ?, 'Verifier', '2026-01-01', 'contract', 'active')`,
      [`FIN-${suffix}`, adminEmail],
    );
    employeeId = employee.insertId;
    const [adminUser] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (role_id, full_name, email, employee_id, password_hash, is_active)
       VALUES (?, 'Finance Promoted Admin', ?, ?, ?, TRUE)`,
      [role("admin"), adminEmail, employeeId, hash],
    );
    adminUserId = adminUser.insertId;
    const [superUser] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (role_id, full_name, email, password_hash, is_active)
       VALUES (?, 'Finance Super Admin', ?, ?, TRUE)`,
      [role("super_admin"), superEmail, hash],
    );
    superUserId = superUser.insertId;

    for (const name of ["Taha Nazir", "Client A", "Client B"]) {
      const [client] = await pool.execute<ResultSetHeader>(
        `INSERT INTO clients (company_name, contact_person, ntn, status)
         VALUES (?, ?, '12345678', 'active')`,
        [name, name],
      );
      clientIds.push(client.insertId);
    }
    const projectFixtures: Array<[number, string]> = [
      [clientIds[0], "Attendance Management System"],
      [clientIds[1], "Project A1"],
      [clientIds[1], "Project A2"],
      [clientIds[2], "Project B1"],
    ];
    for (const [clientId, name] of projectFixtures) {
      const [project] = await pool.execute<ResultSetHeader>(
        `INSERT INTO projects (client_id, name, status, project_value, value_currency)
         VALUES (?, ?, 'ongoing', 100000, 'PKR')`,
        [clientId, name],
      );
      projectIds.push(project.insertId);
    }

    const [categoryRows] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM finance_categories WHERE type = 'inflow' AND name = 'client_payment' LIMIT 1",
    );
    const categoryId = Number(categoryRows[0]?.id);
    check(categoryId > 0, "client payment category exists");

    const adminLogin = await login(adminEmail, password);
    const selectionToken = String(adminLogin.body?.token);
    const adminMode = await request("/auth/select-mode", { method: "POST", token: selectionToken, json: { mode: "admin" } });
    const adminToken = String(adminMode.body?.token);
    check((await request("/finance/categories", { token: adminToken })).status === 200, "promoted Admin in Admin mode retains Finance API access");
    check((await request("/finance/accounts", { token: adminToken })).status === 200, "promoted Admin retains Finance Accounts access");
    check((await request("/finance/transactions?search=ASH", { token: adminToken })).status === 200, "promoted Admin can use invoice search");
    check((await request("/reports/finance.pdf", { token: adminToken })).status === 200, "promoted Admin can download Finance reports");
    check((await request(`/reports/client/${clientIds[0]}.pdf`, { token: adminToken })).status === 200, "promoted Admin can access finance-bearing client reports");
    const adminDashboard = await request("/dashboard", { token: adminToken });
    check(adminDashboard.status === 200 && "finance" in (adminDashboard.body ?? {}), "Admin dashboard retains finance totals");
    const adminClients = await request("/clients", { token: adminToken });
    const exposedClient = (adminClients.body?.clients as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
    check(adminClients.status === 200 && !("transactions" in exposedClient), "Admin client API remains operational without embedding transaction arrays");
    check((await request("/attendance/reports/preview?from=2098-01-01&to=2098-01-01&employmentStatus=active", { token: adminToken })).status === 200, "Admin attendance-report permission remains intact");

    const superLogin = await login(superEmail, password);
    const superToken = String(superLogin.body?.token);
    check((await request("/finance/categories", { token: superToken })).status === 200, "Super Admin retains Finance access");

    const accountCreate = await request("/finance/accounts", {
      method: "POST",
      token: superToken,
      json: {
        account_name: "Main Company Account",
        bank_name: "UBL",
        account_number: "ASH-PRIVATE-999",
        account_type: "bank",
        currency: "PKR",
        initial_balance: 0,
        status: "active",
      },
    });
    accountId = Number(accountCreate.body?.id);
    check(accountCreate.status === 201 && accountId > 0, "Super Admin can create the controlled Finance Account");
    const accounts = await request("/finance/accounts", { token: superToken });
    const account = (accounts.body?.accounts as Array<Record<string, unknown>>).find((item) => Number(item.id) === accountId);
    check(account?.account_name === "Main Company Account" && account?.bank_name === "UBL", "free-form Account Name and actual Bank Name persist separately");

    const forged = await request("/finance/transactions", {
      method: "POST",
      token: superToken,
      form: invoiceForm({ categoryId, clientId: clientIds[1], projectId: projectIds[3], accountId }),
    });
    check(forged.status === 400, "backend rejects a forged client/project relationship");

    const created = await request("/finance/transactions", {
      method: "POST",
      token: superToken,
      form: invoiceForm({ categoryId, clientId: clientIds[0], projectId: projectIds[0], accountId }),
    });
    const transactionId = Number(created.body?.id);
    const invoiceNumber = String(created.body?.invoice_number);
    transactionIds.push(transactionId);
    check(created.status === 201 && invoiceNumber === "ASH-TN-AM-0001", "first invoice uses the approved deterministic number");

    const [transactionRows] = await pool.execute<RowDataPacket[]>(
      `SELECT invoice_number, invoice_sequence, invoice_subtotal, invoice_tax_applied, invoice_tax_rate,
              invoice_tax_amount, invoice_total, amount, bank_name, account_number, account_id,
              employee_id, created_by, invoice_path
       FROM transactions WHERE id = ?`,
      [transactionId],
    );
    const transaction = transactionRows[0];
    check(Number(transaction.invoice_tax_applied) === 1 && Number(transaction.invoice_subtotal) === 100000 && Number(transaction.invoice_tax_amount) === 5000 && Number(transaction.invoice_total) === 105000, "tax-on invoice financial snapshot is persisted historically");
    check(Number(transaction.amount) === 40000 && String(transaction.account_number) === "1234567890123", "actual payment and transaction-specific sender account are stored separately");
    check(String(transaction.bank_name) === "HBL", "transaction-specific sender bank is persisted separately from the receiving bank");
    check(transaction.employee_id === null && Number(transaction.created_by) === superUserId, "new transaction has no selected employee and retains authenticated creator");
    generatedFiles.push(String(transaction.invoice_path));

    const simultaneous = await Promise.all([
      request("/finance/transactions", { method: "POST", token: superToken, form: invoiceForm({ categoryId, clientId: clientIds[0], projectId: projectIds[0], accountId, amount: "10" }) }),
      request("/finance/transactions", { method: "POST", token: superToken, form: invoiceForm({ categoryId, clientId: clientIds[0], projectId: projectIds[0], accountId, amount: "10" }) }),
    ]);
    if (!simultaneous.every((response) => response.status === 201)) {
      console.error("Concurrent invoice responses:", simultaneous.map((response) => ({ status: response.status, body: response.body })));
    }
    for (const response of simultaneous) {
      const concurrentId = Number(response.body?.id);
      if (Number.isFinite(concurrentId) && concurrentId > 0) transactionIds.push(concurrentId);
      if (response.body?.invoice_number) generatedFiles.push(`${String(response.body.invoice_number)}.pdf`);
    }
    const concurrentNumbers = simultaneous.map((response) => String(response.body?.invoice_number)).sort();
    check(simultaneous.every((response) => response.status === 201) && new Set(concurrentNumbers).size === 2 && concurrentNumbers.includes("ASH-TN-AM-0002") && concurrentNumbers.includes("ASH-TN-AM-0003"), "simultaneous invoice requests receive unique locked sequences");

    const search = await request(`/finance/transactions?search=${encodeURIComponent(invoiceNumber.toLowerCase())}`, { token: superToken });
    const matches = search.body?.transactions as Array<Record<string, unknown>>;
    check(search.status === 200 && matches.length === 1 && matches[0].invoice_number === invoiceNumber, "case-insensitive server-side invoice-number search locates the record");

    const untaxed = await request("/finance/transactions", {
      method: "POST",
      token: superToken,
      form: invoiceForm({ categoryId, clientId: clientIds[0], projectId: projectIds[0], accountId, amount: "100", applyTax: false }),
    });
    const untaxedId = Number(untaxed.body?.id);
    transactionIds.push(untaxedId);
    const [untaxedRows] = await pool.execute<RowDataPacket[]>(
      "SELECT invoice_tax_applied, invoice_tax_rate, invoice_tax_amount, invoice_subtotal, invoice_total, invoice_path FROM transactions WHERE id = ?",
      [untaxedId],
    );
    generatedFiles.push(String(untaxedRows[0]?.invoice_path));
    check(untaxed.status === 201 && Number(untaxedRows[0]?.invoice_tax_applied) === 0 && Number(untaxedRows[0]?.invoice_tax_rate) === 0 && Number(untaxedRows[0]?.invoice_tax_amount) === 0 && Number(untaxedRows[0]?.invoice_total) === Number(untaxedRows[0]?.invoice_subtotal), "tax-off invoice persists an explicit zero-tax snapshot");
    const untaxedPdf = await request(`/finance/transactions/${untaxedId}/invoice`, { token: superToken });
    check(untaxedPdf.status === 200 && untaxedPdf.bytes?.subarray(0, 4).toString() === "37,80,68,70", "tax-off invoice download is a real PDF");
    if (PDF_OUTPUT_OFF && untaxedPdf.bytes) {
      fs.mkdirSync(path.dirname(PDF_OUTPUT_OFF), { recursive: true });
      fs.writeFileSync(PDF_OUTPUT_OFF, untaxedPdf.bytes);
    }

    const invoiceDownload = await request(`/finance/transactions/${transactionId}/invoice`, { token: superToken });
    check(invoiceDownload.status === 200 && invoiceDownload.contentType.includes("application/pdf") && invoiceDownload.disposition.includes(`attachment; filename="${invoiceNumber}.pdf"`), "invoice response downloads with the exact invoice-number filename");
    check(invoiceDownload.bytes?.subarray(0, 4).toString() === "37,80,68,70", "invoice download is a real PDF");
    if (PDF_OUTPUT && invoiceDownload.bytes) {
      fs.mkdirSync(path.dirname(PDF_OUTPUT), { recursive: true });
      fs.writeFileSync(PDF_OUTPUT, invoiceDownload.bytes);
    }
    const preview = await request(`/finance/transactions/${transactionId}/invoice?preview=1`, { token: superToken });
    check(preview.status === 200 && preview.disposition.startsWith("inline;") && preview.disposition.includes(`${invoiceNumber}.pdf`), "invoice preview uses the same authoritative PDF and filename");

    const [auditRows] = await pool.execute<RowDataPacket[]>(
      "SELECT changes_json FROM audit_logs WHERE entity_type = 'transaction' AND entity_id = ? ORDER BY id DESC LIMIT 1",
      [transactionId],
    );
    const auditText = JSON.stringify(auditRows[0]?.changes_json ?? "");
    check(!auditText.includes("1234567890123") && auditText.includes(invoiceNumber), "audit metadata records invoice identity without the full sender account number");
  } finally {
    if (transactionIds.length) {
      await pool.query("DELETE FROM audit_logs WHERE entity_type = 'transaction' AND entity_id IN (?)", [transactionIds]);
      await pool.query("DELETE FROM transactions WHERE id IN (?)", [transactionIds]);
    }
    if (clientIds.length && projectIds.length) {
      await pool.query("DELETE FROM invoice_sequences WHERE client_id IN (?) OR project_id IN (?)", [clientIds, projectIds]);
    }
    if (projectIds.length) await pool.query("DELETE FROM projects WHERE id IN (?)", [projectIds]);
    if (clientIds.length) await pool.query("DELETE FROM clients WHERE id IN (?)", [clientIds]);
    if (accountId !== null) {
      await pool.execute("DELETE FROM audit_logs WHERE entity_type = 'finance_account' AND entity_id = ?", [accountId]);
      await pool.execute("DELETE FROM finance_accounts WHERE id = ?", [accountId]);
    }
    for (const userId of [adminUserId, superUserId]) {
      if (userId !== null) {
        await pool.execute("DELETE FROM audit_logs WHERE user_id = ?", [userId]);
        await pool.execute("DELETE FROM super_password_attempts WHERE user_id = ?", [userId]);
        await pool.execute("DELETE FROM reveal_attempts WHERE user_id = ?", [userId]);
      }
    }
    if (adminUserId !== null) await pool.execute("DELETE FROM users WHERE id = ?", [adminUserId]);
    if (superUserId !== null) await pool.execute("DELETE FROM users WHERE id = ?", [superUserId]);
    if (employeeId !== null) await pool.execute("DELETE FROM employees WHERE id = ?", [employeeId]);
    for (const filename of generatedFiles.filter(Boolean)) {
      const safe = path.basename(filename);
      const fullPath = path.join(process.cwd(), "uploads", "transactions", safe);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
