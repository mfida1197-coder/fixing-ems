import assert from "node:assert/strict";
import { pool } from "../src/db";
import employees from "../src/routes/employees";
import projects from "../src/routes/projects";
import finance from "../src/routes/finance";
import { HolidayService } from "../src/leave/holidayService";
import { workDateForInstant } from "../src/attendance/time";

async function run() {
  const originalExecute = pool.execute;
  const originalConnection = pool.getConnection;
  let writes: string[] = [], committed = false, rolledBack = false, failUser = false;
  const connection = {
    beginTransaction: async () => {},
    commit: async () => { committed = true; },
    rollback: async () => { rolledBack = true; writes = []; },
    release: () => {},
    execute: async (sql: string) => {
      if (sql.startsWith("SELECT")) return [[{ id: 3 }]];
      if (failUser && sql.includes("INSERT INTO users")) throw new Error("Injected user insert failure");
      writes.push(sql);
      return [{ insertId: 777 }];
    },
  };
  (pool as any).getConnection = async () => connection;
  (pool as any).execute = async (sql: string) => sql.includes("SELECT start_date")
    ? [[{ start_date: null, end_date: null, expected_handover_date: null }]]
    : sql.startsWith("SELECT") ? [[]] : [{ insertId: 777 }];
  async function call(router: any, path: string, body: object) {
    const route = router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods.post)?.route;
    assert.ok(route);
    let status = 200;
    const response: any = { status: (code: number) => { status = code; return response; }, json: () => response };
    await route.stack.at(-1).handle({ body, user: { id: 1 }, ip: null }, response, (error: unknown) => { if (error) throw error; });
    return status;
  }
  try {
    const body = { employee_code: "TEST", full_name: "Test", designation: "Engineer", joining_date: "2020-01-01", cnic: "1234567890123", password: "test-only" };
    for (const status of ["active", "resigned", "terminated"]) {
      writes = []; committed = false;
      assert.equal(await call(employees, "/", { ...body, status }), 201);
      assert.ok(committed);
      for (const table of ["employees", "users", "employee_attendance_settings", "audit_logs"]) {
        assert.ok(writes.some(sql => sql.includes(`INTO ${table}`)), table);
      }
    }
    assert.equal(await call(employees, "/", { ...body, status: "internee" }), 400);
    failUser = true; rolledBack = false;
    assert.equal(await call(employees, "/", body), 500);
    assert.ok(rolledBack); assert.equal(writes.length, 0);

    assert.equal(await call(projects, "/", { client_id: 1, name: "Future", start_date: "2099-01-01", expected_handover_date: "2099-02-01" }), 201);
    assert.equal(await call(projects, "/", { client_id: 1, name: "Invalid", start_date: "2099-02-01", expected_handover_date: "2099-01-01" }), 400);
    for (const account_type of ["bank", "cash"]) assert.equal(await call(finance, "/accounts", { account_name: "Test", account_type, bank_name: account_type === "bank" ? "Easypaisa" : null }), 201);
    for (const account_type of ["digital", "other"]) assert.equal(await call(finance, "/accounts", { account_name: "Test", account_type }), 400);

    const holidayRow = { id: 777, holiday_date: workDateForInstant(new Date()), name: "Test", created_by: 1, updated_by: 1, created_at: new Date(), updated_at: new Date() };
    const holidayConnection = { ...connection, execute: async (sql: string) => sql.startsWith("SELECT") ? [[holidayRow]] : [{ insertId: 777 }] };
    const service = new HolidayService({ getConnection: async () => holidayConnection } as any);
    await assert.rejects(service.create("2000-01-01", "Past", 1, null), (error: any) => error.code === "HOLIDAY_DATE_PAST");
    await service.create(workDateForInstant(new Date()), "Today", 1, null);
    await service.create("2099-01-01", "Future", 1, null);
    await service.update(777, "2000-01-01", "Historical", 1, null);
    assert.equal(workDateForInstant(new Date("2026-10-06T19:00:00Z")), "2026-10-07");
    console.log("PASS: canonical statuses, atomic writes/rollback, future projects/date ordering, Bank/Cash/custom provider, holiday create-only Karachi cutoff. Mocked writes; no business data changed.");
  } finally {
    pool.execute = originalExecute;
    pool.getConnection = originalConnection;
    await pool.end();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
