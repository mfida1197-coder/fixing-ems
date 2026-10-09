import assert from "assert/strict";
import fs from "fs";
import { groupReportEmployees } from "../src/attendance/reportService";
import { buildAttendanceReportPdf } from "../src/attendance/attendanceReportPdf";
import { AttendanceReportEmployeeDay, AttendanceReportResult } from "../src/attendance/reportTypes";

async function main() {
  for (const count of [7, 30, 11, 32]) {
    const rows: AttendanceReportEmployeeDay[] = [];
    for (let day = 0; day < count; day++) for (const id of [1, 2]) {
      const workDate = new Date(Date.UTC(2026, 8, 1 + day)).toISOString().slice(0, 10);
      const status = (["present", "absent", "leave", "short_leave", "holiday", "incomplete"] as const)[day % 6];
      rows.push({ employeeId: id, employeeCode: `ASH-00${id}`, employeeName: id === 1 ? "John Example" : "Sarah Example", designation: "Software Developer", employmentStatus: "active", attendanceMode: "remote", workDate,
        attendanceStatus: status, attendanceStatusLabel: status.replace("_", " "), sessionCount: id === 1 && status === "present" ? 2 : 0,
        verifiedWorkedSeconds: id === 1 && status === "present" ? 7200 : 0, completedBreakSeconds: id === 1 && status === "present" ? 1200 : 0, holidayName: null, approvedLeave: null,
        sessions: id === 1 && status === "present" ? [1, 2].map((number) => ({ id: day * 2 + number, sessionNumber: number, attendanceMode: "remote", state: "completed", checkInAtUtc: `${workDate}T04:00:00.000Z`, checkOutAtUtc: `${workDate}T05:10:00.000Z`, verifiedWorkedSeconds: 3600, completedBreakSeconds: 600,
          breaks: [{ id: day * 2 + number, state: "completed", breakOutAtUtc: `${workDate}T04:30:00.000Z`, breakInAtUtc: `${workDate}T04:40:00.000Z`, completedBreakSeconds: 600 }] })) : [] });
    }
    const settings = [{ id: 1, weekly_target_minutes: 2400, monthly_target_minutes: 9600 }, { id: 2, weekly_target_minutes: 1800, monthly_target_minutes: 7200 }];
    const employeeSections = groupReportEmployees(rows, settings);
    assert.equal(employeeSections.length, 2);
    assert.equal(employeeSections[0].weeklyRequiredMinutes, 2400);
    assert.equal(employeeSections[1].monthlyRequiredMinutes, 7200);
    assert.equal(employeeSections[1].summary.totalVerifiedWorkedSeconds, 0);
    assert.equal(employeeSections[0].summary.totalVerifiedWorkedSeconds, rows.filter((row) => row.employeeId === 1).reduce((sum, row) => sum + row.verifiedWorkedSeconds, 0));
    assert.ok(employeeSections.every((section) => section.days.every((day) => day.employeeId === section.employeeId)));
    assert.equal(groupReportEmployees(rows.filter((row) => row.employeeId === 2), settings).length, 1);
    assert.equal(groupReportEmployees(rows, [{ id: 1, weekly_target_minutes: 0, monthly_target_minutes: 0 }])[0].weeklyRequiredMinutes, 0);
    if (count === 32) {
      const summary = { ...employeeSections[0].summary, employeesIncluded: 2, employeeDays: rows.length };
      const report: AttendanceReportResult = { reportTitle: "Attendance Report", timezone: "Asia/Karachi", generatedAtUtc: "2026-10-06T10:00:00.000Z",
        filters: { from: rows[0].workDate, to: rows.at(-1)!.workDate, employeeId: null, attendanceMode: null, attendanceStatus: null, employmentStatus: "active" }, summary,
        pagination: { page: 1, pageSize: 25, totalRows: rows.length, totalPages: 1 }, rows, employeeSections };
      const buffer = await buildAttendanceReportPdf(report);
      assert.ok(buffer.subarray(0, 5).toString() === "%PDF-");
      fs.mkdirSync("tmp/pdfs", { recursive: true }); fs.writeFileSync("tmp/pdfs/attendance-grouping-check.pdf", buffer);
    }
  }
  console.log("PASS: all/single employee, weekly/monthly/custom grouping, zero work/targets, multiple sessions/statuses, employee-specific targets, totals and multipage PDF generation.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
