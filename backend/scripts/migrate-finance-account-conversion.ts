import { pool } from "../src/db";
async function main() {
  for (const [name, sql] of [["account_applied_amount", "DECIMAL(14,2) NULL"], ["account_applied_currency", "CHAR(3) NULL"], ["account_exchange_rate", "DECIMAL(12,4) NULL"]]) {
    const [rows] = await pool.execute("SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'transactions' AND column_name = ?", [name]);
    if (!(rows as object[]).length) await pool.query(`ALTER TABLE transactions ADD COLUMN ${name} ${sql}`);
  }
  console.log("Account conversion columns ready; no historical rates guessed or transactions rewritten.");
}
main().catch(() => { console.error("Account conversion migration failed"); process.exitCode = 1; }).finally(() => pool.end());
