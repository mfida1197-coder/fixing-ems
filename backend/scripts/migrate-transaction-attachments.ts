import { pool } from "../src/db";

async function main() {
  const [cols] = await pool.execute(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions'
  `);
  const colNames = (cols as any[]).map((c) => c.COLUMN_NAME.toLowerCase());

  if (!colNames.includes("attachment_path")) {
    console.log("Adding attachment columns to transactions table...");
    await pool.execute(`
      ALTER TABLE transactions
        ADD COLUMN attachment_path VARCHAR(255) NULL AFTER employee_id,
        ADD COLUMN attachment_name VARCHAR(255) NULL AFTER attachment_path,
        ADD COLUMN attachment_mime VARCHAR(100) NULL AFTER attachment_name,
        ADD COLUMN attachment_size INT UNSIGNED NULL AFTER attachment_mime
    `);
    console.log("Attachment columns added successfully.");
  } else {
    console.log("Attachment columns already exist.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
