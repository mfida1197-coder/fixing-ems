import { pool } from "../src/db";

async function main() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS system_security_settings (
        id TINYINT UNSIGNED PRIMARY KEY,
        super_password_hash VARCHAR(100) NOT NULL,
        updated_by INT UNSIGNED NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_security_settings_updated_by
          FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS super_password_attempts (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        success BOOLEAN NOT NULL,
        ip_address VARCHAR(45) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_super_password_attempt_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_super_password_user_time (user_id, created_at)
      )
    `);

    const [securityRows] = await connection.execute(
      "SELECT id FROM system_security_settings WHERE id = 1 LIMIT 1",
    );
    if ((securityRows as any[]).length === 0) {
      const [sourceRows] = await connection.execute(
        `SELECT u.id, u.reveal_password_hash
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE r.name = 'super_admin' AND u.is_active = TRUE AND u.reveal_password_hash IS NOT NULL
         ORDER BY u.id ASC
         LIMIT 1`,
      );
      const source = (sourceRows as any[])[0];
      if (!source?.reveal_password_hash) {
        throw new Error("Cannot initialize Super Password: no active Super Admin has a Reveal Password hash");
      }
      await connection.execute(
        `INSERT INTO system_security_settings (id, super_password_hash, updated_by)
         VALUES (1, ?, ?)`,
        [source.reveal_password_hash, source.id],
      );
    }

    await connection.execute("UPDATE roles SET is_active = TRUE WHERE name = 'admin'");

    const [auditColumnRows] = await connection.execute(
      `SELECT COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'action'`,
    );
    const auditType = String((auditColumnRows as any[])[0]?.COLUMN_TYPE ?? "");
    if (!auditType.includes("super_password_verified")) {
      await connection.execute(`
        ALTER TABLE audit_logs
        MODIFY action ENUM(
          'create','update','delete','login','reveal_sensitive','reveal_failed',
          'super_password_verified','super_password_failed'
        ) NOT NULL
      `);
    }

    await connection.commit();
    console.log("Super Password and Admin role migration completed");
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
