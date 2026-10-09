import { pool } from "../src/db";

// Schema-only: existing project values and invoice snapshots are not updated.
async function main() {
  if (process.env.DB_NAME !== "ashtech_ems") throw new Error("This migration is authorized only for ashtech_ems");
  const [targetRows] = await pool.query("SELECT DATABASE() AS name");
  if ((targetRows as Array<{name:string}>)[0]?.name !== "ashtech_ems") throw new Error("Actual database target is not ashtech_ems");
  const [rows] = await pool.execute(
    "SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS default_value, EXTRA AS extra, COLUMN_COMMENT AS comment FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='projects' AND column_name='sales_tax_percent'",
  );
  const column = (rows as Array<{ type: string; nullable: string; default_value: unknown; extra: string; comment: string }>)[0];
  if (!column || column.type.toLowerCase() !== "decimal(5,2)" || column.extra) throw new Error("Unexpected project tax column; inspect its definition before migration");
  if (column.nullable !== "YES" || column.default_value !== null) {
    await pool.query(`ALTER TABLE projects MODIFY COLUMN sales_tax_percent DECIMAL(5,2) NULL DEFAULT NULL COMMENT ${pool.escape(column.comment)}`);
  }
  const [verified] = await pool.execute(
    "SELECT IS_NULLABLE AS nullable, COLUMN_DEFAULT AS default_value FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='projects' AND column_name='sales_tax_percent'",
  );
  const result = (verified as Array<{ nullable: string; default_value: unknown }>)[0];
  if (result?.nullable !== "YES" || result.default_value !== null) throw new Error("Optional project tax schema verification failed");
  console.log("Project tax now supports NULL; existing tax values and invoices retained.");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Project tax migration failed"); process.exitCode = 1; }).finally(() => pool.end());
