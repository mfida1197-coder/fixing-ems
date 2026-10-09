import fs from "fs";
import path from "path";
import { buildEmployeeLetterPdf, EmployeeLetterType } from "./employeeLetterPdf";
const directory = path.resolve(process.cwd(), "uploads", "employee-letters");
function date(value: unknown): string { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10); }
export async function generateIssuedLetterPdf(letter: Record<string, unknown>): Promise<Buffer> {
  const required = ["letter_type", "issue_date", "effective_date", "subject", "body_text", "employee_name_snapshot", "employee_code_snapshot", "designation_snapshot"];
  if (required.some((key) => letter[key] == null || letter[key] === "")) {
    // Read-only compatibility for incomplete legacy snapshots. Never write PDFs.
    if (typeof letter.pdf_path === "string" && letter.pdf_path) return fs.readFileSync(path.join(directory, path.basename(letter.pdf_path)));
    throw new Error("Issued letter data is incomplete");
  }
  return buildEmployeeLetterPdf({
    letterType: String(letter.letter_type) as EmployeeLetterType,
    issueDate: date(letter.issue_date), effectiveDate: date(letter.effective_date),
    subject: String(letter.subject), body: String(letter.body_text),
    employeeName: String(letter.employee_name_snapshot), employeeCode: String(letter.employee_code_snapshot),
    designation: String(letter.designation_snapshot), projectName: letter.project_snapshot ? String(letter.project_snapshot) : null,
    newDesignation: letter.new_designation ? String(letter.new_designation) : null,
    notes: letter.notes ? String(letter.notes) : null,
  });
}
