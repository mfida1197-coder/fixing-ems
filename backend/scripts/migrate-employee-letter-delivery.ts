import { pool } from "../src/db";
async function main() {
  for (const [name, sql] of [["pdf_path", "VARCHAR(255) NULL"], ["delivered_at", "DATETIME(6) NULL"], ["employee_read_at", "DATETIME(6) NULL"], ["employee_downloaded_at", "DATETIME(6) NULL"], ["issuance_key", "CHAR(36) NULL"]]) {
    const [rows] = await pool.execute("SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'employee_letters' AND column_name = ?", [name]);
    if (!(rows as object[]).length) await pool.query(`ALTER TABLE employee_letters ADD COLUMN ${name} ${sql}`);
  }
  const [indexes] = await pool.execute("SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'employee_letters' AND index_name = 'uq_letter_issuance'");
  if (!(indexes as object[]).length) await pool.query("ALTER TABLE employee_letters ADD UNIQUE KEY uq_letter_issuance (created_by, issuance_key)");
  console.log("Employee letter delivery migration ready; existing letters unchanged.");
}
main().catch(() => { console.error("Employee letter delivery migration failed"); process.exitCode = 1; }).finally(() => pool.end());
