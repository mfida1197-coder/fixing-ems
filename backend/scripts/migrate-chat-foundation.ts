import { pool } from "../src/db";

async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_groups (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(120) NOT NULL,
    created_by INT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_chat_group_creator FOREIGN KEY (created_by) REFERENCES users(id),
    INDEX idx_chat_groups_updated (updated_at, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_group_members (
    group_id BIGINT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    added_by INT UNSIGNED NOT NULL,
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_read_message_id BIGINT UNSIGNED NULL,
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT fk_chat_member_group FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_member_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_member_adder FOREIGN KEY (added_by) REFERENCES users(id),
    INDEX idx_chat_members_user (user_id, group_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    group_id BIGINT UNSIGNED NOT NULL,
    sender_user_id INT UNSIGNED NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_chat_message_group FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_message_sender FOREIGN KEY (sender_user_id) REFERENCES users(id),
    INDEX idx_chat_messages_history (group_id, id),
    INDEX idx_chat_messages_sender (sender_user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [fk] = await pool.execute(`SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'chat_group_members' AND constraint_name = 'fk_chat_member_last_read'`);
  if (!(fk as object[]).length) await pool.query("ALTER TABLE chat_group_members ADD CONSTRAINT fk_chat_member_last_read FOREIGN KEY (last_read_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL");
  console.log("[migrate] Chat foundation ready.");
  await pool.end();
}
main().catch(async (error) => { console.error("[migrate] Chat foundation failed:", error); await pool.end(); process.exitCode = 1; });
