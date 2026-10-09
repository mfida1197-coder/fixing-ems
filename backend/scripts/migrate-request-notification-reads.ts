import { pool } from "../src/db";

async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS request_notification_reads (
    user_id INT UNSIGNED NOT NULL,
    request_type VARCHAR(32) NOT NULL,
    request_id BIGINT UNSIGNED NOT NULL,
    read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, request_type, request_id),
    CONSTRAINT fk_request_notification_read_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_request_notification_entity (request_type, request_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  console.log("[migrate] Request notification read state ready.");
  await pool.end();
}
main().catch(async (error) => { console.error("[migrate] Request notification read-state failed:", error); await pool.end(); process.exitCode = 1; });
