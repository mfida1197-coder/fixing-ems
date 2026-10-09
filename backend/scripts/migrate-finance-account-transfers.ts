import { pool } from "../src/db";

async function main() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS finance_account_transfers (
      id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      from_account_id INT UNSIGNED NOT NULL,
      to_account_id INT UNSIGNED NOT NULL,
      transfer_date DATE NOT NULL,
      amount DECIMAL(14,2) NOT NULL,
      currency CHAR(3) NOT NULL,
      description VARCHAR(255) NULL,
      created_by INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_finance_transfer_from FOREIGN KEY (from_account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT,
      CONSTRAINT fk_finance_transfer_to FOREIGN KEY (to_account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT,
      CONSTRAINT fk_finance_transfer_created_by FOREIGN KEY (created_by) REFERENCES users(id),
      CONSTRAINT chk_finance_transfer_accounts CHECK (from_account_id <> to_account_id),
      CONSTRAINT chk_finance_transfer_amount CHECK (amount > 0),
      INDEX idx_finance_transfer_from_date (from_account_id, transfer_date),
      INDEX idx_finance_transfer_to_date (to_account_id, transfer_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("[migrate] Finance account transfers ready.");
  await pool.end();
}

main().catch((error) => {
  console.error("[migrate] Finance account transfer migration failed:", error);
  process.exitCode = 1;
});
