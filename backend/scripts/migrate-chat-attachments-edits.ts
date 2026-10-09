import { pool } from "../src/db";

async function columnExists(column: string) {
  const [rows] = await pool.execute(`SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'chat_messages' AND column_name = ?`, [column]);
  return (rows as object[]).length > 0;
}

async function main() {
  if (!(await columnExists("edited_at"))) await pool.query("ALTER TABLE chat_messages ADD COLUMN edited_at TIMESTAMP NULL AFTER created_at");
  if (!(await columnExists("deleted_at"))) await pool.query("ALTER TABLE chat_messages ADD COLUMN deleted_at TIMESTAMP NULL AFTER edited_at");
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_message_attachments (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    message_id BIGINT UNSIGNED NOT NULL,
    storage_key VARCHAR(500) NOT NULL UNIQUE,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_chat_attachment_message FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
    INDEX idx_chat_attachments_message (message_id, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  console.log("[migrate] Chat attachments and message edits ready.");
  await pool.end();
}
main().catch(async (error) => { console.error("[migrate] Chat attachment/edit migration failed:", error); await pool.end(); process.exitCode = 1; });
