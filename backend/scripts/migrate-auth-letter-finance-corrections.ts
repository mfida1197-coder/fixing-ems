import { pool } from "../src/db";

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      employee_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      pending_password_hash VARCHAR(100) NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP NULL,
      reviewed_by INT UNSIGNED NULL,
      rejection_reason VARCHAR(300) NULL,
      CONSTRAINT fk_password_reset_employee
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
      CONSTRAINT fk_password_reset_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_password_reset_reviewer
        FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_password_reset_status_requested (status, requested_at),
      INDEX idx_password_reset_user_status (user_id, status)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS employee_letters (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      employee_id INT UNSIGNED NOT NULL,
      letter_type VARCHAR(40) NOT NULL,
      issue_date DATE NOT NULL,
      effective_date DATE NOT NULL,
      subject VARCHAR(200) NOT NULL,
      body_text TEXT NOT NULL,
      new_designation VARCHAR(100) NULL,
      notes VARCHAR(500) NULL,
      employee_name_snapshot VARCHAR(100) NOT NULL,
      employee_code_snapshot VARCHAR(20) NOT NULL,
      designation_snapshot VARCHAR(80) NOT NULL,
      project_snapshot VARCHAR(150) NULL,
      file_name VARCHAR(180) NOT NULL,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_employee_letters_employee
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
      CONSTRAINT fk_employee_letters_creator
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_employee_letters_employee_created (employee_id, created_at),
      INDEX idx_employee_letters_type_issue (letter_type, issue_date)
    ) ENGINE=InnoDB
  `);

  console.log("Auth/letter/finance correction migration completed.");
  await pool.end();
}

migrate().catch(async (error) => {
  console.error("Migration failed:", error);
  await pool.end();
  process.exit(1);
});
