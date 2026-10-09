import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { pool } from "../db";
import { netSalarySql } from "./salary";

function invalid(message: string, statusCode = 400): never { throw Object.assign(new Error(message), { statusCode }); }
export function validatePayrollPeriod(value: unknown): string {
  const period = String(value ?? "");
  if (!/^(20\d{2}|2100)-(0[1-9]|1[0-2])-01$/.test(period)) invalid("Payroll period must be a valid month between 2000 and 2100");
  return period;
}
export async function listPayroll(value: unknown, database: Pool | PoolConnection = pool) {
  const period = validatePayrollPeriod(value);
  const [rows] = await database.execute(`SELECT e.id AS employee_id, e.employee_code, e.full_name, e.designation,
    CASE WHEN p.finance_transaction_id IS NOT NULL THEN p.net_salary ELSE ${netSalarySql("e.")} END AS net_salary,
    CASE WHEN p.finance_transaction_id IS NOT NULL THEN p.salary_currency ELSE e.salary_currency END AS salary_currency,
    CASE WHEN p.finance_transaction_id IS NOT NULL THEN 'paid' ELSE 'pending' END AS status,
    p.finance_transaction_id, CASE WHEN p.finance_transaction_id IS NOT NULL THEN p.paid_at ELSE NULL END AS paid_at,
    ? AS payroll_period
    FROM employees e LEFT JOIN payroll_payments p ON p.employee_id = e.id AND p.payroll_period = ?
    WHERE p.finance_transaction_id IS NOT NULL OR
      (e.status = 'active' AND e.joining_date <= LAST_DAY(?) AND
       (e.basic_salary IS NOT NULL OR e.allowances IS NOT NULL OR e.deductions IS NOT NULL) AND ${netSalarySql("e.")} > 0)
    ORDER BY e.full_name, e.id`, [period, period, period]);
  return rows;
}
export async function lockPayrollEmployee(connection: PoolConnection, employeeId: number, period: string) {
  validatePayrollPeriod(period);
  const [rows] = await connection.execute<PayrollEmployee[]>(`SELECT id, full_name, status, salary_currency, basic_salary, allowances, deductions,
    ${netSalarySql()} AS final_salary, joining_date <= LAST_DAY(?) AS joined
    FROM employees WHERE id = ? FOR UPDATE`, [period, employeeId]);
  const employee = rows[0];
  if (!employee || employee.status !== "active" || !employee.joined || Number(employee.final_salary) <= 0) invalid("Employee is not eligible for this payroll period");
  const [paid] = await connection.execute("SELECT finance_transaction_id FROM payroll_payments WHERE employee_id = ? AND payroll_period = ? FOR UPDATE", [employeeId, period]);
  if ((paid as any[])[0]?.finance_transaction_id) invalid("Employee payroll has already been paid for this month", 409);
  return employee;
}
export interface PayrollEmployee extends RowDataPacket {
  id: number; full_name: string; status: string; salary_currency: string;
  basic_salary: number | null; allowances: number | null; deductions: number | null;
  final_salary: number; joined: number;
}
export async function finalizePayroll(connection: PoolConnection, employee: PayrollEmployee, period: string, transactionId: number) {
  await connection.execute(`INSERT INTO payroll_payments
    (employee_id, payroll_period, basic_salary, allowances, deductions, net_salary, salary_currency, finance_transaction_id, paid_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
    ON DUPLICATE KEY UPDATE basic_salary = VALUES(basic_salary), allowances = VALUES(allowances), deductions = VALUES(deductions),
      net_salary = VALUES(net_salary), salary_currency = VALUES(salary_currency), finance_transaction_id = VALUES(finance_transaction_id), paid_at = UTC_TIMESTAMP()`,
    [employee.id, period, employee.basic_salary, employee.allowances, employee.deductions, employee.final_salary, employee.salary_currency, transactionId]);
}
