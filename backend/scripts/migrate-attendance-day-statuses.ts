import { pool } from "../src/db";
import { finalizeAttendanceStatusRange } from "../src/attendance/finalization";
import { addDays } from "../src/attendance/calculations";
import { ATTENDANCE_TIME_ZONE } from "../src/attendance/types";
import { workDateForInstant } from "../src/attendance/time";

async function main() {
  const connection = await pool.getConnection();
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS attendance_day_statuses (
        employee_id INT UNSIGNED NOT NULL,
        work_date DATE NOT NULL,
        status ENUM('absent','present','leave','short_leave','holiday') NOT NULL,
        finalized_at_utc DATETIME(3) NOT NULL,
        PRIMARY KEY (employee_id, work_date),
        CONSTRAINT fk_attendance_day_statuses_employee
          FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
        INDEX idx_attendance_day_statuses_date_status (work_date, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    const [rows] = await connection.execute<any[]>(
      "SELECT DATE_FORMAT(MIN(joining_date), '%Y-%m-%d') AS earliest_date FROM employees",
    );
    const earliest = rows[0]?.earliest_date as string | null;
    if (earliest) {
      const now = new Date();
      const yesterday = addDays(workDateForInstant(now, ATTENDANCE_TIME_ZONE), -1);
      const count = await finalizeAttendanceStatusRange(pool, earliest, yesterday, now);
      console.log(`[migrate] Finalized ${count} attendance day statuses.`);
    }
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[migrate] Attendance day status migration failed:", error);
  process.exitCode = 1;
});
