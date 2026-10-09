import { Router } from "express";
import { pool } from "../db";
import { decrypt } from "../crypto";
import { requireAuth, requirePermission } from "../middleware/auth";
import { buildPdf, PdfTable } from "../pdf";
import { netSalary } from "../finance/salary";

const router = Router();
router.use(requireAuth, requirePermission("reports:view"));

const dt = (d: any) => {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-PK", { year: "numeric", month: "short", day: "2-digit" });
};
const fmtNum = (n: any, cur = "PKR") => n != null ? `${cur} ${Number(n).toLocaleString()}` : "-";

function sendPdf(res: any, buffer: Buffer, filename: string) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

// EMPLOYEES PDF
router.get("/employees.pdf", async (_req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.employee_code, e.full_name, e.father_name, e.designation, e.status,
              e.joining_date, e.email, e.phone,
              e.cnic_enc, e.address_enc, e.bank_name_enc, e.bank_account_enc,
              e.salary_currency, e.basic_salary, e.allowances, e.deductions
       FROM employees e ORDER BY e.employee_code`
    );

    const emps = (rows as any[]).map((e) => ({
      code: e.employee_code,
      name: e.full_name,
      designation: e.designation,
      status: e.status,
      joined: dt(e.joining_date),
      email: e.email ?? "-",
      phone: e.phone ?? "-",
      cnic: e.cnic_enc ? decrypt(e.cnic_enc) : "-",
      bank: e.bank_name_enc ? decrypt(e.bank_name_enc) : "-",
      bankAcc: e.bank_account_enc ? decrypt(e.bank_account_enc) : "-",
      basic: fmtNum(e.basic_salary, e.salary_currency),
      allowances: fmtNum(e.allowances, e.salary_currency),
      deductions: fmtNum(e.deductions, e.salary_currency),
      net: fmtNum(
        netSalary(e.basic_salary, e.allowances, e.deductions),
        e.salary_currency
      ),
    }));

    const tables: PdfTable[] = [
      {
        title: "General Information",
        headers: ["Code", "Name", "Designation", "Status", "Joined", "Net Salary"],
        widths: [55, "*", "*", 60, 70, 70],
        rows: emps.map(e => [e.code, e.name, e.designation, e.status, e.joined, e.net]),
      },
      {
        title: "Contact Details",
        headers: ["Code", "Name", "Email", "Phone"],
        widths: [55, 100, "*", 90],
        rows: emps.map(e => [e.code, e.name, e.email, e.phone]),
      },
      {
        title: "Identity & Bank Details",
        headers: ["Code", "Name", "CNIC", "Bank", "Account No"],
        widths: [55, 90, 100, 80, "*"],
        rows: emps.map(e => [e.code, e.name, e.cnic, e.bank, e.bankAcc]),
      },
      {
        title: "Salary Breakdown",
        headers: ["Code", "Name", "Basic", "Allowances", "Deductions", "Net Salary"],
        widths: [55, "*", 75, 75, 75, 75],
        rows: emps.map(e => [e.code, e.name, e.basic, e.allowances, e.deductions, e.net]),
      },
    ];

    const pdf = await buildPdf(
      "Employee Records",
      `Total: ${emps.length} employees  ·  Generated ${new Date().toLocaleDateString("en-PK", { year: "numeric", month: "long", day: "2-digit" })}`,
      tables
    );
    sendPdf(res, pdf, `Ashtech-Employees-${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch (err) { next(err); }
});

// INDIVIDUAL EMPLOYEE PDF
router.get("/employee/:id.pdf", async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`SELECT e.* FROM employees e WHERE e.id = ? LIMIT 1`, [req.params.id]);
    const e = (rows as any[])[0];
    if (!e) return res.status(404).json({ error: "Not found" });

    const cnic = e.cnic_enc ? decrypt(e.cnic_enc) : "-";
    const address = e.address_enc ? decrypt(e.address_enc) : "-";
    const bankName = e.bank_name_enc ? decrypt(e.bank_name_enc) : "-";
    const bankAccount = e.bank_account_enc ? decrypt(e.bank_account_enc) : "-";
    const net = netSalary(e.basic_salary, e.allowances, e.deductions);

    const tables: PdfTable[] = [
      {
        title: "Personal Information",
        headers: ["Field", "Value"],
        widths: [130, "*"],
        rows: [
          ["Employee Code", e.employee_code],
          ["Full Name", e.full_name],
          ["Father's Name", e.father_name ?? "-"],
          ["Designation", e.designation],
          ["Status", e.status],
          ["Joining Date", dt(e.joining_date)],
          ["Email", e.email ?? "-"],
          ["Phone", e.phone ?? "-"],
        ],
      },
      {
        title: "Identity & Bank",
        headers: ["Field", "Value"],
        widths: [130, "*"],
        rows: [
          ["CNIC", cnic],
          ["Address", address],
          ["Bank Name", bankName],
          ["Bank Account", bankAccount],
        ],
      },
      {
        title: "Salary Breakdown",
        headers: ["Component", "Amount"],
        widths: [130, "*"],
        rows: [
          ["Basic Salary", fmtNum(e.basic_salary, e.salary_currency)],
          ["Allowances", fmtNum(e.allowances, e.salary_currency)],
          ["Deductions", fmtNum(e.deductions, e.salary_currency)],
          ["Net Salary", fmtNum(net, e.salary_currency)],
        ],
      },
    ];

    const pdf = await buildPdf(`Employee Profile`, `${e.full_name}  ·  ${e.designation}  ·  ${e.status}`, tables);
    sendPdf(res, pdf, `Ashtech-Employee-${e.employee_code}.pdf`);
  } catch (err) { next(err); }
});

// CLIENTS PDF
router.get("/clients.pdf", async (_req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT c.company_name, c.contact_person, c.email, c.phone, c.country, c.status,
              COUNT(p.id) AS project_count
       FROM clients c LEFT JOIN projects p ON p.client_id = c.id
       GROUP BY c.id ORDER BY c.company_name`
    );

    const tables: PdfTable[] = [{
      headers: ["Company", "Contact Person", "Email", "Phone", "Country", "Projects", "Status"],
      widths: [100, 80, "*", 70, 60, 40, 50],
      rows: (rows as any[]).map(c => [
        c.company_name, c.contact_person ?? "-", c.email ?? "-",
        c.phone ?? "-", c.country ?? "-", String(c.project_count), c.status
      ]),
    }];

    const pdf = await buildPdf(
      "Client Records",
      `Total: ${(rows as any[]).length} clients  ·  Generated ${new Date().toLocaleDateString("en-PK", { year: "numeric", month: "long", day: "2-digit" })}`,
      tables
    );
    sendPdf(res, pdf, `Ashtech-Clients-${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch (err) { next(err); }
});

// INDIVIDUAL CLIENT PDF
router.get("/client/:id.pdf", requirePermission("finance:manage"), async (req, res, next) => {
  try {
    const [clientRows] = await pool.execute("SELECT * FROM clients WHERE id = ? LIMIT 1", [req.params.id]);
    const client = (clientRows as any[])[0];
    if (!client) return res.status(404).json({ error: "Not found" });

    const [projects] = await pool.execute(
      `SELECT p.name, p.status, p.project_value, p.value_currency, p.handover_date
       FROM projects p WHERE p.client_id = ? ORDER BY p.status`, [req.params.id]
    );
    const [txns] = await pool.execute(
      `SELECT t.txn_date, t.type, t.description, t.amount, t.currency, t.amount_pkr, fc.name AS category
       FROM transactions t JOIN finance_categories fc ON fc.id = t.category_id
       WHERE t.client_id = ? ORDER BY t.txn_date DESC`, [req.params.id]
    );

    const txnList = txns as any[];
    const totalIn = txnList.filter(t => t.type === "inflow").reduce((s, t) => s + Number(t.amount_pkr), 0);
    const totalOut = txnList.filter(t => t.type === "outflow").reduce((s, t) => s + Number(t.amount_pkr), 0);

    const tables: PdfTable[] = [
      {
        title: "Client Information",
        headers: ["Field", "Value"],
        widths: [130, "*"],
        rows: [
          ["Company", client.company_name],
          ["Contact", client.contact_person ?? "-"],
          ["Email", client.email ?? "-"],
          ["Phone", client.phone ?? "-"],
          ["Country", client.country ?? "-"],
          ["Status", client.status],
        ],
      },
      {
        title: "Projects",
        headers: ["Project Name", "Status", "Value", "Handover Date"],
        widths: ["*", 80, 90, 80],
        rows: (projects as any[]).map(p => [
          p.name,
          p.status.replace("_", " "),
          p.project_value ? `${p.value_currency} ${Number(p.project_value).toLocaleString()}` : "-",
          dt(p.handover_date)
        ]),
      },
      {
        title: "Transactions",
        headers: ["Date", "Category", "Description", "Amount", "PKR Value"],
        widths: [70, 70, "*", 90, 80],
        rows: txnList.map(t => [
          dt(t.txn_date),
          t.category.replace("_", " "),
          t.description ?? "-",
          `${t.type === "inflow" ? "+" : "-"} ${t.currency} ${Number(t.amount).toLocaleString()}`,
          `PKR ${Number(t.amount_pkr).toLocaleString()}`
        ]),
      },
    ];

    const pdf = await buildPdf(
      `Client Report — ${client.company_name}`,
      `In: PKR ${totalIn.toLocaleString()}  ·  Out: PKR ${totalOut.toLocaleString()}  ·  Net: PKR ${(totalIn - totalOut).toLocaleString()}`,
      tables
    );
    sendPdf(res, pdf, `Ashtech-Client-${client.company_name.replace(/\s+/g, "-")}.pdf`);
  } catch (err) { next(err); }
});

// PROJECTS PDF
router.get("/projects.pdf", async (_req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.name, p.status, p.start_date, p.end_date, p.handover_date,
              p.project_value, p.value_currency, c.company_name AS client_name,
              COUNT(pa.id) AS team_size
       FROM projects p JOIN clients c ON c.id = p.client_id
       LEFT JOIN project_assignments pa ON pa.project_id = p.id AND pa.removed_at IS NULL
       GROUP BY p.id ORDER BY p.status, p.name`
    );

    const tables: PdfTable[] = [{
      headers: ["Project", "Client", "Status", "Start Date", "Handover", "Value", "Team"],
      widths: ["*", 90, 65, 65, 65, 80, 30],
      rows: (rows as any[]).map(p => [
        p.name, p.client_name, p.status.replace("_", " "),
        dt(p.start_date), dt(p.handover_date),
        p.project_value ? `${p.value_currency} ${Number(p.project_value).toLocaleString()}` : "-",
        String(p.team_size)
      ]),
    }];

    const pdf = await buildPdf(
      "Project Records",
      `Total: ${(rows as any[]).length} projects  ·  Generated ${new Date().toLocaleDateString("en-PK", { year: "numeric", month: "long", day: "2-digit" })}`,
      tables
    );
    sendPdf(res, pdf, `Ashtech-Projects-${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch (err) { next(err); }
});

// INDIVIDUAL PROJECT PDF
router.get("/project/:id.pdf", requirePermission("finance:manage"), async (req, res, next) => {
  try {
    const [projRows] = await pool.execute(
      `SELECT p.*, c.company_name AS client_name FROM projects p
       JOIN clients c ON c.id = p.client_id WHERE p.id = ? LIMIT 1`, [req.params.id]
    );
    const project = (projRows as any[])[0];
    if (!project) return res.status(404).json({ error: "Not found" });

    const [team] = await pool.execute(
      `SELECT e.full_name, e.designation, pa.role_on_project
       FROM project_assignments pa JOIN employees e ON e.id = pa.employee_id
       WHERE pa.project_id = ? AND pa.removed_at IS NULL ORDER BY e.full_name`, [req.params.id]
    );
    const [txns] = await pool.execute(
      `SELECT t.txn_date, t.type, t.description, t.amount, t.currency, t.amount_pkr, fc.name AS category
       FROM transactions t JOIN finance_categories fc ON fc.id = t.category_id
       WHERE t.project_id = ? ORDER BY t.txn_date DESC`, [req.params.id]
    );

    const txnList = txns as any[];
    const totalIn = txnList.filter(t => t.type === "inflow").reduce((s, t) => s + Number(t.amount_pkr), 0);
    const totalOut = txnList.filter(t => t.type === "outflow").reduce((s, t) => s + Number(t.amount_pkr), 0);

    const tables: PdfTable[] = [
      {
        title: "Project Information",
        headers: ["Field", "Value"],
        widths: [130, "*"],
        rows: [
          ["Project", project.name],
          ["Client", project.client_name],
          ["Status", project.status.replace("_", " ")],
          ["Start Date", dt(project.start_date)],
          ["End Date", dt(project.end_date)],
          ["Handover Date", dt(project.handover_date)],
          ["Value", project.project_value ? `${project.value_currency} ${Number(project.project_value).toLocaleString()}` : "-"],
        ],
      },
      {
        title: "Team",
        headers: ["Name", "Role / Designation"],
        widths: [180, "*"],
        rows: (team as any[]).map(m => [m.full_name, m.role_on_project ?? m.designation]),
      },
      {
        title: `Transactions  ·  In: PKR ${totalIn.toLocaleString()}  ·  Out: PKR ${totalOut.toLocaleString()}`,
        headers: ["Date", "Category", "Description", "Amount", "PKR Value"],
        widths: [70, 70, "*", 90, 80],
        rows: txnList.map(t => [
          dt(t.txn_date),
          t.category.replace("_", " "),
          t.description ?? "-",
          `${t.type === "inflow" ? "+" : "-"} ${t.currency} ${Number(t.amount).toLocaleString()}`,
          `PKR ${Number(t.amount_pkr).toLocaleString()}`
        ]),
      },
    ];

    const pdf = await buildPdf(
      `Project Report — ${project.name}`,
      `${project.client_name}  ·  ${project.status.replace("_", " ")}`,
      tables
    );
    sendPdf(res, pdf, `Ashtech-Project-${project.name.replace(/\s+/g, "-")}.pdf`);
  } catch (err) { next(err); }
});

// FINANCE PDF
router.get("/finance.pdf", requirePermission("finance:manage"), async (req, res, next) => {
  try {
    const { month, from, to, period } = req.query as any;
    let where = "";
    let subtitle = "All transactions";
    let filename = "all";

    if (month) {
      where = `WHERE t.txn_date >= '${month}-01' AND t.txn_date < DATE_ADD('${month}-01', INTERVAL 1 MONTH)`;
      subtitle = `Month: ${month}`;
      filename = month;
    } else if (from && to) {
      where = `WHERE t.txn_date >= '${from}' AND t.txn_date <= '${to}'`;
      subtitle = `${from} to ${to}`;
      filename = `${from}-to-${to}`;
    } else if (period === "this_month") {
      where = `WHERE MONTH(t.txn_date) = MONTH(CURDATE()) AND YEAR(t.txn_date) = YEAR(CURDATE())`;
      subtitle = "This month";
      filename = "this-month";
    } else if (period === "last_month") {
      where = `WHERE MONTH(t.txn_date) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) AND YEAR(t.txn_date) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))`;
      subtitle = "Last month";
      filename = "last-month";
    } else if (period === "this_quarter") {
      where = `WHERE QUARTER(t.txn_date) = QUARTER(CURDATE()) AND YEAR(t.txn_date) = YEAR(CURDATE())`;
      subtitle = "This quarter";
      filename = "this-quarter";
    }

    const [rows] = await pool.execute(
      `SELECT t.txn_date, t.type, t.description, t.amount, t.currency, t.amount_pkr,
              fc.name AS category, c.company_name AS client_name,
              p.name AS project_name, e.full_name AS employee_name
       FROM transactions t
       JOIN finance_categories fc ON fc.id = t.category_id
       LEFT JOIN clients c ON c.id = t.client_id
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN employees e ON e.id = t.employee_id
       ${where} ORDER BY t.txn_date DESC`
    );

    const txns = rows as any[];
    const totalIn = txns.filter(t => t.type === "inflow").reduce((s, t) => s + Number(t.amount_pkr), 0);
    const totalOut = txns.filter(t => t.type === "outflow").reduce((s, t) => s + Number(t.amount_pkr), 0);
    const net = totalIn - totalOut;

    const tables: PdfTable[] = [{
      headers: ["Date", "Category", "Description", "Linked to", "Amount", "PKR Value"],
      widths: [65, 65, "*", 80, 90, 75],
      rows: txns.map(t => [
        dt(t.txn_date),
        t.category.replace("_", " "),
        t.description ?? "-",
        t.client_name ?? t.project_name ?? t.employee_name ?? "-",
        `${t.type === "inflow" ? "+" : "-"} ${t.currency} ${Number(t.amount).toLocaleString()}`,
        `PKR ${Number(t.amount_pkr).toLocaleString()}`
      ]),
    }];

    const pdf = await buildPdf(
      "Financial Statement",
      `${subtitle}  ·  In: PKR ${totalIn.toLocaleString()}  ·  Out: PKR ${totalOut.toLocaleString()}  ·  Net: PKR ${net.toLocaleString()}`,
      tables
    );
    sendPdf(res, pdf, `Ashtech-Finance-${filename}.pdf`);
  } catch (err) { next(err); }
});

export default router;
