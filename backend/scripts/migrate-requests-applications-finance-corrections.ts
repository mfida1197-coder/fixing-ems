import { RowDataPacket } from "mysql2/promise";
import { pool } from "../src/db";

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column],
  );
  return rows.length > 0;
}

async function transactionCount(): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM transactions");
  return Number(rows[0]?.total ?? 0);
}

async function run() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS general_applications (
       id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
       employee_id INT UNSIGNED NOT NULL,
       submitted_by INT UNSIGNED NOT NULL,
       category VARCHAR(100) NOT NULL,
       subject VARCHAR(200) NOT NULL,
       application_date DATE NOT NULL,
       body_text TEXT NOT NULL,
       status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
       submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       reviewed_at TIMESTAMP NULL,
       reviewed_by INT UNSIGNED NULL,
       review_note VARCHAR(500) NULL,
       employee_name_snapshot VARCHAR(150) NOT NULL,
       employee_code_snapshot VARCHAR(50) NOT NULL,
       designation_snapshot VARCHAR(100) NOT NULL,
       CONSTRAINT fk_general_applications_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
       CONSTRAINT fk_general_applications_submitter FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE RESTRICT,
       CONSTRAINT fk_general_applications_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
       INDEX idx_general_applications_employee (employee_id, submitted_at),
       INDEX idx_general_applications_status (status, submitted_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );

  if (!(await columnExists("transactions", "invoice_tax_applied"))) {
    await pool.query(
      "ALTER TABLE transactions ADD COLUMN invoice_tax_applied TINYINT(1) NULL AFTER invoice_tax_rate",
    );
  }
  await pool.query(
    `UPDATE transactions
     SET invoice_tax_applied = CASE WHEN COALESCE(invoice_tax_rate, 0) > 0 THEN 1 ELSE 0 END
     WHERE invoice_number IS NOT NULL AND invoice_tax_applied IS NULL`,
  );

  const rowsBefore = await transactionCount();
  if (await columnExists("transactions", "transaction_number")) {
    const [foreignKeys] = await pool.execute<RowDataPacket[]>(
      `SELECT CONSTRAINT_NAME AS constraint_name FROM information_schema.key_column_usage
       WHERE table_schema = DATABASE() AND table_name = 'transactions'
         AND column_name = 'transaction_number' AND referenced_table_name IS NOT NULL`,
    );
    if (foreignKeys.length) {
      throw new Error("Cannot remove obsolete transaction number because a foreign-key dependency still exists");
    }
    const [indexes] = await pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT INDEX_NAME AS index_name FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'transactions'
         AND column_name = 'transaction_number' AND index_name <> 'PRIMARY'`,
    );
    for (const row of indexes) {
      const indexName = String(row.index_name);
      if (!/^[A-Za-z0-9_$]+$/.test(indexName)) throw new Error("Unexpected transaction-number index name");
      await pool.query(`ALTER TABLE transactions DROP INDEX \`${indexName}\``);
    }
    await pool.query("ALTER TABLE transactions DROP COLUMN transaction_number");
  }
  const rowsAfter = await transactionCount();
  if (rowsAfter !== rowsBefore) throw new Error("Transaction row count changed during identifier removal");

  console.log("Requests/applications/finance correction migration completed.");
  console.log(`Verified ${rowsAfter} historical transaction rows remain intact.`);
}

run()
  .then(async () => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
