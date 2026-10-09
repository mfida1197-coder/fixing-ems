import assert from "assert/strict";
import fs from "fs";
import { buildApplicationPdf } from "../src/applications/applicationPdf";
import { buildEmployeeLetterPdf } from "../src/employees/employeeLetterPdf";

async function main() {
  const maker = require("pdfmake/build/pdfmake");
  const original = maker.createPdf;
  let definition: unknown;
  maker.createPdf = (value: unknown) => { definition = value; return original.call(maker, value); };
  const body = Array(12).fill("Margin verification: " + "Long paragraphs must stay inside the document's printable boundaries. ".repeat(8)).join("\n\n");
  const identity = { employeeName: "Test Employee", employeeCode: "CHECK-01", designation: "Software Developer", subject: "PDF printable margin verification", body };
  fs.mkdirSync("tmp/pdfs", { recursive: true });
  try {
    for (const kind of ["application", "letter"]) {
      const buffer = kind === "application" ? await buildApplicationPdf({ ...identity, applicationDate: "2026-10-06", category: "General Request" })
        : await buildEmployeeLetterPdf({ ...identity, letterType: "hiring", issueDate: "2026-10-06", effectiveDate: "2026-10-10", projectName: null, newDesignation: null, notes: null });
      const pages = await new Promise<any[]>(resolve => original.call(maker, definition)._getPages({}, resolve));
      assert.ok(pages.length > 1);
      for (const page of pages) for (const entry of page.items) {
        if (entry.type !== "line" || !entry.item.inlines) continue;
        for (const inline of entry.item.inlines) {
          const start = entry.item.x + inline.x;
          assert.ok(start >= 41.5 && start + inline.width <= 595.28 - 41.5, `${kind}: text outside margins`);
        }
      }
      fs.writeFileSync(`tmp/pdfs/${kind}-margin-check.pdf`, buffer);
      console.log(`PASS ${kind}: ${pages.length} pages, header/body/footer horizontal bounds`);
    }
  } finally { maker.createPdf = original; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
