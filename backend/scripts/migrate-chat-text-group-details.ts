import { pool } from "../src/db";

async function columnExists(table: string, column: string) {
  const [rows] = await pool.execute(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [table, column],
  );
  return (rows as object[]).length > 0;
}

async function main() {
  if (!(await columnExists("chat_groups", "bubble"))) await pool.query("ALTER TABLE chat_groups ADD COLUMN bubble VARCHAR(3) NULL AFTER name");
  if (!(await columnExists("chat_groups", "description"))) await pool.query("ALTER TABLE chat_groups ADD COLUMN description VARCHAR(500) NULL AFTER bubble");
  if (!(await columnExists("chat_messages", "message_type"))) await pool.query("ALTER TABLE chat_messages ADD COLUMN message_type ENUM('user','system') NOT NULL DEFAULT 'user' AFTER message");
  await pool.query("UPDATE chat_groups SET bubble = UPPER(LEFT(REPLACE(name, ' ', ''), 3)) WHERE bubble IS NULL OR bubble = ''");
  await pool.query("ALTER TABLE chat_groups MODIFY bubble VARCHAR(3) NOT NULL");
  await pool.query("UPDATE chat_messages SET message = 'This message was deleted' WHERE deleted_at IS NOT NULL");
  await pool.query("UPDATE chat_messages SET message = 'This attachment is no longer available', message_type = 'system' WHERE message = '' AND deleted_at IS NULL");
  await pool.query("DROP TABLE IF EXISTS chat_message_attachments");
  console.log("[migrate] Chat is text-only and group details/system messages are ready.");
  await pool.end();
}

main().catch(async (error) => { console.error("[migrate] Chat text/group-details migration failed:", error); await pool.end(); process.exitCode = 1; });
