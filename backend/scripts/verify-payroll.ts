import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { pool } from "../src/db";
import { listPayroll, validatePayrollPeriod, lockPayrollEmployee, finalizePayroll } from "../src/finance/payroll";
import { calculateAccountPayment } from "../src/finance/accountPayment";

async function main() {
  const connection = await pool.getConnection();
  const code = `PAYQA${randomBytes(4).toString("hex")}`;
  const period = "2026-10-01";
  try {
    await connection.beginTransaction();
    const [users] = await connection.query("SELECT id FROM users ORDER BY id LIMIT 1");
    const user = (users as any[])[0]?.id;
    assert.ok(user, "An existing audit identity is required");
    const [categoryRows] = await connection.execute("SELECT id FROM finance_categories WHERE name = 'salary' AND type = 'outflow'");
    const category = (categoryRows as any[])[0].id;
    async function employee(suffix: string, salary: number | null, currency = "PKR", joining = "2026-01-01") {
      const [result] = await connection.execute("INSERT INTO employees (employee_code, full_name, designation, joining_date, status, basic_salary, allowances, deductions, salary_currency) VALUES (?, ?, 'QA', ?, 'active', ?, ?, ?, ?)", [code + suffix, "Payroll test " + suffix, joining, salary, salary === null ? null : 10000, salary === null ? null : 5000, currency]);
      return (result as any).insertId as number;
    }
    const eligible = await employee("A", 75000);
    const unconfigured = await employee("B", null);
    const futureJoin = await employee("C", 75000, "PKR", "2099-01-01");
    const usd = await employee("D", 1000, "USD");
    let rows = await listPayroll(period, connection) as any[];
    assert.equal(rows.find(row => row.employee_id === eligible).net_salary, 80000);
    assert.equal(rows.find(row => row.employee_id === eligible).status, "pending");
    assert.ok(!rows.some(row => [unconfigured, futureJoin].includes(row.employee_id)));
    assert.equal(rows.find(row => row.employee_id === usd).salary_currency, "USD");
    assert.throws(() => validatePayrollPeriod("2026-13-01"));
    await assert.rejects(lockPayrollEmployee(connection, eligible, "2025-12-01"));
    await connection.query("SAVEPOINT before_payment");
    const snapshot = await lockPayrollEmployee(connection, eligible, period);
    async function transaction() {
      const [result] = await connection.execute("INSERT INTO transactions (type, category_id, txn_date, amount, currency, amount_pkr, employee_id, salary_base_amount, salary_bonus_amount, created_by) VALUES ('outflow', ?, '2026-10-07', 80000, 'PKR', 80000, ?, 80000, 0, ?)", [category, eligible, user]);
      return (result as any).insertId as number;
    }
    const failed = await transaction();
    await finalizePayroll(connection, snapshot, period, failed);
    await connection.query("ROLLBACK TO SAVEPOINT before_payment");
    rows = await listPayroll(period, connection) as any[];
    assert.equal(rows.find(row => row.employee_id === eligible).status, "pending", "Failed/cancelled payment stays pending");
    const current = await lockPayrollEmployee(connection, eligible, period);
    const id = await transaction();
    await finalizePayroll(connection, current, period, id);
    rows = await listPayroll(period, connection) as any[];
    assert.equal(rows.find(row => row.employee_id === eligible).finance_transaction_id, id);
    assert.equal(rows.find(row => row.employee_id === eligible).status, "paid");
    await assert.rejects(lockPayrollEmployee(connection, eligible, period), (error: any) => error.statusCode === 409);
    await assert.rejects(connection.execute("INSERT INTO payroll_payments (employee_id, payroll_period, net_salary, salary_currency) VALUES (?, ?, 1, 'PKR')", [eligible, period]), (error: any) => error.code === "ER_DUP_ENTRY");
    await connection.execute("UPDATE employees SET basic_salary = 100000, status = 'resigned' WHERE id = ?", [eligible]);
    rows = await listPayroll(period, connection) as any[];
    assert.equal(rows.find(row => row.employee_id === eligible).net_salary, 80000, "Historical paid salary remains frozen for former employees");
    assert.ok(!(await listPayroll("2026-11-01", connection) as any[]).some(row => row.employee_id === eligible));
    await connection.execute("DELETE FROM transactions WHERE id = ?", [id]);
    await connection.execute("UPDATE employees SET status = 'active' WHERE id = ?", [eligible]);
    rows = await listPayroll(period, connection) as any[];
    assert.equal(rows.find(row => row.employee_id === eligible).status, "pending");
    assert.equal(rows.find(row => row.employee_id === eligible).net_salary, 105000);
    assert.equal(calculateAccountPayment(80000, "PKR", 1, "USD", 280).amount, "285.71");
    assert.equal(calculateAccountPayment(80000, "PKR", 1, "CAD", 205).amount, "390.24");
    console.log("PASS: salary eligibility, periods, pending/paid, rollback, duplicate constraints, snapshots/former employees, deletion-to-pending, independent currencies and existing account conversion. All temporary fixtures rolled back.");
  } finally { await connection.rollback(); connection.release(); await pool.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
