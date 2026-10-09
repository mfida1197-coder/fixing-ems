import assert from "assert/strict";
import fs from "fs";
import { Pool } from "mysql2/promise";
import { pool } from "../src/db";
import * as finalization from "../src/attendance/finalization";
import { AttendanceReportService } from "../src/attendance/reportService";
import { buildAttendanceReportPdf } from "../src/attendance/attendanceReportPdf";
import { workDateForInstant } from "../src/attendance/time";

async function main() {
  // Render current report data without triggering the report service's normal
  // finalization writes. The database adapter additionally rejects non-SELECTs.
  (finalization as any).finalizeAttendanceStatusRange = async () => {};
  const readOnly = {
    execute: (sql: string, params: any[]) => { assert.match(sql.trim(), /^SELECT/i); return pool.execute(sql, params); },
    query: (sql: string, params: unknown[]) => { assert.match(sql.trim(), /^SELECT/i); return pool.query(sql, params); },
  } as unknown as Pool;
  const today = workDateForInstant(new Date(), "Asia/Karachi");
  const from = new Date(`${today}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 29);
  const report = await new AttendanceReportService(readOnly).getCompleteReport({ from: from.toISOString().slice(0, 10), to: today, employeeId: null, attendanceMode: null, attendanceStatus: null, employmentStatus: "active" });
  const before = JSON.stringify(report);
  const maker = require("pdfmake/build/pdfmake"), original = maker.createPdf;
  let definition: unknown;
  maker.createPdf = (value: unknown) => { definition = value; return original.call(maker, value); };
  try {
    const pdf = await buildAttendanceReportPdf(report);
    assert.equal(JSON.stringify(report), before);
    const pages = await new Promise<any[]>(resolve => original.call(maker, definition)._getPages({}, resolve));
    for (const page of pages) for (const entry of page.items) if (entry.type === "line") for (const inline of entry.item.inlines ?? []) {
      const x = entry.item.x + inline.x;
      assert.ok(x >= 39.5 && x + inline.width <= 555.78, "Text exceeds printable width");
    }
    fs.mkdirSync("tmp/pdfs", { recursive: true });
    fs.writeFileSync("tmp/pdfs/attendance-current-design.pdf", pdf);
    console.log(`PASS: read-only current report; ${report.employeeSections.length} employees, ${pages.length} pages; unchanged data and safe text bounds.`);
  } finally { maker.createPdf = original; await pool.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
