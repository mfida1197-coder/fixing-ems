import { PoolConnection } from "mysql2/promise";
import { pool } from "../db";
import { calculateProjectTotals, parseMoneyToMinor, minorToDecimal } from "./invoice";
import { projectAppliedSql } from "./projectPayment";

type Executor = Pick<PoolConnection, "execute">;

export type ProjectBilling = {
  project_value: string;
  sales_tax_percent: string | null;
  tax_amount: string;
  total_payable: string;
  total_paid: string;
  remaining_balance: string;
  value_currency: string;
};

export async function loadProjectBilling(projectId: number, connection?: Executor, lock = false): Promise<ProjectBilling | null> {
  const db = connection ?? pool;
  const [projects] = await db.execute(
    `SELECT project_value, sales_tax_percent, value_currency FROM projects WHERE id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [projectId],
  );
  const project = (projects as Array<{ project_value: string | number | null; sales_tax_percent: string | number | null; value_currency: string }>)[0];
  if (!project || project.project_value == null || Number(project.project_value) <= 0) return null;
  const totals = calculateProjectTotals(project.project_value, project.sales_tax_percent);
  const [paidRows] = await db.execute(
    `SELECT COALESCE(SUM(${projectAppliedSql("?")}), 0) AS total_paid
     FROM transactions t JOIN finance_categories fc ON fc.id = t.category_id
     WHERE t.project_id = ? AND t.type = 'inflow' AND fc.name = 'client_payment'`,
    [project.value_currency, project.value_currency, projectId],
  );
  const paidValue = (paidRows as Array<{ total_paid: string | number }>)[0]?.total_paid ?? 0;
  const paidMinor = Number(paidValue) > 0 ? parseMoneyToMinor(paidValue, "Total paid") : 0n;
  const totalMinor = parseMoneyToMinor(totals.total, "Total payable");
  return {
    project_value: totals.subtotal,
    sales_tax_percent: project.sales_tax_percent == null ? null : totals.taxRate,
    tax_amount: totals.taxAmount,
    total_payable: totals.total,
    total_paid: minorToDecimal(paidMinor),
    remaining_balance: minorToDecimal(totalMinor > paidMinor ? totalMinor - paidMinor : 0n),
    value_currency: project.value_currency,
  };
}
