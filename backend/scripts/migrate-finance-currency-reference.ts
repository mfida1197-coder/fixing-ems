import { pool } from "../src/db";

async function main() {
  for (const [name, definition] of [["currency_name", "VARCHAR(80) NULL"], ["transaction_id", "VARCHAR(120) NULL"]]) {
    const [rows] = await pool.execute(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'transactions' AND column_name = ?", [name],
    );
    if ((rows as object[]).length === 0) {
      await pool.query(`ALTER TABLE transactions ADD COLUMN ${name} ${definition}`);
      console.log(`[migrate] Added transactions.${name}`);
    }
  }
}
main().catch(() => { console.error("Finance currency/reference migration failed"); process.exitCode = 1; }).finally(() => pool.end());
