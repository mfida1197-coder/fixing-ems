import { pool } from "../src/db";

const columns = [
  ["custom_category", "VARCHAR(120) NULL AFTER category_id"],
  ["salary_base_amount", "DECIMAL(14,2) NULL AFTER employee_id"],
  ["salary_bonus_amount", "DECIMAL(14,2) NULL AFTER salary_base_amount"],
] as const;

async function main() {
  for (const [name, definition] of columns) {
    const [rows] = await pool.execute(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'transactions' AND column_name = ?`,
      [name],
    );
    if ((rows as object[]).length === 0) {
      await pool.query(`ALTER TABLE transactions ADD COLUMN ${name} ${definition}`);
      console.log(`[migrate] Added transactions.${name}`);
    }
  }
  await pool.end();
}

main().catch(async (error) => {
  console.error("[migrate] Finance transaction details migration failed:", error);
  await pool.end();
  process.exitCode = 1;
});
