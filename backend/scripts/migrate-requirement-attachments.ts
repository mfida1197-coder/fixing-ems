import { pool } from "../src/db";
async function main() {
  for (const [name, sql] of [["attachment_path", "VARCHAR(255) NULL"], ["attachment_name", "VARCHAR(255) NULL"], ["attachment_mime", "VARCHAR(100) NULL"], ["attachment_size", "INT UNSIGNED NULL"]]) {
    const [rows] = await pool.execute("SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'project_requirements' AND column_name = ?", [name]);
    if (!(rows as object[]).length) await pool.query(`ALTER TABLE project_requirements ADD COLUMN ${name} ${sql}`);
  }
  console.log("Requirement attachment columns ready");
}
main().catch(() => { console.error("Requirement attachment migration failed"); process.exitCode = 1; }).finally(() => pool.end());
