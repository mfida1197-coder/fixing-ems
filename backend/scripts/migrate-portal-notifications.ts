import { pool } from "../src/db";
async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS portal_notifications (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    employee_id INT UNSIGNED NULL, client_id INT UNSIGNED NULL,
    notification_type VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), read_at DATETIME(6) NULL,
    CONSTRAINT fk_portal_notice_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    CONSTRAINT fk_portal_notice_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    CONSTRAINT ck_portal_notice_recipient CHECK ((employee_id IS NOT NULL AND client_id IS NULL) OR (employee_id IS NULL AND client_id IS NOT NULL)),
    INDEX idx_portal_notice_employee (employee_id, read_at, created_at),
    INDEX idx_portal_notice_client (client_id, read_at, created_at)
  ) ENGINE=InnoDB`);
  console.log("Shared portal notifications ready; letter notification data unchanged.");
}
main().catch(() => { console.error("Portal notification migration failed"); process.exitCode = 1; }).finally(() => pool.end());
