import { pool } from "../src/db";
async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS payroll_payments (
    id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    employee_id INT UNSIGNED NOT NULL,
    payroll_period DATE NOT NULL,
    basic_salary DECIMAL(14,2) NULL, allowances DECIMAL(14,2) NULL, deductions DECIMAL(14,2) NULL,
    net_salary DECIMAL(14,2) NOT NULL, salary_currency CHAR(3) NOT NULL,
    finance_transaction_id INT UNSIGNED NULL, paid_at DATETIME NULL,
    UNIQUE KEY uq_payroll_employee_period (employee_id, payroll_period),
    UNIQUE KEY uq_payroll_transaction (finance_transaction_id),
    CONSTRAINT fk_payroll_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_transaction FOREIGN KEY (finance_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);
  console.log("Payroll migration complete; existing salary/transaction data unchanged.");
}
main().catch(() => { console.error("Payroll migration failed"); process.exitCode = 1; }).finally(() => pool.end());
