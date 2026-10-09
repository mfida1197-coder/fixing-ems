import { pool } from "../src/db";
async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS company_email_accounts (
    slot ENUM('primary','secondary') PRIMARY KEY,
    email VARCHAR(254) NULL,
    refresh_token_encrypted BLOB NULL,
    status ENUM('not_connected','connected','reconnect_required') NOT NULL DEFAULT 'not_connected',
    oauth_state_hash CHAR(64) NULL, oauth_verifier_encrypted BLOB NULL,
    oauth_expires_at DATETIME NULL, oauth_user_id INT UNSIGNED NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query("INSERT IGNORE INTO company_email_accounts (slot) VALUES ('primary'),('secondary')");
  await pool.end();
}
main().catch(async () => { console.error("Company email migration failed"); await pool.end(); process.exitCode = 1; });
