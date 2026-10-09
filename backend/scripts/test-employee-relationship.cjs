// Isolated relationship checks; reuse the Phase 1 adapter, never load a real DB.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const fixture = require("./test-employee-phase1.cjs");
const { invoke, calls, state, transactions } = fixture;
const employee = { id: 1, full_name: "Synthetic", email: "old@example.test", cnic: "1234512345671" };
const account = { id: 11, password_hash: "old-hash", role: "admin", is_active: false };
const response = () => ({ code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const next = error => { if (error) throw error; };
async function main() {
  fixture.fixture({ ...employee });
  assert.equal((await invoke("put", "/:id", { full_name: "Edited" })).status, 200);
  assert.equal(state().employee.full_name, "Edited"); assert.equal(state().users.length, 0);
  fixture.fixture({ ...employee }, [account]);
  await invoke("put", "/:id", { full_name: "Edited", email: "new@example.test", cnic: employee.cnic });
  assert.equal(state().users[0].full_name, "Edited"); assert.equal(state().users[0].email, "new@example.test");
  assert.equal(state().users[0].cnic, employee.cnic); assert.equal(state().users[0].password_hash, "old-hash");
  fixture.fixture({ ...employee, user_id: null });
  assert.equal((await invoke("put", "/:id", { password: "test", designation: "Engineer" })).status, 200);
  assert.equal(state().users.length, 1); assert.equal(state().users[0].employee_id, employee.id);
  assert.equal(state().users[0].role, "employee"); assert.equal(state().users[0].is_active, true);
  assert.equal(state().users[0].password_hash, "mock-hash");
  assert.deepEqual(transactions, ["begin", "commit", "release"]);
  await invoke("put", "/:id", { password: "replacement" });
  assert.equal(state().users.length, 1);
  fixture.fixture({ ...employee, user_id: 11 }, [account]);
  assert.equal((await invoke("put", "/:id", { password: "replacement" })).status, 200);
  assert.equal(state().users[0].password_hash, "mock-hash");
  assert.equal(state().users[0].role, "admin"); assert.equal(state().users[0].is_active, false);
  for (const [extra, users] of [
    [{ user_id: 11 }, []], [{ user_id: 11 }, [{ ...account, employee_id: 2 }]],
    [{ user_id: 999 }, [account]], [{}, [account, { id: 12 }]],
    [{ user_id: null, otherLegacyClaim: true }, [account]], [{ failAccountInsert: true }, []],
  ]) {
    fixture.fixture({ ...employee, ...extra }, users);
    assert.equal((await invoke("put", "/:id", { password: "test", full_name: "Changed" })).status, 409);
    assert.equal(state().employee.full_name, employee.full_name);
    assert.equal(state().users.length, users.length);
    assert.deepEqual(transactions, ["begin", "rollback", "release"]);
  }
  for (const role of ["employee", "admin"]) {
    fixture.fixture({ ...employee }, [{ ...account, role }]);
    assert.equal((await invoke("post", role === "admin" ? "/:id/demote" : "/:id/promote", {})).status, 200);
    assert.equal(state().users[0].role_id, role === "admin" ? 3 : 2);
  }
  for (const action of ["promote", "demote"]) {
    fixture.fixture({ ...employee }, [account, { id: 12 }]);
    assert.equal((await invoke("post", `/:id/${action}`, {})).status, 409);
  }
  for (const [extra, users] of [[{ history: { attendance_count: 1 } }, [account]], [{}, [{ id: 1 }]], [{}, [account, { id: 12 }]]]) {
    fixture.fixture({ ...employee, ...extra }, users);
    assert.equal((await invoke("delete", "/:id", {})).status, 409);
    assert(!calls.some(call => call.sql.startsWith("DELETE")));
  }
  for (const users of [[], [account]]) {
    fixture.fixture({ ...employee }, users);
    assert.equal((await invoke("delete", "/:id", {})).status, 200);
    const removed = calls.filter(call => call.sql.startsWith("DELETE")).map(call => call.sql.split(" ")[2]);
    assert.deepEqual(removed, users.length ? ["users", "employees"] : ["employees"]);
  }
  fixture.fixture({ ...employee }, [account]);
  assert.equal((await invoke("get", "/me", {}, { user: { id: 11, employee_id: 999 } })).result.employee.id, 1);
  assert.equal((await invoke("get", "/me", {}, { user: { id: 999, employee_id: 1 } })).status, 404);

  // One loader for unchanged login/mode checks and scoped consumer checks.
  let current, payload, queries = [];
  let execute = async sql => sql.startsWith("SELECT") ? [[current]] : [{ affectedRows: 1 }];
  const mocks = {
    "../db": { pool: { execute: (...args) => execute(...args), query: (...args) => execute(...args) } },
    "../audit": { audit: async () => {} }, "../crypto": { decrypt: () => "synthetic" },
    "../security/superPassword": { clearSuperAuthorizations() {}, superAuthorizedUntil() { return null; }, verifySuperPassword: async () => {}, grantSuperAuthorization() {}, SuperPasswordError: class extends Error {} },
    bcrypt: { compare: async () => true },
    jsonwebtoken: { sign(value) { payload = value; return "synthetic-token"; }, verify() { return payload; } },
    "../projects/requirementAttachments": { streamRequirementAttachment() {} },
    "../finance/projectBilling": {}, "../finance/projectPayment": {}, "../projects/requirements": {},
    "../employees/employeeLetterPdf": {}, "../employees/issuedLetterStorage": {}, "../email/gmail": {},
  };
  const loader = Module._load;
  Module._load = function(name, parent, main) {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (["mysql2", "mysql2/promise", "dotenv"].includes(name)) throw new Error("Live dependency forbidden");
    return loader.call(this, name, parent, main);
  };
  try {
    const auth = require("../src/routes/auth.ts").default, middleware = require("../src/middleware/auth.ts");
    const login = auth.stack.find(layer => layer.route?.path === "/login").route.stack.at(-1).handle;
    for (const [role, id, mode] of [["employee", 1, "employee"], ["super_admin", null, "admin"], ["admin", null, "admin"], ["admin", 1, "selection_required"]]) {
      current = { ...employee, id: 11, role, employee_id: id, is_active: true, role_active: true };
      const res = response(); await login({ body: { email: employee.email, password: "test" } }, res);
      assert.equal(res.code, 200); assert.equal(res.body.user.employee_id, id); assert.equal(payload.mode, mode);
      const req = { headers: { authorization: "Bearer synthetic-token" } };
      await middleware.requireAuth(req, response(), next); assert.equal(req.user.employee_id, id); assert.equal(req.user.mode, mode);
    }
    for (const mode of ["employee", "admin"]) {
      payload = { sub: 11, system_role: "admin", mode, mode_selected: true };
      const req = { headers: { authorization: "Bearer synthetic-token" } };
      await middleware.requireAuth(req, response(), next); assert.equal(req.user.mode, mode);
    }
    execute = async (sql, values) => { queries.push({ sql, values }); return sql.startsWith("UPDATE") ? [{ affectedRows: 1 }] : sql.includes("COUNT(*)") ? [[{ count: 0 }]] : [[]]; };
    const projects = require("../src/routes/projects.ts").default, letters = require("../src/routes/employeeLetters.ts").default;
    const notices = require("../src/employees/portalNotifications.ts");
    const assigned = projects.stack.find(layer => Array.isArray(layer.route?.path)).route.stack.at(-1).handle;
    await assigned({ user: { id: 11, mode: "employee" }, params: {} }, response(), next);
    const forbidden = response(); await assigned({ user: { id: 11, mode: "admin" }, params: {} }, forbidden, next); assert.equal(forbidden.code, 403);
    for (const routePath of ["/me", "/me/read"]) {
      await letters.stack.find(layer => layer.route?.path === routePath).route.stack.at(-1).handle({ user: { id: 11 }, body: { ids: [1] } }, response(), next);
    }
    await notices.getPortalNotifications({ user: { id: 11, mode: "employee" }, query: { employee_id: 999 } }, response(), next);
    await notices.readPortalNotification({ user: { id: 11, mode: "employee" }, body: { id: 1, type: "email_sent", employee_id: 999 } }, response(), next);
    assert(queries.every(call => call.sql.includes("SELECT employee_id FROM users WHERE id = ?")));
    assert(queries.every(call => call.values.includes(11) && !call.values.includes(999)));
  } finally { Module._load = loader; }
  for (const file of ["routes/employees.ts", "routes/employeeLetters.ts", "routes/projects.ts", "projects/requirementAttachments.ts", "employees/portalNotifications.ts", "attendance/employeeAdminService.ts"]) {
    const source = fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
    assert(!/\be\.user_id/.test(source)); assert(!source.includes("UPDATE employees SET user_id"));
  }
  const schema = fs.readFileSync(path.join(__dirname, "../../database_schema.sql"), "utf8");
  assert(!/\buser_id\b/.test(schema.split("CREATE TABLE employees (")[1].split("\n);")[0]));
  assert(schema.includes("employee_id          INT UNSIGNED NULL UNIQUE"));
  assert(/FOREIGN KEY \(employee_id\) REFERENCES employees\(id\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/.test(schema));
  console.log("PASS: account assignment/reuse, synchronization, legacy/duplicate conflicts and rollback, deletion order, login/dual mode and canonical consumer scopes. No DB connection.");
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
