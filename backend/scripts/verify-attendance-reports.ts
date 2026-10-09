import fs from "fs";
import path from "path";
import { ResultSetHeader } from "mysql2/promise";
import { addDays } from "../src/attendance/calculations";
import { buildAttendanceReportPdf } from "../src/attendance/attendanceReportPdf";
import { AttendanceReportService } from "../src/attendance/reportService";
import { AttendanceReportFilters } from "../src/attendance/reportTypes";
import { pool } from "../src/db";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`PASS: ${message}`);
}

async function main() {
  const suffix = Date.now();
  const day = 10 + (suffix % 10);
  const workDate = `2097-01-${String(day).padStart(2, "0")}`;
  const holidayDate = addDays(workDate, -1);
  const now = new Date(`${addDays(workDate, 1)}T07:00:00.000Z`);
  const service = new AttendanceReportService(pool, () => new Date(now));
  const employeeIds: number[] = [];
  let holidayId: number | null = null;
  const filters: AttendanceReportFilters = {
    from: holidayDate, to: workDate, employeeId: null,
    attendanceMode: null, attendanceStatus: null, employmentStatus: "active",
  };

  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const [code, name, mode] of [
        ["A", "Phase 9 GPS", "gps"], ["B", "Phase 9 Remote", "remote"],
        ["C", "Phase 9 Absent", "remote"], ["D", "Phase 9 Full Leave", "remote"],
        ["E", "Phase 9 Short Leave", "remote"], ["F", "Phase 9 Incomplete", "remote"],
      ] as const) {
        const [insert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO employees
             (employee_code, full_name, designation, joining_date, employment_type, status)
           VALUES (?, ?, 'Report Verifier', '2096-01-01', 'contract', 'active')`,
          [`P9-${code}-${suffix}`, name],
        );
        employeeIds.push(insert.insertId);
        await connection.execute(
          `INSERT INTO employee_attendance_settings
             (employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes)
           VALUES (?, ?, 0, 0)`,
          [insert.insertId, mode],
        );
      }
      const [gps, remote, , fullLeave, shortLeave, incomplete] = employeeIds;
      const [gpsSession] = await connection.execute<ResultSetHeader>(
        `INSERT INTO attendance_sessions
           (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc, check_out_at_utc)
         VALUES (?, ?, 'Asia/Karachi', 'gps', 'completed', ?, ?)`,
        [gps, workDate, `${workDate} 04:00:00.000`, `${workDate} 12:00:00.000`],
      );
      for (const [outTime, inTime] of [["06:00:00", "06:20:00"], ["08:30:00", "09:00:00"], ["10:45:00", "11:00:00"]]) {
        await connection.execute(
          `INSERT INTO attendance_breaks (attendance_session_id, state, break_out_at_utc, break_in_at_utc)
           VALUES (?, 'completed', ?, ?)`,
          [gpsSession.insertId, `${workDate} ${outTime}.000`, `${workDate} ${inTime}.000`],
        );
      }
      for (const [checkIn, checkOut] of [["04:00:00", "06:30:00"], ["07:15:00", "09:45:00"], ["10:10:00", "12:30:00"]]) {
        await connection.execute(
          `INSERT INTO attendance_sessions
             (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc, check_out_at_utc)
           VALUES (?, ?, 'Asia/Karachi', 'remote', 'completed', ?, ?)`,
          [remote, workDate, `${workDate} ${checkIn}.000`, `${workDate} ${checkOut}.000`],
        );
      }
      await connection.execute(
        `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, status)
         VALUES (?, 'full_day', ?, ?, 'approved')`,
        [fullLeave, workDate, workDate],
      );
      await connection.execute(
        `INSERT INTO leave_requests
           (employee_id, leave_type, start_date, end_date, start_time, end_time, status)
         VALUES (?, 'short_hours', ?, ?, '13:00:00', '15:00:00', 'approved')`,
        [shortLeave, workDate, workDate],
      );
      await connection.execute(
        `INSERT INTO attendance_sessions
           (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc, check_out_at_utc)
         VALUES (?, ?, 'Asia/Karachi', 'remote', 'completed', ?, ?)`,
        [shortLeave, workDate, `${workDate} 04:00:00.000`, `${workDate} 08:00:00.000`],
      );
      await connection.execute(
        `INSERT INTO attendance_sessions
           (employee_id, work_date, timezone_name, attendance_mode, state, check_in_at_utc, incomplete_reason)
         VALUES (?, ?, 'Asia/Karachi', 'remote', 'incomplete', ?, 'Phase 9 fixture')`,
        [incomplete, workDate, `${workDate} 04:30:00.000`],
      );
      const [holiday] = await connection.execute<ResultSetHeader>(
        "INSERT INTO holidays (holiday_date, name) VALUES (?, 'Phase 9 Explicit Holiday')",
        [holidayDate],
      );
      holidayId = holiday.insertId;
      await connection.commit();
    } finally {
      connection.release();
    }

    const report = await service.getCompleteReport(filters);
    const row = (employeeId: number, date = workDate) => report.rows.find((item) => item.employeeId === employeeId && item.workDate === date);
    const [gps, remote, absent, fullLeave, shortLeave, incomplete] = employeeIds;
    const gpsRow = row(gps);
    const remoteRow = row(remote);
    check(gpsRow?.attendanceStatus === "present" && gpsRow.sessionCount === 1, "GPS employee is one present employee-day with one session");
    check(gpsRow.sessions[0].breaks.length === 3 && gpsRow.completedBreakSeconds === 3_900, "GPS report preserves three breaks and 1h 05m break total");
    check(gpsRow.verifiedWorkedSeconds === 24_900, "GPS verified worked duration excludes completed breaks");
    check(remoteRow?.attendanceStatus === "present" && remoteRow.sessionCount === 3, "remote employee is counted once while preserving three sessions");
    check(remoteRow.sessions.length === 3 && remoteRow.verifiedWorkedSeconds === 26_400, "remote report aggregates only three verified sessions and excludes their gaps");
    check(row(absent)?.attendanceStatus === "absent", "missing past attendance is reported as absent");
    check(row(fullLeave)?.attendanceStatus === "leave", "approved full-day leave is reported distinctly");
    check(row(shortLeave)?.attendanceStatus === "short_leave" && row(shortLeave)?.verifiedWorkedSeconds === 14_400, "short leave is distinct and does not change actual worked duration");
    check(row(incomplete)?.attendanceStatus === "incomplete" && row(incomplete)?.sessions[0].verifiedWorkedSeconds === null, "incomplete attendance remains visible without invented worked time");
    check(employeeIds.every((id) => row(id, holidayDate)?.attendanceStatus === "holiday"), "explicitly configured holiday applies without an automatic weekend rule");
    check(report.summary.presentEmployeeDays >= 2, "remote multi-session attendance does not inflate present employee-day totals");

    const remoteOnly = await service.getReport({ ...filters, employeeId: remote }, 1, 25);
    check(remoteOnly.summary.employeesIncluded === 1 && remoteOnly.rows.length === 2, "employee filter returns one canonical EMS employee across the bounded range");
    const incompleteOnly = await service.getReport({ ...filters, attendanceStatus: "incomplete" }, 1, 25);
    check(incompleteOnly.rows.some((item) => item.employeeId === incomplete), "attendance-status filter is server-authoritative");

    const pdf = await buildAttendanceReportPdf(report);
    check(pdf.subarray(0, 4).toString("ascii") === "%PDF" && pdf.length > 5_000, "real attendance PDF buffer is generated with the existing EMS PDF stack");
    const outputDirectory = path.resolve(__dirname, "../tmp/pdfs");
    fs.mkdirSync(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, "phase9-attendance-report-verification.pdf");
    fs.writeFileSync(outputPath, pdf);
    console.log(`PDF_PATH=${outputPath}`);
  } finally {
    if (employeeIds.length) {
      await pool.query(
        `DELETE b FROM attendance_breaks b JOIN attendance_sessions s ON s.id = b.attendance_session_id
         WHERE s.employee_id IN (?)`, [employeeIds],
      );
      await pool.query("DELETE FROM attendance_sessions WHERE employee_id IN (?)", [employeeIds]);
      await pool.query("DELETE FROM leave_requests WHERE employee_id IN (?)", [employeeIds]);
      await pool.query("DELETE FROM employee_attendance_settings WHERE employee_id IN (?)", [employeeIds]);
      await pool.query("DELETE FROM employees WHERE id IN (?)", [employeeIds]);
    }
    if (holidayId !== null) await pool.execute("DELETE FROM holidays WHERE id = ?", [holidayId]);
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

