import { pool } from "../src/db";

const REQUIRED_COLUMNS: Record<string, string[]> = {
  organization_attendance_settings: [
    "id",
    "office_timezone",
    "office_latitude",
    "office_longitude",
    "allowed_radius_meters",
    "updated_by",
    "created_at",
    "updated_at",
  ],
  employee_attendance_settings: [
    "employee_id",
    "attendance_mode",
    "weekly_target_minutes",
    "monthly_target_minutes",
    "updated_by",
    "created_at",
    "updated_at",
  ],
  attendance_sessions: [
    "id",
    "employee_id",
    "work_date",
    "timezone_name",
    "attendance_mode",
    "state",
    "check_in_at_utc",
    "check_out_at_utc",
    "incomplete_reason",
    "created_at",
    "updated_at",
  ],
  attendance_breaks: [
    "id",
    "attendance_session_id",
    "state",
    "break_out_at_utc",
    "break_in_at_utc",
    "incomplete_reason",
    "created_at",
    "updated_at",
  ],
  holidays: [
    "id",
    "holiday_date",
    "name",
    "created_by",
    "updated_by",
    "created_at",
    "updated_at",
  ],
  leave_requests: [
    "id",
    "employee_id",
    "leave_type",
    "start_date",
    "end_date",
    "start_time",
    "end_time",
    "timezone_name",
    "reason",
    "status",
    "requested_by",
    "reviewed_by",
    "reviewed_at",
    "created_at",
    "updated_at",
  ],
};

async function assertTableShape(connection: Awaited<ReturnType<typeof pool.getConnection>>) {
  for (const [table, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
    const [rows] = await connection.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    const actualColumns = new Set((rows as any[]).map((row) => String(row.COLUMN_NAME)));
    const missing = requiredColumns.filter((column) => !actualColumns.has(column));
    if (missing.length > 0) {
      throw new Error(`${table} exists but is missing required columns: ${missing.join(", ")}`);
    }
  }
}

async function main() {
  const connection = await pool.getConnection();
  try {
    console.log("[migrate] Creating normalized attendance foundation...");

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS organization_attendance_settings (
        id                       TINYINT UNSIGNED PRIMARY KEY,
        office_timezone          VARCHAR(64) NOT NULL DEFAULT 'Asia/Karachi',
        office_latitude          DECIMAL(10,7) NULL,
        office_longitude         DECIMAL(10,7) NULL,
        allowed_radius_meters    DECIMAL(10,2) NULL,
        updated_by               INT UNSIGNED NULL,
        created_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        CONSTRAINT fk_org_attendance_updated_by
          FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT chk_org_attendance_singleton CHECK (id = 1),
        CONSTRAINT chk_org_attendance_latitude
          CHECK (office_latitude IS NULL OR office_latitude BETWEEN -90 AND 90),
        CONSTRAINT chk_org_attendance_longitude
          CHECK (office_longitude IS NULL OR office_longitude BETWEEN -180 AND 180),
        CONSTRAINT chk_org_attendance_location_bundle CHECK (
          (office_latitude IS NULL AND office_longitude IS NULL AND allowed_radius_meters IS NULL)
          OR
          (office_latitude IS NOT NULL AND office_longitude IS NOT NULL AND allowed_radius_meters > 0)
        )
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS employee_attendance_settings (
        employee_id              INT UNSIGNED PRIMARY KEY,
        attendance_mode          ENUM('gps','remote') NOT NULL DEFAULT 'remote',
        weekly_target_minutes    INT UNSIGNED NOT NULL DEFAULT 0,
        monthly_target_minutes   INT UNSIGNED NOT NULL DEFAULT 0,
        updated_by               INT UNSIGNED NULL,
        created_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        CONSTRAINT fk_employee_attendance_settings_employee
          FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        CONSTRAINT fk_employee_attendance_settings_updated_by
          FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS attendance_sessions (
        id                       BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        employee_id              INT UNSIGNED NOT NULL,
        work_date                DATE NOT NULL,
        timezone_name            VARCHAR(64) NOT NULL DEFAULT 'Asia/Karachi',
        attendance_mode          ENUM('gps','remote') NOT NULL,
        state                    ENUM('open','completed','incomplete') NOT NULL DEFAULT 'open',
        check_in_at_utc          DATETIME(3) NOT NULL,
        check_out_at_utc         DATETIME(3) NULL,
        incomplete_reason        VARCHAR(255) NULL,
        open_employee_id         INT UNSIGNED
          GENERATED ALWAYS AS (CASE WHEN state = 'open' THEN employee_id ELSE NULL END) STORED,
        created_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        CONSTRAINT fk_attendance_sessions_employee
          FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
        CONSTRAINT chk_attendance_session_checkout_order
          CHECK (check_out_at_utc IS NULL OR check_out_at_utc >= check_in_at_utc),
        CONSTRAINT chk_attendance_session_state CHECK (
          (state = 'completed' AND check_out_at_utc IS NOT NULL)
          OR
          (state IN ('open','incomplete') AND check_out_at_utc IS NULL)
        ),
        INDEX idx_attendance_sessions_employee_date (employee_id, work_date, check_in_at_utc),
        INDEX idx_attendance_sessions_date_state (work_date, state),
        UNIQUE INDEX uq_attendance_one_open_session (open_employee_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS attendance_breaks (
        id                       BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        attendance_session_id    BIGINT UNSIGNED NOT NULL,
        state                    ENUM('open','completed','incomplete') NOT NULL DEFAULT 'open',
        break_out_at_utc         DATETIME(3) NOT NULL,
        break_in_at_utc          DATETIME(3) NULL,
        incomplete_reason        VARCHAR(255) NULL,
        open_session_id          BIGINT UNSIGNED
          GENERATED ALWAYS AS (CASE WHEN state = 'open' THEN attendance_session_id ELSE NULL END) STORED,
        created_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        CONSTRAINT fk_attendance_breaks_session
          FOREIGN KEY (attendance_session_id) REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
        CONSTRAINT chk_attendance_break_order
          CHECK (break_in_at_utc IS NULL OR break_in_at_utc >= break_out_at_utc),
        CONSTRAINT chk_attendance_break_state CHECK (
          (state = 'completed' AND break_in_at_utc IS NOT NULL)
          OR
          (state IN ('open','incomplete') AND break_in_at_utc IS NULL)
        ),
        INDEX idx_attendance_breaks_session_time (attendance_session_id, break_out_at_utc),
        INDEX idx_attendance_breaks_state (state),
        UNIQUE INDEX uq_attendance_one_open_break (open_session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS holidays (
        id                       INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        holiday_date             DATE NOT NULL UNIQUE,
        name                     VARCHAR(120) NOT NULL,
        created_by               INT UNSIGNED NULL,
        updated_by               INT UNSIGNED NULL,
        created_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        CONSTRAINT fk_holidays_created_by
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_holidays_updated_by
          FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT chk_holiday_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
        INDEX idx_holidays_date (holiday_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS leave_requests (
        id                       BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        employee_id              INT UNSIGNED NOT NULL,
        leave_type               ENUM('full_day','short_hours') NOT NULL DEFAULT 'full_day',
        start_date               DATE NOT NULL,
        end_date                 DATE NOT NULL,
        start_time               TIME NULL,
        end_time                 TIME NULL,
        timezone_name            VARCHAR(64) NOT NULL DEFAULT 'Asia/Karachi',
        reason                   TEXT NULL,
        status                   ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
        requested_by             INT UNSIGNED NULL,
        reviewed_by              INT UNSIGNED NULL,
        reviewed_at              DATETIME(3) NULL,
        created_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        CONSTRAINT fk_leave_requests_employee
          FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
        CONSTRAINT fk_leave_requests_requested_by
          FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_leave_requests_reviewed_by
          FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT chk_leave_date_order CHECK (end_date >= start_date),
        CONSTRAINT chk_leave_type_fields CHECK (
          (leave_type = 'full_day' AND start_time IS NULL AND end_time IS NULL)
          OR
          (leave_type = 'short_hours' AND start_date = end_date
            AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
        ),
        INDEX idx_leave_employee_dates (employee_id, start_date, end_date),
        INDEX idx_leave_status_dates (status, start_date, end_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(
      `INSERT IGNORE INTO organization_attendance_settings (id, office_timezone)
       VALUES (1, 'Asia/Karachi')`,
    );

    await connection.execute(
      `INSERT IGNORE INTO employee_attendance_settings (employee_id)
       SELECT id FROM employees`,
    );

    await assertTableShape(connection);
    console.log("[migrate] Attendance foundation migration completed successfully.");
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[migrate] Attendance foundation migration failed:", error);
  process.exitCode = 1;
});
