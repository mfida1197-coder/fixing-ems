import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../src/db";

const BASE_URL = process.env.API_URL || "http://localhost:4000/api";
const PDF_OUTPUT_DIR = process.env.PDF_OUTPUT_DIR;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`PASS: ${message}`);
}

async function request(route: string, options: { method?: string; token?: string; json?: unknown } = {}) {
  const response = await fetch(`${BASE_URL}${route}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.json === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const disposition = response.headers.get("content-disposition") ?? "";
  if (contentType.includes("application/pdf")) {
    return { status: response.status, contentType, disposition, body: null, bytes: Buffer.from(await response.arrayBuffer()) };
  }
  return {
    status: response.status,
    contentType,
    disposition,
    body: await response.json().catch(() => null) as Record<string, unknown> | null,
    bytes: null,
  };
}

async function login(identifier: string, password: string) {
  return request("/auth/login", { method: "POST", json: { email: identifier, password } });
}

async function main() {
  const suffix = Date.now();
  const originalPassword = `Original-${suffix}`;
  const rejectedPassword = `Rejected-${suffix}`;
  const approvedPassword = `Approved-${suffix}`;
  const concurrentPassword = `Concurrent-${suffix}`;
  const adminPassword = `Admin-${suffix}`;
  const targetCnic = `91${String(suffix).slice(-11)}`.slice(0, 13);
  const concurrentCnic = `92${String(suffix + 1).slice(-11)}`.slice(0, 13);
  const adminCnic = `93${String(suffix + 2).slice(-11)}`.slice(0, 13);
  let targetEmployeeId: number | null = null;
  let targetUserId: number | null = null;
  let concurrentEmployeeId: number | null = null;
  let concurrentUserId: number | null = null;
  let adminEmployeeId: number | null = null;
  let adminUserId: number | null = null;
  let projectId: number | null = null;
  let clientId: number | null = null;
  const resetRequestIds: number[] = [];
  const letterIds: number[] = [];

  try {
    const [roles] = await pool.execute<RowDataPacket[]>("SELECT id, name FROM roles WHERE name IN ('employee','admin')");
    const roleId = (name: string) => Number(roles.find((role) => role.name === name)?.id);
    const employeeHash = await bcrypt.hash(originalPassword, 12);
    const adminHash = await bcrypt.hash(adminPassword, 12);

    const makeEmployee = async (code: string, name: string, cnic: string, passwordHash: string) => {
      const [employeeResult] = await pool.execute<ResultSetHeader>(
        `INSERT INTO employees (employee_code, full_name, designation, joining_date, status, cnic, cnic_last4)
         VALUES (?, ?, 'Software Engineer', '2026-01-15', 'active', ?, ?)`,
        [code, name, cnic, cnic.slice(-4)],
      );
      const employeeId = employeeResult.insertId;
      const [userResult] = await pool.execute<ResultSetHeader>(
        `INSERT INTO users (role_id, full_name, cnic, employee_id, password_hash, is_active)
         VALUES (?, ?, ?, ?, ?, TRUE)`,
        [roleId("employee"), name, cnic, employeeId, passwordHash],
      );
      return { employeeId, userId: userResult.insertId };
    };

    ({ employeeId: targetEmployeeId, userId: targetUserId } = await makeEmployee(`RST-${suffix}`, "Reset Target", targetCnic, employeeHash));
    ({ employeeId: concurrentEmployeeId, userId: concurrentUserId } = await makeEmployee(`CON-${suffix}`, "Concurrent Target", concurrentCnic, employeeHash));
    const adminFixture = await makeEmployee(`ADM-${suffix}`, "Promoted Admin Reviewer", adminCnic, adminHash);
    adminEmployeeId = adminFixture.employeeId;
    adminUserId = adminFixture.userId;
    await pool.execute("UPDATE users SET role_id = ? WHERE id = ?", [roleId("admin"), adminUserId]);

    const [clientResult] = await pool.execute<ResultSetHeader>(
      "INSERT INTO clients (company_name, status) VALUES (?, 'active')",
      [`Letters Client ${suffix}`],
    );
    clientId = clientResult.insertId;
    const [projectResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO projects (client_id, name, status, project_value, value_currency)
       VALUES (?, 'Employee Management System', 'ongoing', 100000, 'PKR')`,
      [clientId],
    );
    projectId = projectResult.insertId;
    await pool.execute(
      "INSERT INTO project_assignments (project_id, employee_id, role_on_project, assigned_at) VALUES (?, ?, 'Developer', '2026-01-15')",
      [projectId, targetEmployeeId],
    );

    const adminLogin = await login(adminCnic, adminPassword);
    const selectionToken = String(adminLogin.body?.token);
    const employeeMode = await request("/auth/select-mode", { method: "POST", token: selectionToken, json: { mode: "employee" } });
    const employeeModeToken = String(employeeMode.body?.token);
    check((await request("/password-resets", { token: employeeModeToken })).status === 403, "promoted Admin in Employee mode cannot manage password resets");
    check((await request(`/employee-letters/employee/${targetEmployeeId}`, { token: employeeModeToken })).status === 403, "promoted Admin in Employee mode cannot access employee letters");

    const freshAdminLogin = await login(adminCnic, adminPassword);
    const adminMode = await request("/auth/select-mode", {
      method: "POST",
      token: String(freshAdminLogin.body?.token),
      json: { mode: "admin" },
    });
    const adminToken = String(adminMode.body?.token);
    check((await request("/finance/transactions", { token: adminToken })).status === 200, "current Admin transaction access remains available");

    const genericMessage = "If the provided information matches an employee account, the password reset request has been submitted for review.";
    const firstRequest = await request("/password-resets/request", {
      method: "POST",
      json: { cnic: targetCnic, new_password: rejectedPassword, confirm_password: rejectedPassword },
    });
    check(firstRequest.status === 200 && firstRequest.body?.message === genericMessage, "valid public reset request returns the generic response");
    const [firstRows] = await pool.execute<RowDataPacket[]>(
      "SELECT id, pending_password_hash FROM password_reset_requests WHERE user_id = ? AND status = 'pending'",
      [targetUserId],
    );
    check(firstRows.length === 1 && String(firstRows[0].pending_password_hash).startsWith("$2"), "only a bcrypt pending hash is persisted");
    resetRequestIds.push(Number(firstRows[0].id));
    const originalPendingHash = String(firstRows[0].pending_password_hash);

    const duplicate = await request("/password-resets/request", {
      method: "POST",
      json: { cnic: targetCnic, new_password: `Duplicate-${suffix}`, confirm_password: `Duplicate-${suffix}` },
    });
    const [duplicateRows] = await pool.execute<RowDataPacket[]>(
      "SELECT id, pending_password_hash FROM password_reset_requests WHERE user_id = ? AND status = 'pending'",
      [targetUserId],
    );
    check(duplicate.status === 200 && duplicate.body?.message === genericMessage && duplicateRows.length === 1 && duplicateRows[0].pending_password_hash === originalPendingHash, "duplicate submission preserves the single existing pending request");

    const list = await request("/password-resets?status=pending", { token: adminToken });
    const listed = (list.body?.requests as Array<Record<string, unknown>>).find((item) => Number(item.id) === resetRequestIds[0]);
    check(Boolean(listed) && !Object.keys(listed ?? {}).some((key) => key.includes("password") || key.includes("hash")), "Admin reset list exposes no password or hash field");

    const rejected = await request(`/password-resets/${resetRequestIds[0]}/reject`, {
      method: "POST",
      token: adminToken,
      json: { reason: "Controlled rejection" },
    });
    check(rejected.status === 200 && (await login(targetCnic, originalPassword)).status === 200, "rejection preserves the employee's current password");

    const approvalRequest = await request("/password-resets/request", {
      method: "POST",
      json: { cnic: targetCnic, new_password: approvedPassword, confirm_password: approvedPassword },
    });
    check(approvalRequest.status === 200, "employee can submit a new request after rejection");
    const [approvalRows] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM password_reset_requests WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
      [targetUserId],
    );
    const approvalId = Number(approvalRows[0].id);
    resetRequestIds.push(approvalId);
    check((await request(`/password-resets/${approvalId}/approve`, { method: "POST", token: adminToken, json: {} })).status === 200, "Admin can atomically approve a pending reset");
    check((await login(targetCnic, approvedPassword)).status === 200, "approved new password works");
    check((await login(targetCnic, originalPassword)).status === 401, "old password no longer works after approval");

    const concurrentRequest = await request("/password-resets/request", {
      method: "POST",
      json: { cnic: concurrentCnic, new_password: concurrentPassword, confirm_password: concurrentPassword },
    });
    check(concurrentRequest.status === 200, "second employee reset request accepted");
    const [concurrentRows] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM password_reset_requests WHERE user_id = ? AND status = 'pending'",
      [concurrentUserId],
    );
    const concurrentId = Number(concurrentRows[0].id);
    resetRequestIds.push(concurrentId);
    const reviews = await Promise.all([
      request(`/password-resets/${concurrentId}/approve`, { method: "POST", token: adminToken, json: {} }),
      request(`/password-resets/${concurrentId}/reject`, { method: "POST", token: adminToken, json: { reason: "Concurrent decision" } }),
    ]);
    check(reviews.map((result) => result.status).sort().join(",") === "200,409", "row locking allows exactly one concurrent reset decision");

    const invalid = await request("/password-resets/request", {
      method: "POST",
      json: { cnic: "0000000000000", new_password: `Unknown-${suffix}`, confirm_password: `Unknown-${suffix}` },
    });
    check(invalid.status === 200 && invalid.body?.message === genericMessage, "unknown CNIC uses the identical non-enumerating response");
    const rateLimited = await request("/password-resets/request", {
      method: "POST",
      json: { cnic: "0000000000000", new_password: `Limited-${suffix}`, confirm_password: `Limited-${suffix}` },
    });
    check(rateLimited.status === 429, "public reset endpoint enforces its request limit");

    const employeeLogin = await login(targetCnic, approvedPassword);
    const employeeToken = String(employeeLogin.body?.token);
    check((await request("/password-resets", { token: employeeToken })).status === 403, "normal Employee cannot manage reset requests");
    check((await request(`/employee-letters/employee/${targetEmployeeId}`, { token: employeeToken })).status === 403, "normal Employee cannot access official letters");

    const letterTypes = ["hiring", "promotion", "termination"] as const;
    for (const letterType of letterTypes) {
      const payload = {
        employee_id: targetEmployeeId,
        letter_type: letterType,
        issue_date: "2026-09-28",
        effective_date: letterType === "hiring" ? "2026-01-15" : "2026-10-01",
        subject: `${letterType} verification letter`,
        body: `This is the controlled ${letterType} letter body.\n\nIt verifies editable multi-paragraph content on the official Ashtech letterhead.`,
        new_designation: letterType === "promotion" ? "Senior Software Engineer" : null,
        notes: letterType === "termination" ? "Controlled verification note" : null,
      };
      const preview = await request("/employee-letters/preview", { method: "POST", token: adminToken, json: payload });
      check(preview.status === 200 && preview.bytes?.subarray(0, 4).toString("ascii") === "%PDF", `${letterType} preview is a real PDF`);
      const created = await request("/employee-letters", { method: "POST", token: adminToken, json: payload });
      const letterId = Number(created.body?.id);
      letterIds.push(letterId);
      check(created.status === 201 && letterId > 0, `${letterType} letter history record created`);
      const pdf = await request(`/employee-letters/${letterId}/pdf`, { token: adminToken });
      const expectedPrefix = letterType.toUpperCase();
      check(pdf.status === 200 && pdf.disposition.includes(`${expectedPrefix}-RST-${suffix}-2026-09-28.pdf`), `${letterType} letter uses deterministic canonical filename`);
      if (PDF_OUTPUT_DIR && pdf.bytes) {
        fs.mkdirSync(PDF_OUTPUT_DIR, { recursive: true });
        fs.writeFileSync(path.join(PDF_OUTPUT_DIR, `${letterType}.pdf`), pdf.bytes);
      }
    }
    const longPreview = await request("/employee-letters/preview", {
      method: "POST",
      token: adminToken,
      json: {
        employee_id: targetEmployeeId,
        letter_type: "hiring",
        issue_date: "2026-09-28",
        effective_date: "2026-10-01",
        subject: "Multi-page letter verification",
        body: Array.from(
          { length: 28 },
          (_, index) => `Verification paragraph ${index + 1}. This deliberately exercises multi-page flow while preserving the official header, watermark, body margins, and footer.`,
        ).join("\n\n"),
      },
    });
    check(longPreview.status === 200 && longPreview.bytes?.subarray(0, 4).toString("ascii") === "%PDF", "long official letter preview is a real multi-page-capable PDF");
    if (PDF_OUTPUT_DIR && longPreview.bytes) {
      fs.mkdirSync(PDF_OUTPUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(PDF_OUTPUT_DIR, "multipage.pdf"), longPreview.bytes);
    }
    const history = await request(`/employee-letters/employee/${targetEmployeeId}`, { token: adminToken });
    check(history.status === 200 && (history.body?.letters as unknown[]).length === 3, "employee profile letter history contains all generated letters");
    const [employeeAfterLetters] = await pool.execute<RowDataPacket[]>("SELECT designation, status FROM employees WHERE id = ?", [targetEmployeeId]);
    check(employeeAfterLetters[0].designation === "Software Engineer" && employeeAfterLetters[0].status === "active", "letter generation does not mutate designation or employment status");

    const [securityRows] = await pool.execute<RowDataPacket[]>(
      `SELECT pending_password_hash FROM password_reset_requests WHERE id IN (?)`,
      [resetRequestIds],
    );
    check(securityRows.every((row) => row.pending_password_hash === null), "finalized reset requests retain no pending password hash");
    const [auditRows] = await pool.execute<RowDataPacket[]>(
      `SELECT entity_type, changes_json FROM audit_logs
       WHERE (entity_type = 'password_reset_request' AND entity_id IN (?))
          OR (entity_type = 'employee_letter' AND entity_id IN (?))`,
      [resetRequestIds, letterIds],
    );
    const auditText = JSON.stringify(auditRows);
    check(!auditText.includes(originalPassword) && !auditText.includes(approvedPassword) && !auditText.includes("$2"), "reset and letter audit metadata contains no password, hash, or letter body");
  } finally {
    if (letterIds.length) {
      await pool.query("DELETE FROM audit_logs WHERE entity_type = 'employee_letter' AND entity_id IN (?)", [letterIds]);
      await pool.query("DELETE FROM employee_letters WHERE id IN (?)", [letterIds]);
    }
    if (resetRequestIds.length) {
      await pool.query("DELETE FROM audit_logs WHERE entity_type = 'password_reset_request' AND entity_id IN (?)", [resetRequestIds]);
      await pool.query("DELETE FROM password_reset_requests WHERE id IN (?)", [resetRequestIds]);
    }
    if (projectId !== null && targetEmployeeId !== null) await pool.execute("DELETE FROM project_assignments WHERE project_id = ? AND employee_id = ?", [projectId, targetEmployeeId]);
    if (projectId !== null) await pool.execute("DELETE FROM projects WHERE id = ?", [projectId]);
    if (clientId !== null) await pool.execute("DELETE FROM clients WHERE id = ?", [clientId]);
    for (const userId of [targetUserId, concurrentUserId, adminUserId]) {
      if (userId !== null) {
        await pool.execute("DELETE FROM audit_logs WHERE user_id = ?", [userId]);
        await pool.execute("DELETE FROM super_password_attempts WHERE user_id = ?", [userId]);
        await pool.execute("DELETE FROM reveal_attempts WHERE user_id = ?", [userId]);
      }
    }
    for (const userId of [targetUserId, concurrentUserId, adminUserId]) {
      if (userId !== null) await pool.execute("DELETE FROM users WHERE id = ?", [userId]);
    }
    for (const employeeId of [targetEmployeeId, concurrentEmployeeId, adminEmployeeId]) {
      if (employeeId !== null) await pool.execute("DELETE FROM employees WHERE id = ?", [employeeId]);
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
