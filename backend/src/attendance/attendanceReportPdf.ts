import fs from "fs";
import path from "path";
import { AttendanceReportResult } from "./reportTypes";
import { ATTENDANCE_TIME_ZONE } from "./types";

function duration(seconds: number | null): string {
  if (seconds === null) return "Unverified";
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}
function localTime(value: string | null): string {
  return value ? new Intl.DateTimeFormat("en-PK", { timeZone: ATTENDANCE_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "Open";
}
function date(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(new Date(value + "T00:00:00Z"));
}
function label(value: string | number | null): string { return value === null ? "All" : String(value).replaceAll("_", " "); }

export async function buildAttendanceReportPdf(report: AttendanceReportResult): Promise<Buffer> {
  const maker = require("pdfmake/build/pdfmake");
  maker.vfs = require("pdfmake/build/vfs_fonts").pdfMake.vfs;
  const accent = "#F97316", ink = "#202124", muted = "#68707B", line = "#E5E7EB", soft = "#F5F6F8";
  const width = 515.28;
  const content: any[] = [];
  const logo = [path.join(__dirname, "..", "ashtech-logo.png"), path.join(process.cwd(), "src", "ashtech-logo.png")].find(fs.existsSync);
  content.push({ columns: [
    ...(logo ? [{ image: "data:image/png;base64," + fs.readFileSync(logo).toString("base64"), width: 42 }] : []),
    { stack: [{ text: "Ashtech Digital Solutions", fontSize: 15, bold: true }, { text: "Attendance Report", fontSize: 20, bold: true, margin: [0, 5, 0, 4] }, { text: `${date(report.filters.from)} - ${date(report.filters.to)}`, color: muted, fontSize: 10 }], margin: [logo ? 12 : 0, 0, 0, 0] },
  ], margin: [0, 0, 0, 14] });
  content.push({ columns: [
    { text: "Generated: " + new Intl.DateTimeFormat("en-GB", { timeZone: ATTENDANCE_TIME_ZONE, dateStyle: "medium", timeStyle: "short" }).format(new Date(report.generatedAtUtc)), fontSize: 8, color: muted },
    { text: "Timezone: Asia/Karachi", alignment: "right", fontSize: 8, color: muted },
  ], margin: [0, 0, 0, 16] });
  function title(text: string) { return { text, fontSize: 10, bold: true, color: ink, margin: [0, 0, 0, 8] }; }
  function metrics(items: Array<[string, string | number]>, columns: number, large = false): any {
    const rows = [];
    for (let i = 0; i < items.length; i += columns) rows.push(Array.from({ length: columns }, (_, j) => {
      const item = items[i + j];
      return { stack: item ? [{ text: item[0], fontSize: 7.5, color: muted, margin: [0, 0, 0, 5] }, { text: String(item[1]), fontSize: large ? 17 : 11, bold: true, color: ink }] : [], margin: [8, 9, 8, 9], fillColor: soft, border: [false, false, false, false] };
    }));
    return { table: { widths: Array(columns).fill("*"), body: rows }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 2, paddingBottom: () => 2 } };
  }
  const s = report.summary;
  content.push({ unbreakable: true, stack: [
    title("Applied Filters"),
    { columns: [["Date Range", `${report.filters.from}\n${report.filters.to}`], ["Employee", report.filters.employeeId === null ? "All employees" : report.employeeSections.find(e => e.employeeId === report.filters.employeeId)?.employeeName || String(report.filters.employeeId)], ["Mode", label(report.filters.attendanceMode)], ["Attendance", label(report.filters.attendanceStatus)], ["Employment", label(report.filters.employmentStatus)]].map(([key, value]) => ({ stack: [{ text: key, fontSize: 7, color: muted }, { text: value, fontSize: 8, margin: [0, 4, 0, 0] }] })), columnGap: 12 },
    { ...title("Report Summary"), margin: [0, 18, 0, 6] },
    metrics([["Employees", s.employeesIncluded], ["Employee Days", s.employeeDays], ["Present", s.presentEmployeeDays], ["Absent", s.absentEmployeeDays], ["Leave", s.leaveEmployeeDays], ["Short Leave", s.shortLeaveEmployeeDays], ["Holiday", s.holidayEmployeeDays], ["Incomplete", s.incompleteEmployeeDays]], 4, true),
    { text: `Verified Worked: ${duration(s.totalVerifiedWorkedSeconds)}     Completed Breaks: ${duration(s.totalCompletedBreakSeconds)}\nPending/Current Days: ${s.pendingEmployeeDays}     Future/No-data Days: ${s.futureEmployeeDays}`, color: muted, fontSize: 8, lineHeight: 1.4, margin: [0, 12, 0, 18] },
  ] });
  function table(id: string, employee: string, heading: string, headers: string[], widths: Array<string | number>, rows: any[][], numeric: number[]) {
    const context = [{ text: employee + "  /  " + heading, colSpan: headers.length, fontSize: 9, bold: true, color: ink, margin: [0, 8, 0, 7], border: [false, false, false, false] }, ...Array(headers.length - 1).fill({ text: "" })];
    content.push({ id, margin: [0, 10, 0, 8], table: { headerRows: 2, keepWithHeaderRows: Math.min(2, rows.length), widths, body: [
      context,
      headers.map((text, column) => ({ text, fontSize: 7.5, bold: true, color: muted, fillColor: soft, alignment: numeric.includes(column) ? "right" : "left" })),
      ...rows.map((row, index) => row.map((cell, column) => ({ ...(typeof cell === "object" ? cell : { text: String(cell) }), fontSize: 8, alignment: numeric.includes(column) ? "right" : "left", fillColor: index % 2 ? soft : "#FFFFFF" }))),
    ] }, layout: { hLineWidth: (index: number) => index <= 1 ? 0 : .35, vLineWidth: () => 0, hLineColor: () => line, paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 5, paddingBottom: () => 5 } });
  }
  report.employeeSections.forEach((employee, index) => {
    const summary = employee.summary;
    content.push({ id: "employee-" + index, unbreakable: true, margin: [0, 14, 0, 0], stack: [
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 1.2, lineColor: accent }], margin: [0, 0, 0, 10] },
      { columns: [{ text: employee.employeeName, fontSize: 16, bold: true }, { text: employee.employeeCode, alignment: "right", fontSize: 10, bold: true }], margin: [0, 0, 0, 4] },
      { columns: [{ text: employee.designation, color: muted, fontSize: 9 }, { text: employee.attendanceMode === "gps" ? "GPS / Office" : "Remote", alignment: "right", fontSize: 9, color: muted }], margin: [0, 0, 0, 14] },
      title("Attendance Summary"),
      metrics([["Present", summary.presentEmployeeDays], ["Absent", summary.absentEmployeeDays], ["Leave", summary.leaveEmployeeDays], ["Short Leave", summary.shortLeaveEmployeeDays], ["Holiday", summary.holidayEmployeeDays], ["Incomplete", summary.incompleteEmployeeDays]], 6),
      { ...title("Work Summary"), margin: [0, 12, 0, 6] },
      metrics([["Total Worked", duration(summary.totalVerifiedWorkedSeconds)], ["Weekly Required Hours", employee.weeklyRequiredMinutes === null ? "Not configured" : duration(employee.weeklyRequiredMinutes * 60)], ["Monthly Required Hours", employee.monthlyRequiredMinutes === null ? "Not configured" : duration(employee.monthlyRequiredMinutes * 60)]], 3),
    ] });
    table("daily-" + index, employee.employeeName, "Daily Attendance", ["Date", "Status", "Sessions", "Worked", "Breaks"], [72, "*", 50, 72, 66], employee.days.map(day => [
      date(day.workDate),
      { text: day.attendanceStatusLabel + (day.holidayName ? "\n" + day.holidayName : "") + (day.approvedLeave?.leaveType === "short_hours" ? "\n" + day.approvedLeave.startTime + " - " + day.approvedLeave.endTime : ""), color: day.attendanceStatus === "present" ? "#26754C" : day.attendanceStatus === "absent" || day.attendanceStatus === "incomplete" ? "#9C493B" : ink },
      day.sessionCount, duration(day.verifiedWorkedSeconds), duration(day.completedBreakSeconds),
    ]), [2, 3, 4]);
    const sessions = employee.days.flatMap(day => day.sessions.map(session => [
      date(day.workDate), "#" + session.sessionNumber, session.state,
      localTime(session.checkInAtUtc), localTime(session.checkOutAtUtc), duration(session.verifiedWorkedSeconds),
      session.breaks.map((item, i) => `B${i + 1} ${localTime(item.breakOutAtUtc)} - ${localTime(item.breakInAtUtc)} / ${item.completedBreakSeconds === null ? "Unverified" : duration(item.completedBreakSeconds).replace(/^0h 0?/, "")} (${item.state})`).join("\n") || "None",
    ]));
    if (sessions.length) table("sessions-" + index, employee.employeeName, "Session Details", ["Date", "Session", "State", "Check In", "Check Out", "Worked", "Break Details"], [54, 28, 46, 45, 45, 44, "*"], sessions, [1, 5]);
  });
  const definition = {
    pageSize: "A4", pageMargins: [40, 40, 40, 48], content,
    defaultStyle: { font: "Roboto", fontSize: 9, color: ink },
    footer: (page: number, pages: number) => ({ columns: [{ text: "Ashtech Digital Solutions  /  Attendance Report", color: muted, fontSize: 7 }, { text: `Page ${page} of ${pages}`, color: muted, fontSize: 7, alignment: "right" }], margin: [40, 14, 40, 0] }),
    pageBreakBefore: (node: any) => {
      const top = node.startPosition?.top ?? 0;
      if (node.id?.startsWith("employee-")) return top > 490;
      if (node.id?.startsWith("daily-") || node.id?.startsWith("sessions-")) return top > 841.89 - 48 - 105;
      return false;
    },
  };
  return new Promise((resolve, reject) => {
    try { maker.createPdf(definition).getBuffer((buffer: Uint8Array) => resolve(Buffer.from(buffer))); }
    catch (error) { reject(error); }
  });
}

