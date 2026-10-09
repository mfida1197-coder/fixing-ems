import assert from "assert/strict";
import { pool } from "../src/db";
import { calculateProjectPayment, projectAppliedSql } from "../src/finance/projectPayment";
import { parseMoneyToMinor } from "../src/finance/invoice";
async function main() {
  const a = calculateProjectPayment("250", "USD", "280", "USD", undefined);
  const b = calculateProjectPayment("70000", "PKR", 1, "USD", "280");
  const c = calculateProjectPayment("100", "EUR", "330", "USD", "280");
  assert.equal(a.appliedAmount, "250.00"); assert.equal(b.appliedAmount, "250.00"); assert.equal(c.appliedAmount, "117.86");
  assert.equal(b.amountPkr, "70000.00"); assert.equal(b.projectRateToPkr, "280.0000");
  const excessive = calculateProjectPayment("56000", "PKR", 1, "USD", "280");
  assert.ok(parseMoneyToMinor(excessive.appliedAmount, "Applied") > parseMoneyToMinor("100", "Remaining"));
  assert.throws(() => calculateProjectPayment("70000", "PKR", 1, "USD", undefined));
  assert.throws(() => calculateProjectPayment("100", "XYZ", undefined, "USD", "280"));
  assert.equal(calculateProjectPayment("100", "CAD", "200", "USD", "280").appliedAmount, "71.43");
  assert.equal(calculateProjectPayment("100", "USD", "280", "PKR", undefined).appliedAmount, "28000.00");
  assert.equal(calculateProjectPayment("100", "XYZ", "330", "USD", "280").appliedAmount, "117.86");
  const sql = `SELECT SUM(${projectAppliedSql("'USD'")}) AS paid FROM (
    SELECT 'USD' AS currency, 100 AS amount, NULL AS project_applied_amount, NULL AS project_applied_currency
    UNION ALL SELECT 'PKR', 70000, 250, 'USD'
    UNION ALL SELECT 'EUR', 100, 117.86, 'USD'
    UNION ALL SELECT 'PKR', 999, NULL, NULL
  ) t`;
  const [rows] = await pool.query(sql);
  assert.equal(Number((rows as Array<{ paid: string }>)[0].paid), 467.86);
  const [later] = await pool.query(sql); // No current/configured exchange rate participates in billing.
  assert.equal(Number((later as Array<{ paid: string }>)[0].paid), 467.86);
  assert.equal(b.appliedAmount, "250.00");
  console.log("PASS A-F: same/cross currency, rounding, project-currency overpayment comparison, frozen history, legacy fallback; PKR/CAD/custom rates and SQL aggregation verified.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
