import { pool } from "../src/db";

async function columnExists(table: string, column: string) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column],
  );
  return (rows as object[]).length > 0;
}

async function indexExists(table: string, index: string) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [table, index],
  );
  return (rows as object[]).length > 0;
}

async function main() {
  if (!(await columnExists("projects", "expected_handover_date"))) {
    await pool.query("ALTER TABLE projects ADD COLUMN expected_handover_date DATE NULL AFTER end_date");
  }
  if (!(await columnExists("users", "client_id"))) {
    await pool.query("ALTER TABLE users ADD COLUMN client_id INT UNSIGNED NULL AFTER employee_id");
  }
  if (!(await indexExists("users", "uq_users_client_id"))) {
    await pool.query("ALTER TABLE users ADD UNIQUE INDEX uq_users_client_id (client_id)");
  }
  const [fkRows] = await pool.execute(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_schema = DATABASE() AND table_name = 'users' AND constraint_name = 'fk_users_client'`,
  );
  if ((fkRows as object[]).length === 0) {
    await pool.query("ALTER TABLE users ADD CONSTRAINT fk_users_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE");
  }
  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_progress_updates (
       id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
       project_id INT UNSIGNED NOT NULL,
       progress_percent TINYINT UNSIGNED NOT NULL,
       report TEXT NOT NULL,
       created_by INT UNSIGNED NOT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT fk_project_progress_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
       CONSTRAINT fk_project_progress_user FOREIGN KEY (created_by) REFERENCES users(id),
       CONSTRAINT chk_project_progress_percent CHECK (progress_percent BETWEEN 0 AND 100),
       INDEX idx_project_progress_history (project_id, created_at, id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_requirements (
       id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
       project_id INT UNSIGNED NOT NULL,
       client_id INT UNSIGNED NOT NULL,
       current_version INT UNSIGNED NOT NULL DEFAULT 1,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       CONSTRAINT fk_project_requirement_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
       CONSTRAINT fk_project_requirement_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
       INDEX idx_project_requirement_project (project_id, updated_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_requirement_versions (
       id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
       requirement_id BIGINT UNSIGNED NOT NULL,
       version_number INT UNSIGNED NOT NULL,
       content TEXT NOT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT fk_project_requirement_version FOREIGN KEY (requirement_id) REFERENCES project_requirements(id) ON DELETE CASCADE,
       UNIQUE KEY uq_project_requirement_version (requirement_id, version_number)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  await pool.execute("UPDATE roles SET is_active = TRUE WHERE name = 'client'");
  console.log("[migrate] Project progress and client portal schema ready.");
  await pool.end();
}

main().catch(async (error) => {
  console.error("[migrate] Project progress/client portal migration failed:", error);
  await pool.end();
  process.exitCode = 1;
});
