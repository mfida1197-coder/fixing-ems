import { pool } from "../src/db";

type ColumnDefinition = { name: string; sql: string };

const COLUMNS: ColumnDefinition[] = [
  { name: "invoice_number", sql: "VARCHAR(80) NULL AFTER id" },
  { name: "invoice_sequence", sql: "INT UNSIGNED NULL AFTER invoice_number" },
  { name: "invoice_issue_date", sql: "DATE NULL AFTER invoice_sequence" },
  { name: "invoice_currency", sql: "CHAR(3) NULL AFTER invoice_issue_date" },
  { name: "invoice_subtotal", sql: "DECIMAL(16,2) NULL AFTER invoice_currency" },
  { name: "invoice_tax_rate", sql: "DECIMAL(5,2) NULL AFTER invoice_subtotal" },
  { name: "invoice_tax_amount", sql: "DECIMAL(16,2) NULL AFTER invoice_tax_rate" },
  { name: "invoice_total", sql: "DECIMAL(16,2) NULL AFTER invoice_tax_amount" },
];

async function columnExists(name: string): Promise<boolean> {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'transactions' AND column_name = ?`,
    [name],
  );
  return (rows as object[]).length > 0;
}

async function indexExists(name: string): Promise<boolean> {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'transactions' AND index_name = ?`,
    [name],
  );
  return (rows as object[]).length > 0;
}

async function run() {
  for (const column of COLUMNS) {
    if (!(await columnExists(column.name))) {
      await pool.query(`ALTER TABLE transactions ADD COLUMN ${column.name} ${column.sql}`);
      console.log(`[migrate] Added transactions.${column.name}`);
    }
  }

  if (!(await indexExists("uq_transactions_invoice_number"))) {
    await pool.query("ALTER TABLE transactions ADD UNIQUE INDEX uq_transactions_invoice_number (invoice_number)");
    console.log("[migrate] Added unique invoice-number index");
  }

  await pool.query(
    `CREATE TABLE IF NOT EXISTS invoice_sequences (
       client_id INT UNSIGNED NOT NULL,
       project_id INT UNSIGNED NOT NULL,
       last_sequence INT UNSIGNED NOT NULL DEFAULT 0,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       PRIMARY KEY (client_id, project_id),
       CONSTRAINT fk_invoice_sequences_client FOREIGN KEY (client_id) REFERENCES clients(id),
       CONSTRAINT fk_invoice_sequences_project FOREIGN KEY (project_id) REFERENCES projects(id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  console.log("[migrate] Verified invoice_sequences");
}

run()
  .then(async () => {
    await pool.end();
    console.log("[migrate] Finance invoice migration complete");
  })
  .catch(async (error) => {
    console.error("[migrate] Finance invoice migration failed", error);
    await pool.end();
    process.exit(1);
  });
