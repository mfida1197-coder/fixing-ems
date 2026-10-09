import assert from "node:assert/strict";
import { pool } from "../src/db";
import { accountAppliedSql, calculateAccountPayment } from "../src/finance/accountPayment";
import { calculateProjectPayment } from "../src/finance/projectPayment";
import finance from "../src/routes/finance";

async function main() {
  for (const [amount, source, sourceRate, target, targetRate, expected, pkr] of [
    [100000, "PKR", null, "PKR", null, "100000.00", "100000.00"],
    [1000, "USD", 280, "USD", null, "1000.00", "280000.00"],
    [4000000, "PKR", null, "USD", 280, "14285.71", "4000000.00"],
    [4000000, "PKR", null, "CAD", 205, "19512.20", "4000000.00"],
    [1000, "USD", 280, "PKR", null, "280000.00", "280000.00"],
    [1000, "USD", 280, "CAD", 205, "1365.85", "280000.00"],
    [100000, "PKR", null, "AED", "76.25", "1311.48", "100000.00"],
  ] as const) {
    const result = calculateAccountPayment(amount, source, sourceRate, target, targetRate);
    assert.equal(result.amount, expected); assert.equal(result.amountPkr, pkr);
  }
  for (const rate of [undefined, 0, -1, "NaN", "1.00001"]) assert.throws(() => calculateAccountPayment(100, "PKR", 1, "CAD", rate));
  assert.equal(calculateProjectPayment(100000, "PKR", 1, "USD", 280).appliedAmount, "357.14");
  assert.equal(calculateAccountPayment(100000, "PKR", 1, "CAD", 205).amount, "487.80");
  const [frozen] = await pool.query(`SELECT ${accountAppliedSql("'USD'")} AS amount FROM
    (SELECT 4000000 AS amount, 'PKR' AS currency, 4000000 AS amount_pkr,
      14285.71 AS account_applied_amount, 'USD' AS account_applied_currency) t`);
  assert.equal(Number((frozen as any[])[0].amount), 14285.71);
  const [unknown] = await pool.query(`SELECT ${accountAppliedSql("'USD'")} AS amount FROM
    (SELECT 4000000 AS amount, 'PKR' AS currency, 4000000 AS amount_pkr,
      NULL AS account_applied_amount, NULL AS account_applied_currency) t`);
  assert.equal((unknown as any[])[0].amount, null);
  const [balance] = await pool.query(`SELECT 50000 + SUM(CASE WHEN t.type = 'inflow' THEN ${accountAppliedSql("'USD'")} ELSE -${accountAppliedSql("'USD'")} END) AS balance FROM
    (SELECT 'outflow' AS type, 4000000 AS amount, 'PKR' AS currency, 4000000 AS amount_pkr, 14285.71 AS account_applied_amount, 'USD' AS account_applied_currency
     UNION ALL SELECT 'inflow', 1000, 'USD', 280000, 1000, 'USD') t`);
  assert.equal(Number((balance as any[])[0].balance), 36714.29);
  async function get(path: string, id?: number) {
    const router = finance as any;
    const route = router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods.get).route;
    let result: any;
    await route.stack.at(-1).handle({ params: { id } }, { json: (value: unknown) => { result = value; }, status: () => { throw new Error("Unexpected error"); } });
    return result;
  }
  const accounts = await get("/accounts");
  assert.ok(Array.isArray(accounts.accounts));
  const [legacy] = await pool.execute("SELECT id, account_id, amount, currency, exchange_rate, account_applied_amount FROM transactions WHERE invoice_number = ?", ["ASH-PAY-000075"]);
  const old = (legacy as any[])[0];
  if (old) {
    assert.equal(Number(old.amount), 4000000); assert.equal(old.currency, "PKR");
    assert.equal(old.account_applied_amount, null);
    const history = await get("/accounts/:id/history", Number(old.account_id));
    assert.equal(history.account.current_balance, null);
    assert.equal(history.history.find((entry: any) => entry.id === old.id && entry.source === "transaction").account_amount, null);
  }
  console.log("PASS: seven currency cases, validation, frozen SQL values, legacy unknown-rate safety, live read-only balance/history endpoints and independent project conversion. No records modified.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
