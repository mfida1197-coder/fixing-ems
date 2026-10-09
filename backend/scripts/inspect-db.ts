import { pool } from "../src/db";

async function main() {
  const [fks] = await pool.execute(`
    SELECT 
      TABLE_NAME, 
      COLUMN_NAME, 
      CONSTRAINT_NAME, 
      REFERENCED_TABLE_NAME, 
      REFERENCED_COLUMN_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
  `);
  console.log("=== FOREIGN KEYS ===");
  console.table(fks);

  const [auditCols] = await pool.execute(`DESCRIBE audit_logs`);
  console.log("=== AUDIT_LOGS COLUMNS ===");
  console.table(auditCols);

  const [userCols] = await pool.execute(`DESCRIBE users`);
  console.log("=== USERS COLUMNS ===");
  console.table(userCols);

  const [empCols] = await pool.execute(`DESCRIBE employees`);
  console.log("=== EMPLOYEES COLUMNS ===");
  console.table(empCols);

  await pool.end();
}

main().catch(console.error);
