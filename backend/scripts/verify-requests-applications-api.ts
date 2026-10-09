import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../src/db";

const BASE = process.env.API_URL || "http://localhost:4000/api";
const PDF_DIR = process.env.PDF_OUTPUT_DIR;
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(`FAILED: ${message}`); console.log(`PASS: ${message}`); }
async function request(route: string, options: { method?: string; token?: string; json?: unknown } = {}) {
  const response = await fetch(`${BASE}${route}`, { method: options.method ?? "GET", headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.json === undefined ? {} : { "Content-Type": "application/json" }) }, body: options.json === undefined ? undefined : JSON.stringify(options.json) });
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("application/pdf")) return { status: response.status, body: null, bytes: Buffer.from(await response.arrayBuffer()), type };
  return { status: response.status, body: await response.json().catch(() => null) as Record<string, unknown> | null, bytes: null, type };
}
async function login(identifier: string, password: string) { return request("/auth/login", { method: "POST", json: { email: identifier, password } }); }

async function main() {
  const suffix = Date.now();
  const password = `Employee-${suffix}`;
  const changed = `Changed-${suffix}`;
  const adminPassword = `Admin-${suffix}`;
  const employeeIds: number[] = [], userIds: number[] = [], applicationIds: number[] = [];
  try {
    const [roles] = await pool.execute<RowDataPacket[]>("SELECT id, name FROM roles WHERE name IN ('employee','admin')");
    const role = (name: string) => Number(roles.find((row) => row.name === name)?.id);
    async function make(code: string, name: string, email: string, pass: string, roleName: "employee" | "admin") {
      const [employee] = await pool.execute<ResultSetHeader>("INSERT INTO employees (employee_code, full_name, email, designation, joining_date, status) VALUES (?, ?, ?, 'Verifier', '2026-01-01', 'active')", [code, name, email]);
      employeeIds.push(employee.insertId);
      const [user] = await pool.execute<ResultSetHeader>("INSERT INTO users (role_id, full_name, email, employee_id, password_hash, is_active) VALUES (?, ?, ?, ?, ?, TRUE)", [role(roleName), name, email, employee.insertId, await bcrypt.hash(pass, 12)]);
      userIds.push(user.insertId);
      return { employeeId: employee.insertId, userId: user.insertId };
    }
    const firstEmail = `app-first-${suffix}@example.test`, secondEmail = `app-second-${suffix}@example.test`, adminEmail = `app-admin-${suffix}@example.test`;
    const first = await make(`APP-A-${suffix}`, "Application Owner", firstEmail, password, "employee");
    await make(`APP-B-${suffix}`, "Other Employee", secondEmail, password, "employee");
    await make(`APP-M-${suffix}`, "Promoted Reviewer", adminEmail, adminPassword, "admin");

    check((await request("/applications/me")).status === 401, "applications require authentication");
    const firstToken = String((await login(firstEmail, password)).body?.token);
    const secondToken = String((await login(secondEmail, password)).body?.token);
    const adminSelection = String((await login(adminEmail, adminPassword)).body?.token);
    const adminEmployeeToken = String((await request("/auth/select-mode", { method: "POST", token: adminSelection, json: { mode: "employee" } })).body?.token);
    check((await request("/applications", { token: adminEmployeeToken })).status === 403, "promoted Admin in Employee mode cannot manage applications");
    const employeeModeCreate = await request("/applications/me", { method: "POST", token: adminEmployeeToken, json: { category: "General Request", subject: "Employee-mode request", application_date: "2026-09-28", body: "This request belongs to the promoted administrator as an employee." } });
    check(employeeModeCreate.status === 201, "promoted Admin in Employee mode can submit their own application"); applicationIds.push(Number(employeeModeCreate.body?.id));

    const payload = { category: "Equipment", subject: "Controlled application", application_date: "2026-09-28", body: "This is a controlled multi-line application.\n\nIt verifies the employee-owned workflow and PDF rendering." };
    const preview = await request("/applications/me/preview", { method: "POST", token: firstToken, json: payload });
    check(preview.status === 200 && preview.bytes?.subarray(0, 4).toString("ascii") === "%PDF", "employee application preview is a real PDF");
    if (PDF_DIR && preview.bytes) { fs.mkdirSync(PDF_DIR, { recursive: true }); fs.writeFileSync(path.join(PDF_DIR, "application-preview.pdf"), preview.bytes); }
    const created = await request("/applications/me", { method: "POST", token: firstToken, json: payload });
    const applicationId = Number(created.body?.id); applicationIds.push(applicationId);
    check(created.status === 201 && created.body?.status === "pending", "new application starts pending and derives employee identity from auth");
    check((await request(`/applications/me/${applicationId}`, { token: secondToken })).status === 404, "employee cannot read another employee's application");
    check((await request(`/applications/me/${applicationId}/pdf`, { token: secondToken })).status === 404, "employee cannot download another employee's application PDF");
    const ownPdf = await request(`/applications/me/${applicationId}/pdf`, { token: firstToken });
    check(ownPdf.status === 200 && ownPdf.bytes?.subarray(0, 4).toString("ascii") === "%PDF", "employee can download their own application PDF");

    const adminSelection2 = String((await login(adminEmail, adminPassword)).body?.token);
    const adminToken = String((await request("/auth/select-mode", { method: "POST", token: adminSelection2, json: { mode: "admin" } })).body?.token);
    check((await request("/applications?status=pending", { token: adminToken })).status === 200, "Admin mode can list application requests");
    const decisions = await Promise.all([request(`/applications/${applicationId}/approve`, { method: "POST", token: adminToken, json: {} }), request(`/applications/${applicationId}/reject`, { method: "POST", token: adminToken, json: {} })]);
    check(decisions.map((item) => item.status).sort().join(",") === "200,409", "application row locking permits exactly one final concurrent decision");
    check((await request("/dashboard/activity", { token: adminToken })).status === 403, "Admin still cannot access Super Admin recent activity");

    check((await request("/settings/change-login-password", { method: "POST", token: firstToken, json: { currentPassword: "wrong-password", newPassword: changed, confirmPassword: changed } })).status === 401, "change password rejects an incorrect current password");
    check((await request("/settings/change-login-password", { method: "POST", token: firstToken, json: { currentPassword: password, newPassword: changed, confirmPassword: `${changed}-mismatch` } })).status === 400, "change password validates confirmation");
    check((await request("/settings/change-login-password", { method: "POST", token: firstToken, json: { currentPassword: password, newPassword: changed, confirmPassword: changed } })).status === 200, "authenticated employee can atomically change their password");
    const [passwordRows] = await pool.execute<RowDataPacket[]>("SELECT password_hash FROM users WHERE id = ?", [first.userId]);
    check(await bcrypt.compare(changed, String(passwordRows[0].password_hash)) && !(await bcrypt.compare(password, String(passwordRows[0].password_hash))), "new password hash works and old password is invalidated");
    const [auditRows] = await pool.execute<RowDataPacket[]>("SELECT changes_json FROM audit_logs WHERE user_id = ? AND entity_type IN ('user','general_application')", [first.userId]);
    const audit = JSON.stringify(auditRows);
    check(!audit.includes(password) && !audit.includes(changed) && !audit.includes(payload.body), "audit records contain no password, hash, or application body");
  } finally {
    if (applicationIds.length) { await pool.query("DELETE FROM audit_logs WHERE entity_type = 'general_application' AND entity_id IN (?)", [applicationIds]); await pool.query("DELETE FROM general_applications WHERE id IN (?)", [applicationIds]); }
    for (const id of userIds) { await pool.execute("DELETE FROM audit_logs WHERE user_id = ?", [id]); await pool.execute("DELETE FROM super_password_attempts WHERE user_id = ?", [id]); await pool.execute("DELETE FROM reveal_attempts WHERE user_id = ?", [id]); }
    for (const id of userIds) await pool.execute("DELETE FROM users WHERE id = ?", [id]);
    for (const id of employeeIds) await pool.execute("DELETE FROM employees WHERE id = ?", [id]);
    await pool.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
