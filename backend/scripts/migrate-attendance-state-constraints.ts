import { RowDataPacket } from "mysql2/promise";
import { pool } from "../src/db";

interface CountRow extends RowDataPacket {
  duplicate_count: number;
}

async function columnExists(
  connection: Awaited<ReturnType<typeof pool.getConnection>>,
  table: string,
  column: string,
) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

async function indexExists(
  connection: Awaited<ReturnType<typeof pool.getConnection>>,
  table: string,
  index: string,
) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index],
  );
  return rows.length > 0;
}

async function assertNoDuplicateOpenState(
  connection: Awaited<ReturnType<typeof pool.getConnection>>,
) {
  const [sessionRows] = await connection.execute<CountRow[]>(
    `SELECT COUNT(*) AS duplicate_count FROM (
       SELECT employee_id FROM attendance_sessions
       WHERE state = 'open' GROUP BY employee_id HAVING COUNT(*) > 1
     ) duplicates`,
  );
  if (Number(sessionRows[0]?.duplicate_count ?? 0) > 0) {
    throw new Error("Cannot add attendance constraint: employees with multiple open sessions exist");
  }

  const [breakRows] = await connection.execute<CountRow[]>(
    `SELECT COUNT(*) AS duplicate_count FROM (
       SELECT attendance_session_id FROM attendance_breaks
       WHERE state = 'open' GROUP BY attendance_session_id HAVING COUNT(*) > 1
     ) duplicates`,
  );
  if (Number(breakRows[0]?.duplicate_count ?? 0) > 0) {
    throw new Error("Cannot add attendance constraint: sessions with multiple open breaks exist");
  }
}

async function main() {
  const connection = await pool.getConnection();
  try {
    console.log("[migrate] Adding attendance transition concurrency constraints...");
    await assertNoDuplicateOpenState(connection);

    if (!(await columnExists(connection, "attendance_sessions", "open_employee_id"))) {
      await connection.execute(`
        ALTER TABLE attendance_sessions
        ADD COLUMN open_employee_id INT UNSIGNED
          GENERATED ALWAYS AS (CASE WHEN state = 'open' THEN employee_id ELSE NULL END) STORED
      `);
    }
    if (!(await indexExists(connection, "attendance_sessions", "uq_attendance_one_open_session"))) {
      await connection.execute(`
        ALTER TABLE attendance_sessions
        ADD UNIQUE INDEX uq_attendance_one_open_session (open_employee_id)
      `);
    }

    if (!(await columnExists(connection, "attendance_breaks", "open_session_id"))) {
      await connection.execute(`
        ALTER TABLE attendance_breaks
        ADD COLUMN open_session_id BIGINT UNSIGNED
          GENERATED ALWAYS AS (CASE WHEN state = 'open' THEN attendance_session_id ELSE NULL END) STORED
      `);
    }
    if (!(await indexExists(connection, "attendance_breaks", "uq_attendance_one_open_break"))) {
      await connection.execute(`
        ALTER TABLE attendance_breaks
        ADD UNIQUE INDEX uq_attendance_one_open_break (open_session_id)
      `);
    }

    console.log("[migrate] Attendance transition concurrency constraints are ready.");
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[migrate] Attendance constraint migration failed:", error);
  process.exitCode = 1;
});
