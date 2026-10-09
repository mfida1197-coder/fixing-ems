import { pool } from "../src/db";

async function main() {
  const [columns] = await pool.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'sales_tax_percent'",
  );
  if (!(columns as object[]).length) {
    await pool.query("ALTER TABLE projects ADD COLUMN sales_tax_percent DECIMAL(5,2) NOT NULL DEFAULT 5.00 AFTER project_value");
  }
  console.log("[migrate] Project billing tax ready.");
  await pool.end();
}

main().catch(async (error) => { console.error(error); await pool.end(); process.exitCode = 1; });
