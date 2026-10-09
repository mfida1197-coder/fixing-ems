import fs from "fs";
import path from "path";
import { boundedLetterheadBlock } from "./letterheadPdf";

export type EmployeeLetterType = "hiring" | "promotion" | "termination";

export type EmployeeLetterPdfData = {
  letterType: EmployeeLetterType;
  issueDate: string;
  effectiveDate: string;
  subject: string;
  body: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  projectName: string | null;
  newDesignation: string | null;
  notes: string | null;
};

function logoDataUrl(): string | null {
  const candidates = [
    path.join(__dirname, "..", "ashtech-logo-full.png"),
    path.join(__dirname, "..", "ashtech-logo.png"),
    path.join(process.cwd(), "src", "ashtech-logo-full.png"),
    path.join(process.cwd(), "src", "ashtech-logo.png"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return `data:image/png;base64,${fs.readFileSync(candidate).toString("base64")}`;
    }
  }
  return null;
}

function displayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

function typeTitle(value: EmployeeLetterType): string {
  if (value === "hiring") return "Hiring Letter";
  if (value === "promotion") return "Promotion Letter";
  return "Termination Letter";
}

function bodyBlocks(body: string): object[] {
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({
      text: paragraph,
      fontSize: 10.5,
      lineHeight: 1.45,
      color: "#252525",
      alignment: "justify",
      margin: [0, 0, 0, 12],
    }));
}

export async function buildEmployeeLetterPdf(data: EmployeeLetterPdfData): Promise<Buffer> {
  const pdfMake = require("pdfmake/build/pdfmake");
  const pdfFonts = require("pdfmake/build/vfs_fonts");
  pdfMake.vfs = pdfFonts.pdfMake.vfs;

  const orange = "#F97316";
  const dark = "#202124";
  const muted = "#6B7280";
  const logo = logoDataUrl();
  const details: object[] = [
    {
      columns: [
        { text: `Employee ID: ${data.employeeCode}`, fontSize: 9, color: muted },
        { text: `Issue Date: ${displayDate(data.issueDate)}`, fontSize: 9, color: muted, alignment: "right" },
      ],
      margin: [0, 0, 0, 24],
    },
    { text: data.employeeName, fontSize: 11, bold: true, color: dark, margin: [0, 0, 0, 2] },
    { text: data.designation, fontSize: 9, color: muted, margin: [0, 0, 0, 2] },
  ];
  if (data.projectName) details.push({ text: data.projectName, fontSize: 9, color: muted, margin: [0, 0, 0, 18] });
  else details.push({ text: "", margin: [0, 0, 0, 18] });

  const content: object[] = [
    ...details,
    { text: typeTitle(data.letterType).toUpperCase(), fontSize: 14, bold: true, color: dark, alignment: "center", margin: [0, 0, 0, 18] },
    { text: [{ text: "Subject: ", bold: true }, data.subject], fontSize: 10.5, color: dark, margin: [0, 0, 0, 16] },
    { text: `Dear ${data.employeeName},`, fontSize: 10.5, color: dark, margin: [0, 0, 0, 12] },
    ...bodyBlocks(data.body),
  ];

  if (data.letterType === "promotion" && data.newDesignation) {
    content.push({
      text: [{ text: "New designation: ", bold: true }, data.newDesignation],
      fontSize: 10,
      color: dark,
      margin: [0, 2, 0, 5],
    });
  }
  content.push({
    text: [{ text: "Effective date: ", bold: true }, displayDate(data.effectiveDate)],
    fontSize: 10,
    color: dark,
    margin: [0, 0, 0, 12],
  });
  if (data.notes) {
    content.push({ text: [{ text: "Additional note: ", bold: true }, data.notes], fontSize: 9, color: muted, margin: [0, 0, 0, 16] });
  }
  content.push(
    { text: "Sincerely,", fontSize: 10.5, color: dark, margin: [0, 10, 0, 26] },
    { text: "Authorized Signatory", fontSize: 10.5, bold: true, color: dark },
    { text: "Ashtech Digital Solutions", fontSize: 9.5, color: muted, margin: [0, 2, 0, 0] },
  );

  const definition = {
    pageSize: "A4",
    // 76pt is approximately 26.8mm and provides a stable professional body
    // measure on A4 even for long unbroken names, subjects, and paragraphs.
    pageMargins: [76, 112, 76, 70],
    background: (_currentPage: number, pageSize: { width: number; height: number }) => [
      logo
        ? { image: logo, width: 56, absolutePosition: { x: 42, y: 24 } }
        : { text: "ASH", fontSize: 22, bold: true, color: orange, absolutePosition: { x: 42, y: 28 } },
      boundedLetterheadBlock([
          { text: "ASHTECH DIGITAL SOLUTIONS", fontSize: 10, bold: true, color: orange, alignment: "right" },
          { text: "+92 335 3026439", fontSize: 8, color: orange, alignment: "right" },
          { text: "business@ashtechdigitalsolutions.com", fontSize: 8, color: orange, alignment: "right" },
          { text: "www.ashtechdigitalsolutions.com", fontSize: 8, color: orange, alignment: "right" },
        ], 300, pageSize.width - 42 - 300, 25),
      ...(logo
        ? [{
            image: logo,
            width: 285,
            opacity: 0.075,
            absolutePosition: { x: (pageSize.width - 285) / 2, y: (pageSize.height - 255) / 2 },
          }]
        : []),
      boundedLetterheadBlock([{
        text: "© Ashtech Digital Solutions | Reg. No.: Z-25-17581/25 | www.ashtechdigitalsolutions.com",
        fontSize: 8,
        color: orange,
        alignment: "center",
      }], pageSize.width - 42 * 2, 42, pageSize.height - 34),
    ],
    // Explicitly bound every flow element to the same printable width. Keep
    // absolute-positioned letterhead artwork in the background only.
    content: [{ columns: [{ width: 595.28 - 76 * 2, stack: content }], columnGap: 0 }],
    defaultStyle: { font: "Roboto" },
  };

  return new Promise((resolve, reject) => {
    try {
      const pdf = pdfMake.createPdf(definition);
      pdf.getBuffer((buffer: Uint8Array) => resolve(Buffer.from(buffer)));
    } catch (error) {
      reject(error);
    }
  });
}
