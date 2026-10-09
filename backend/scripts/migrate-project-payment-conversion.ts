import { pool } from "../src/db";
async function main() {
  for (const [name, sql] of [["project_applied_amount", "DECIMAL(14,2) NULL"], ["project_applied_currency", "CHAR(3) NULL"], ["project_exchange_rate", "DECIMAL(12,4) NULL"]]) {
    const [rows] = await pool.execute("SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'transactions' AND column_name = ?", [name]);
    if (!(rows as object[]).length) await pool.query(`ALTER TABLE transactions ADD COLUMN ${name} ${sql}`);
  }
  console.log("Project payment conversion columns ready; legacy values unchanged.");
}
main().catch(() => { console.error("Project payment conversion migration failed"); process.exitCode = 1; }).finally(() => pool.end());
