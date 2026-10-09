import { pool } from "../src/db";

async function main() {
  const [rows] = await pool.execute("SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'chat_groups' AND column_name = 'bubble_color'");
  if (!(rows as object[]).length) await pool.query("ALTER TABLE chat_groups ADD COLUMN bubble_color CHAR(7) NOT NULL DEFAULT '#FFAE68' AFTER bubble");
  console.log("[migrate] Chat group bubble colors ready.");
  await pool.end();
}

main().catch(async (error) => { console.error("[migrate] Chat bubble-color migration failed:", error); await pool.end(); process.exitCode = 1; });
