import assert from "assert/strict";
import { EventEmitter } from "events";
import { pool } from "../src/db";
import letters from "../src/routes/employeeLetters";
import fs from "fs";
import * as gmail from "../src/email/gmail";

async function main() {
  const [legacy] = await pool.execute("SELECT COUNT(*) AS incomplete_snapshots FROM employee_letters WHERE letter_type IS NULL OR issue_date IS NULL OR effective_date IS NULL OR subject IS NULL OR subject = '' OR body_text IS NULL OR body_text = '' OR employee_name_snapshot IS NULL OR employee_name_snapshot = '' OR employee_code_snapshot IS NULL OR employee_code_snapshot = '' OR designation_snapshot IS NULL OR designation_snapshot = ''");
  console.log(`Existing records requiring legacy file fallback: ${Number((legacy as Array<{ incomplete_snapshots: number }>)[0].incomplete_snapshots)}`);
  const stack = (letters as any).stack;
  const handler = (path: string, method: string) => stack.find((layer: any) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
  const pdf = handler("/me/:id/pdf", "get");
  const read = handler("/me/read", "post");
  const mode = stack.find((layer: any) => layer.route?.path === "/me").route.stack[0].handle;
  const directory = "uploads/employee-letters";
  const before = fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
  const snapshot = { id: 1, letter_type: "hiring", issue_date: "2026-10-06", effective_date: "2026-10-10", subject: "Issued subject", body_text: "Issued body remains unchanged even after profile changes.", employee_name_snapshot: "Original Employee", employee_code_snapshot: "ORIGINAL", designation_snapshot: "Original Designation", project_snapshot: null, new_designation: null, notes: null, pdf_path: null, file_name: "test.pdf" };
  let downloaded = false;
  let readState = false;
  let tail = Promise.resolve();
  let delivered = 0;
  let queriedActor = 0;
  const next = (error?: unknown) => { if (error) throw error; };
  class Response extends EventEmitter {
    code = 200; writableFinished = false; headersSent = false; aborted = false;
    status(code: number) { this.code = code; return this; }
    json(_value: unknown) { return this; }
    setHeader(_name: string, _value: string) {}
    send(_buffer: Buffer) { this.headersSent = true; if (!this.aborted) { delivered++; this.writableFinished = true; this.emit("finish"); } else this.emit("close"); }
  }
  (pool as any).getConnection = async () => {
    let unlock: () => void = () => {};
    return {
      beginTransaction: async () => { const before = tail; tail = new Promise<void>(resolve => { unlock = resolve; }); await before; },
      commit: async () => {}, rollback: async () => {}, release: () => unlock(),
      execute: async (sql: string, params: number[]) => {
        if (sql.startsWith("SELECT")) { queriedActor = params[1]; return [params[1] === 42 ? [{ ...snapshot, employee_downloaded_at: downloaded ? new Date() : null }] : []]; }
        if (sql.startsWith("UPDATE")) { downloaded = true; readState = true; }
        if (sql.includes("INSERT INTO employee_letters")) assert.equal(params[14], null);
        return [{ affectedRows: 1, insertId: 1 }];
      },
    };
  };
  (pool as any).query = async (sql: string, params: unknown[]) => {
    assert.ok(sql.includes("e.id = (SELECT employee_id FROM users WHERE id = ?)")); assert.equal(params[0], 42);
    assert.ok(!sql.includes("employee_downloaded_at")); readState = true; return [{ affectedRows: 1 }];
  };
  const req = { user: { id: 42, mode: "employee", role: "employee" }, params: { id: "1" }, body: { ids: [1] } };
  try {
    await read(req, new Response(), next); assert.ok(readState); assert.equal(downloaded, false);
    let res = new Response(); await pdf({ ...req, user: { ...req.user, id: 99 } }, res, next); assert.equal(res.code, 404); assert.equal(queriedActor, 99);
    res = new Response(); res.aborted = true; await pdf(req, res, next); assert.equal(downloaded, false);
    const first = new Response(), second = new Response();
    await Promise.all([pdf(req, first, next), pdf(req, second, next)]);
    assert.equal(delivered, 1); assert.equal(first.code, 200); assert.equal(second.code, 409); assert.ok(downloaded);
    res = new Response(); await pdf(req, res, next); assert.equal(res.code, 409);
    res = new Response(); mode({ user: { mode: "admin" } }, res, () => { throw new Error("Admin used employee endpoint"); }); assert.equal(res.code, 403);
    res = new Response(); mode({ user: { mode: "client" } }, res, () => { throw new Error("Client used employee endpoint"); }); assert.equal(res.code, 403);
    (pool as any).execute = async (sql: string) => {
      if (sql.includes("issuance_key")) return [[]];
      if (sql.includes("SELECT e.id")) return [[{ id: 1, employee_code: "CHANGED", full_name: "Changed Profile", designation: "Changed Designation", assigned_project: null, email: "test@example.com" }]];
      return [[snapshot]];
    };
    const admin = handler("/:id/pdf", "get");
    await admin({ params: { id: "1" } }, new Response(), next);
    await admin({ params: { id: "1" } }, new Response(), next);
    let emailed = false;
    (gmail as any).sendEmail = async (_slot: unknown, _to: unknown, _subject: unknown, _message: unknown, attachment: { buffer: Buffer }) => { assert.ok(attachment.buffer.subarray(0, 5).toString() === "%PDF-"); emailed = true; };
    const input = { employee_id: 1, letter_type: "hiring", issue_date: "2026-10-06", effective_date: "2026-10-10", subject: "Issued subject", body: "Body", senderAccount: "primary", letter_id: 1 };
    res = new Response(); await handler("/send-email", "post")({ body: input }, res); assert.ok(emailed); assert.equal(res.code, 200);
    res = new Response(); await handler("/", "post")({ user: { id: 7 }, body: { ...input, issuance_key: "a1111111-1111-4111-8111-111111111111" } }, res, next); assert.equal(res.code, 201);
    assert.deepEqual(fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [], before);
    console.log("PASS: in-memory issuance/employee/Admin/email paths create no PDF files; ownership, read/download separation, aborted retry, concurrent/repeated download denial and Admin repeat access retained.");
  } finally { await pool.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
