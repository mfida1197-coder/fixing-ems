import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PoolConnection } from "mysql2/promise";
import { calculateInvoiceAmounts, calculateProjectTotals } from "../src/finance/invoice";
import { loadProjectBilling } from "../src/finance/projectBilling";

async function main() {
  assert.equal(calculateProjectTotals("100.00", null).total, "100.00");
  assert.equal(calculateProjectTotals("100.00", null).taxApplied, false);
  assert.equal(calculateProjectTotals("100.00", 5).total, "105.00");
  for (const rate of [0, 3, 7, 10, 15, 7.5, 12]) assert.equal(calculateProjectTotals(100, rate).taxRate, rate.toFixed(2));
  const historicalInvoice = calculateInvoiceAmounts(100, 40, 5);
  const snapshot = JSON.stringify(historicalInvoice);
  assert.equal(calculateInvoiceAmounts(100, 40, null).taxAmount, "0.00");
  assert.equal(calculateInvoiceAmounts(100, 40, null).remainingBalance, "60.00");
  assert.equal(JSON.stringify(historicalInvoice), snapshot);

  for (const rate of [null, 5, 7.5, 0]) {
    let calls = 0;
    const mock = { execute: async (sql: string) => {
      calls++;
      assert(sql.trim().startsWith("SELECT"), "Billing must only read existing records");
      return sql.includes("FROM projects")
        ? [[{project_value:"100.00",sales_tax_percent:rate,value_currency:"USD"}], []]
        : [[{total_paid:"40.00"}], []];
    }} as unknown as Pick<PoolConnection,"execute">;
    const billing = await loadProjectBilling(1, mock);
    assert.equal(calls, 2);
    assert.equal(billing?.sales_tax_percent, rate == null ? null : rate.toFixed(2));
    assert.equal(billing?.tax_amount, rate == null ? "0.00" : rate.toFixed(2));
    assert.equal(billing?.remaining_balance, (60 + (rate ?? 0)).toFixed(2));
  }

  // Guard the UI/request contract without opening a browser or a database.
  const ui = readFileSync(join(__dirname,"../../frontend-app/src/pages/Projects.tsx"),"utf8");
  assert(ui.includes('sales_tax_percent: "5"'));
  assert(ui.includes('useState(false)'));
  assert(ui.includes('sales_tax_percent: applyTax ? Number(form.sales_tax_percent) : null'));
  assert(ui.includes('...(taxChanged ? { sales_tax_percent: editApplyTax ? Number(edit.sales_tax_percent) : null } : {})'));
  assert(ui.includes('setEditApplyTax(d.project.sales_tax_percent != null)'));
  assert.equal((ui.match(/Apply Sales Tax/g) ?? []).length,2);
  assert.equal((ui.match(/step="0.01"/g) ?? []).length,2);
  const routes = readFileSync(join(__dirname,"../src/routes/projects.ts"),"utf8");
  assert(routes.includes("sales_tax_percent = null"));
  assert(routes.includes("taxPercent < 0 || taxPercent > 100"));
  assert(routes.includes("COALESCE(p.sales_tax_percent, 0)"));
  const migration = readFileSync(join(__dirname,"migrate-project-optional-tax.ts"),"utf8");
  assert(migration.includes("DECIMAL(5,2) NULL DEFAULT NULL"));
  assert(!/\b(?:UPDATE|DELETE|INSERT|DROP|TRUNCATE)\s+(?:TABLE\s+)?(?:projects|transactions)\b/i.test(migration));
  console.log("Optional project tax checks passed: NULL/5%, legacy rates, billing, new invoice amounts, retained snapshots and UI contract. Mock data only; no database accessed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
