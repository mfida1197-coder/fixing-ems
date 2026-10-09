// Isolated route tests: all database, auth, encryption and audit imports are mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const crypto = require("node:crypto");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};
const backend = require("../src/finance/salary.ts");
const frontend = require("../../frontend-app/src/lib/salary.ts");
const calls = [];
let record;
let linkedUsers = [];
let snapshot;
const transactions = [];
const key = Buffer.alloc(32, 7); // Synthetic test-only key, never loads .env.
const encryption = {
  encrypt(text) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  },
  decrypt(data) {
    const cipher = crypto.createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8");
  },
};
async function execute(sql, values = []) {
  calls.push({ sql, values });
  if (sql.includes("WHERE e.id = (SELECT employee_id FROM users WHERE id = ?)")) {
    return [linkedUsers.some(user => user.id === values[0]) && record ? [record] : []];
  }
  if (sql.startsWith("SELECT id FROM users WHERE employee_id")) return [linkedUsers.filter(user => user.employee_id === Number(values[0]))];
  if (sql.startsWith("SELECT * FROM employees")) return [record ? [record] : []];
  if (sql.includes("FROM employees WHERE user_id")) return [record?.otherLegacyClaim ? [{ id: 2 }] : []];
  if (sql.includes("r.name AS current_role")) return [linkedUsers.map(user => ({ id: record?.id ?? 1, linked_user_id: user.id, current_role: user.role ?? "employee" }))];
  if (sql.includes("FROM roles")) return [[{ id: sql.includes("'admin'") ? 2 : 3 }]];
  if (sql.startsWith("SELECT id, full_name FROM employees")) return [record ? [record] : []];
  if (sql.includes("AS attendance_count")) return [[record?.history ?? { attendance_count: 0, leave_count: 0, letter_count: 0, application_count: 0 }]];
  if (sql.startsWith("UPDATE employees SET") && sql.includes(" WHERE id = ?")) {
    const columns = sql.split("SET ")[1].split(" WHERE")[0].split(", ");
    columns.forEach((column, index) => { record[column.split(" =")[0]] = values[index]; });
    return [{ affectedRows: 1 }];
  }
  if (sql.includes("WHERE e.id = ? LIMIT 1")) return [[record]];
  if (sql.startsWith("UPDATE users")) {
    const field = sql.split("SET ")[1].split(" =")[0];
    const users = sql.includes("WHERE id = ?")
      ? linkedUsers.filter(user => user.id === values[1] && (values.length < 3 || user.employee_id === Number(values[2])))
      : linkedUsers;
    users.forEach(user => { user[field] = values[0]; });
    return [{ affectedRows: users.length }];
  }
  if (sql.startsWith("INSERT INTO users")) {
    if (record?.failAccountInsert) throw Object.assign(new Error("Synthetic duplicate account"), { code: "ER_DUP_ENTRY" });
    const id = 11;
    linkedUsers.push({ id, role: "employee", full_name: values[1], email: values[2], cnic: values[3], employee_id: Number(values[4]), password_hash: values[5], is_active: true });
    return [{ insertId: id }];
  }
  if (sql.startsWith("INSERT")) return [{ insertId: 1 }];
  return [[]];
}
const connection = {
  execute,
  beginTransaction: async () => { transactions.push("begin"); snapshot = { record: record && { ...record }, users: linkedUsers.map(user => ({ ...user })) }; },
  commit: async () => { transactions.push("commit"); snapshot = null; },
  rollback: async () => { transactions.push("rollback"); if (snapshot) { record = snapshot.record; linkedUsers = snapshot.users; snapshot = null; } },
  release() { transactions.push("release"); },
};
const auth = {
  requireAuth() {}, requireSelectedMode() {}, requireSuperPassword() {},
  requirePermission(permission) {
    assert(["employees:manage", "employee:promote_admin"].includes(permission));
    return function permissionGate() {};
  },
};
const load = Module._load;
Module._load = function (name, parent, main) {
  if (parent?.filename.endsWith(path.join("routes", "employees.ts"))) {
    if (name === "../db") return { pool: { execute, getConnection: async () => connection } };
    if (name === "../crypto") return encryption;
    if (name === "../audit") return { audit: async () => {} };
    if (name === "../middleware/auth") return auth;
    if (name === "bcrypt") return { hash: async () => "mock-hash" };
  }
  // Fail closed if any real database/environment module is unexpectedly imported.
  if (["mysql2", "mysql2/promise", "dotenv"].includes(name)) throw new Error("Live dependency forbidden in isolated tests");
  return load.call(this, name, parent, main);
};
const router = require("../src/routes/employees.ts").default;
Module._load = load;
function route(method, routePath) {
  return router.stack.find(layer => layer.route?.path === routePath && layer.route.methods[method]).route.stack;
}
assert.equal(route("put", "/:id")[0].handle, auth.requireSuperPassword);
assert(router.stack.some(layer => layer.handle === auth.requireAuth));
async function invoke(method, routePath, body, overrides = {}) {
  let status = 200, result;
  const response = { status(code) { status = code; return this; }, json(value) { result = value; return this; } };
  await route(method, routePath).at(-1).handle({ body, params: { id: "1" }, user: { id: 1 }, ip: "test", ...overrides }, response);
  return { status, result };
}
async function main() {
  for (const helper of [backend, frontend]) {
    for (const value of [0, "0", "0.00"]) assert.equal(helper.salaryAmount(value), 0);
    for (const value of [null, undefined, "", " "]) assert.equal(helper.salaryAmount(value), null);
    for (const value of [-1, "-1", NaN, Infinity, "abc", "1.001", "1e2", true, {}, "10000000000"]) {
      assert.throws(() => helper.salaryAmount(value));
    }
    assert.equal(helper.salaryAmount("9999999999.99"), 9999999999.99);
    assert.equal(helper.salaryAmount(".50"), 0.5);
    assert.equal(helper.salaryAmount("1."), 1);
    assert.deepEqual(helper.salaryValues({ basic_salary: 0, allowances: "0", deductions: null }), {
      basic_salary: 0, allowances: 0, deductions: null,
    });
    assert.deepEqual(helper.salaryValues({ full_name: "Test" }), {});
    for (const currency of [null, "", "usd", "USDD", 1]) assert.throws(() => helper.salaryValues({ salary_currency: currency }));
    assert.equal(helper.netSalary("0.10", "0.20", 0), 0.30);
    assert.equal(helper.netSalary(100, 20, 5), 115);
    assert.equal(helper.netSalary(null, null, null), 0);
    assert.equal(helper.netSalary(0, 0, 1), -1);
  }
  for (const body of [
    { bank_name: "Test Wallet" }, { bank_account: "987654321" },
    { bank_name: "Test Wallet", bank_account: "987654321" },
    { designation: "Engineer" }, { bank_name: "", bank_account: null },
  ]) {
    record = { bank_name_enc: encryption.encrypt("Test Bank"), bank_account_enc: encryption.encrypt("123456789"), basic_salary: 0, allowances: 0, deductions: null };
    const previousName = record.bank_name_enc, previousAccount = record.bank_account_enc;
    assert.equal((await invoke("put", "/:id", body)).status, 200);
    const employee = (await invoke("get", "/:id", {})).result.employee;
    assert.equal(employee.bank_name, body.bank_name === undefined ? "Test Bank" : body.bank_name || null);
    assert.equal(employee.bank_account, body.bank_account === undefined ? "123456789" : body.bank_account || null);
    if (body.bank_name === undefined) assert.equal(record.bank_name_enc, previousName);
    if (body.bank_account === undefined) assert.equal(record.bank_account_enc, previousAccount);
    if (record.bank_name_enc) assert(Buffer.isBuffer(record.bank_name_enc));
    if (record.bank_account_enc) assert(Buffer.isBuffer(record.bank_account_enc));
    assert.equal(record.basic_salary, 0);
    assert.equal(record.allowances, 0);
    assert.equal(record.deductions, null);
  }
  record = {};
  assert.equal((await invoke("put", "/:id", { basic_salary: 0, allowances: "0", deductions: "" })).status, 200);
  assert.deepEqual(record, { basic_salary: 0, allowances: 0, deductions: null });
  for (const method of ["post", "put"]) {
    for (const body of [{ basic_salary: -1 }, { allowances: "1.001" }, { deductions: Infinity }, { salary_currency: "bad" }]) {
      const before = calls.length;
      assert.equal((await invoke(method, method === "post" ? "/" : "/:id", body)).status, 400);
      assert.equal(calls.length, before);
    }
  }
  assert.equal((await invoke("post", "/", {
    employee_code: "TEST", full_name: "Test", designation: "Engineer", joining_date: "2020-01-01",
    cnic: "1234512345671", password: "test-only", basic_salary: 0, allowances: "0", deductions: "",
  })).status, 201);
  const inserted = calls.find(call => call.sql.includes("INSERT INTO employees"));
  assert.deepEqual(inserted.values.slice(14, 18), ["PKR", 0, 0, null]);
  console.log("PASS: isolated bank round trips, encryption mapping, salary validation/zero/null/create/edit/net, unchanged permission hooks. No database connection.");
}
module.exports = {
  invoke, calls, transactions,
  state() { return { employee: record, users: linkedUsers }; },
  fixture(employee, users = []) { record = employee; linkedUsers = users.map(user => ({ employee_id: employee?.id ?? 1, ...user })); calls.length = 0; transactions.length = 0; snapshot = null; },
};
if (require.main === module) main().catch(error => { console.error(error.name + ": isolated test failed"); process.exitCode = 1; });
