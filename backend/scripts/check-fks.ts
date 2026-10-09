import { pool } from "../src/db";

(async () => {
  const [r] = await pool.execute("DESCRIBE employee_documents");
  console.log("=== employee_documents ===");
  console.table(r);

  const [fks]: any = await pool.execute(`
    SELECT 
      kcu.TABLE_NAME, kcu.COLUMN_NAME, kcu.CONSTRAINT_NAME,
      kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
      rc.UPDATE_RULE, rc.DELETE_RULE
    FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
      ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
      AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
    WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
      AND kcu.TABLE_NAME IN ('employee_documents','transactions','reveal_attempts','audit_logs')
      AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
  `);
  console.log("=== FK rules on relevant tables ===");
  console.table(fks);

  await pool.end();
})().catch(console.error);
