import { pool } from "../src/db";

async function run() {
  const conn = await pool.getConnection();
  try {
    console.log("[migrate] Starting accounts and NTN migration...");

    // 1. Add ntn to clients table
    const [clientCols] = await conn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'clients'
         AND COLUMN_NAME = 'ntn'`
    );
    if ((clientCols as any[]).length === 0) {
      await conn.query(
        `ALTER TABLE clients
         ADD COLUMN ntn VARCHAR(30) NULL
         AFTER country`
      );
      console.log("[migrate] ✓ Added column: clients.ntn");
    } else {
      console.log("[migrate] ✓ Column already exists: clients.ntn");
    }

    // 2. Create finance_accounts table
    await conn.query(
      `CREATE TABLE IF NOT EXISTS finance_accounts (
         id              INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
         account_name    VARCHAR(100) NOT NULL,
         bank_name       VARCHAR(100) NULL,
         account_number  VARCHAR(50) NULL,
         account_type    ENUM('bank','cash','digital','other') NOT NULL DEFAULT 'bank',
         currency        CHAR(3) NOT NULL DEFAULT 'PKR',
         initial_balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
         status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
         created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
       )`
    );
    console.log("[migrate] ✓ Table verified: finance_accounts");

    // 3. Add account_id to transactions table
    const [txnAccCols] = await conn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'transactions'
         AND COLUMN_NAME = 'account_id'`
    );
    if ((txnAccCols as any[]).length === 0) {
      await conn.query(
        `ALTER TABLE transactions
         ADD COLUMN account_id INT UNSIGNED NULL AFTER payment_method,
         ADD FOREIGN KEY (account_id) REFERENCES finance_accounts(id) ON DELETE SET NULL`
      );
      console.log("[migrate] ✓ Added column and FK: transactions.account_id");
    } else {
      console.log("[migrate] ✓ Column already exists: transactions.account_id");
    }

    // 4. Add bank_name to transactions table (external bank transfer details)
    const [txnBankCols] = await conn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'transactions'
         AND COLUMN_NAME = 'bank_name'`
    );
    if ((txnBankCols as any[]).length === 0) {
      await conn.query(
        `ALTER TABLE transactions
         ADD COLUMN bank_name VARCHAR(100) NULL AFTER account_id`
      );
      console.log("[migrate] ✓ Added column: transactions.bank_name");
    } else {
      console.log("[migrate] ✓ Column already exists: transactions.bank_name");
    }

    // 5. Add account_number to transactions table (external bank transfer details)
    const [txnAccNumCols] = await conn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'transactions'
         AND COLUMN_NAME = 'account_number'`
    );
    if ((txnAccNumCols as any[]).length === 0) {
      await conn.query(
        `ALTER TABLE transactions
         ADD COLUMN account_number VARCHAR(50) NULL AFTER bank_name`
      );
      console.log("[migrate] ✓ Added column: transactions.account_number");
    } else {
      console.log("[migrate] ✓ Column already exists: transactions.account_number");
    }

    console.log("[migrate] Migration completed successfully.");
  } finally {
    conn.release();
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("[migrate] ERROR:", err);
  process.exit(1);
});
