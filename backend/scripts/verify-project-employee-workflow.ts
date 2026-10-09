import assert from "assert/strict";
import fs from "fs";
import { pool } from "../src/db";
import projects from "../src/routes/projects";
import clients from "../src/routes/clientPortal";
import { storeRequirementAttachment, removeRequirementAttachment, streamRequirementAttachment } from "../src/projects/requirementAttachments";

// Focused handler checks with mocked DB: no business records are changed.
async function main() {
  const route = (router: any, path: string, method: string) => router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
  const progress = route(projects, "/:id/progress", "post");
  const requirement = route(clients, "/projects/:id/requirements", "post");
  let assigned = true;
  let owner = true;
  let inserted = 0;
  let actor = 0;
  const conn = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}, execute: async (sql: string, params: unknown[]) => {
    if (sql.startsWith("SELECT pa.id")) return [assigned ? [{ id: 1 }] : []];
    if (sql.startsWith("SELECT id")) return [owner ? [{ id: 1, status: "ongoing", handover_date: null }] : []];
    if (sql.startsWith("INSERT INTO project_progress_updates")) { inserted++; actor = Number(params[3]); }
    return [{ insertId: 123 }];
  } };
  (pool as any).getConnection = async () => conn;
  const response = () => ({ code: 200, body: null as unknown, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } });
  const next = (error?: unknown) => { if (error) throw error; };
  const employee = { id: 42, role: "employee", mode: "employee" };
  let res = response();
  await progress({ user: employee, params: { id: "1" }, body: { progress_percent: 60, report: "Updated", created_by: 999 } }, res, next);
  assert.equal(res.code, 201); assert.equal(actor, 42);
  assigned = false; res = response();
  await progress({ user: employee, params: { id: "1" }, body: { progress_percent: 60, report: "Updated" } }, res, next);
  assert.equal(res.code, 404); assert.equal(inserted, 1);
  res = response();
  await progress({ user: { id: 7, role: "admin", mode: "admin" }, params: { id: "1" }, body: { progress_percent: 60, report: "Admin update" } }, res, next);
  assert.equal(res.code, 201); assert.equal(actor, 7);
  res = response();
  await requirement({ user: { client_id: 4 }, params: { id: "1" }, body: { content: "Requirement" } }, res, next);
  assert.equal(res.code, 201);
  owner = false; res = response();
  await requirement({ user: { client_id: 4 }, params: { id: "1" }, body: { content: "Requirement" } }, res, next);
  assert.equal(res.code, 404);
  assert.equal(storeRequirementAttachment(), null);
  assert.throws(() => storeRequirementAttachment({ buffer: Buffer.from("bad"), mimetype: "application/pdf", originalname: "x.pdf", size: 3 } as Express.Multer.File));
  owner = true;
  res = response();
  const file = { buffer: Buffer.from("%PDF-1.4\nfocused test"), mimetype: "application/pdf", originalname: "x.pdf", size: 21 } as Express.Multer.File;
  // Capture and remove just the new test file.
  const before = new Set(fs.readdirSync("uploads/transactions"));
  try { await requirement({ user: { client_id: 4 }, params: { id: "1" }, body: { content: "With file" }, file }, res, next); assert.equal(res.code, 201); }
  finally { for (const name of fs.readdirSync("uploads/transactions")) if (!before.has(name) && name.startsWith("requirement-")) removeRequirementAttachment(name); }
  let accessSql = "";
  (pool as any).execute = async (sql: string) => { accessSql = sql; return [[]]; };
  for (const user of [{ id: 1, role: "client", mode: "client", client_id: 4 }, employee, { id: 7, role: "admin", mode: "admin" }]) {
    res = response(); await (streamRequirementAttachment as any)({ user, params: { id: "1" } }, res, next);
    assert.equal(res.code, 404);
    assert.ok(user.role === "client" ? accessSql.includes("p.client_id = ?") : user.role === "employee" ? accessSql.includes("pa.removed_at IS NULL") : accessSql.includes("? > 0"));
  }
  const source = fs.readFileSync("src/routes/clientPortal.ts", "utf8");
  assert.ok(source.includes("SELECT id, progress_percent, report, created_at"));
  assert.ok(!/SELECT[^`]*created_by/.test(source));
  console.log("Focused project checks passed: assigned/denied progress, authenticated actor, Admin progress, owned requirements with/without file, file validation, attachment access predicates and client progress privacy.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
