import assert from "assert/strict";
import { pool } from "../src/db";
import * as gmail from "../src/email/gmail";
import email from "../src/routes/email";
import { getPortalNotifications, readPortalNotification } from "../src/employees/portalNotifications";
async function main() {
  const send = (email as any).stack.find((layer: any) => layer.route?.path === "/send").route.stack.at(-1).handle;
  let sent = false, fail = false, notificationFail = false, inserts = 0;
  let lastParams: unknown[] = [], lastSql = "";
  (gmail as any).sendEmail = async () => { if (fail) throw new Error("Provider failed"); sent = true; };
  (pool as any).execute = async (sql: string, params: unknown[]) => {
    lastSql = sql; lastParams = params;
    if (sql.startsWith("INSERT")) { assert.ok(sent); if (notificationFail) throw new Error("Notification failed"); inserts++; return [{ insertId: inserts }]; }
    if (sql.includes("SELECT email")) return [[{ email: "recipient@example.com" }]];
    if (sql.startsWith("UPDATE")) return [{ affectedRows: 1 }];
    if (sql.includes("COUNT")) return [[{ count: 1 }]];
    if (sql.includes("FROM employee_letters")) return [[{ id: 3, letter_type: "hiring", subject: "Private letter" }]];
    return [[{ id: 1, type: "email_sent", unread: 1 }]];
  };
  const response = () => ({ code: 200, body: null as any, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } });
  const next = (error?: unknown) => { if (error) throw error; };
  for (const kind of ["employee", "client"]) {
    sent = false; const res = response();
    await send({ body: { senderAccount: "primary", recipientType: kind, recipientId: 7, subject: "Test", message: "Not stored in notification" } }, res);
    assert.equal(res.code, 200); assert.deepEqual(lastParams, kind === "employee" ? [7, null] : [null, 7]);
  }
  assert.equal(inserts, 2); fail = true;
  let res = response(); await send({ body: { senderAccount: "primary", recipientType: "employee", recipientId: 7, subject: "Test" } }, res); assert.equal(res.code, 400); assert.equal(inserts, 2);
  fail = false; notificationFail = true; res = response();
  await send({ body: { senderAccount: "primary", recipientType: "client", recipientId: 7, subject: "Test" } }, res); assert.equal(res.code, 200); assert.equal(inserts, 2);
  for (const user of [{ id: 42, role: "employee", mode: "employee" }, { id: 43, role: "client", mode: "client", client_id: 8 }]) {
    res = response(); await (getPortalNotifications as any)({ user, query: { client_id: 999 } }, res, next);
    const notice = res.body.notifications.find((item: any) => item.type === "email_sent");
    assert.equal(notice.title, "Check your email"); assert.equal(notice.message, "Ashtech Digital Solutions has sent you a new email.");
    if (user.mode === "employee") assert.ok(res.body.notifications.some((item: any) => item.type === "official_letter"));
    else { assert.ok(res.body.notifications.every((item: any) => item.type === "email_sent")); assert.equal(lastParams[0], 8); }
    await (readPortalNotification as any)({ user, body: { id: 1, type: "email_sent", client_id: 999 } }, response(), next);
    assert.equal(lastParams[1], user.mode === "employee" ? 42 : 8);
    assert.ok(lastSql.includes(user.mode === "employee" ? "user_id = ?" : "client_id = ? AND employee_id IS NULL"));
  }
  console.log("PASS: employee/client successful-send notices, failed-send exclusion, partial failure success, authenticated recipient scoping and letter coexistence.");
  await pool.end();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
