import fs from "fs";
import path from "path";
import { boundedLetterheadBlock } from "../employees/letterheadPdf";

export type ApplicationPdfData = {
  applicationDate: string;
  category: string;
  subject: string;
  body: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  submittedAt?: string | null;
  status?: string | null;
};

function logoDataUrl(): string | null {
  const candidates = [
    path.join(__dirname, "..", "ashtech-logo-full.png"),
    path.join(__dirname, "..", "ashtech-logo.png"),
    path.join(process.cwd(), "src", "ashtech-logo-full.png"),
    path.join(process.cwd(), "src", "ashtech-logo.png"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return `data:image/png;base64,${fs.readFileSync(candidate).toString("base64")}`;
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

function paragraphs(body: string): object[] {
  return body
    .split(/\n\s*\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((text) => ({
      text,
      fontSize: 10.5,
      lineHeight: 1.45,
      color: "#252525",
      alignment: "justify",
      margin: [0, 0, 0, 12],
    }));
}

export async function buildApplicationPdf(data: ApplicationPdfData): Promise<Buffer> {
  const pdfMake = require("pdfmake/build/pdfmake");
  const pdfFonts = require("pdfmake/build/vfs_fonts");
  pdfMake.vfs = pdfFonts.pdfMake.vfs;

  const orange = "#F97316";
  const dark = "#202124";
  const muted = "#6B7280";
  const logo = logoDataUrl();
  const content: object[] = [
    {
      columns: [
        { text: `Employee ID: ${data.employeeCode}`, fontSize: 9, color: muted },
        { text: `Date: ${displayDate(data.applicationDate)}`, fontSize: 9, color: muted, alignment: "right" },
      ],
      margin: [0, 0, 0, 22],
    },
    { text: "APPLICATION", fontSize: 14, bold: true, color: dark, alignment: "center", margin: [0, 0, 0, 18] },
    { text: "To,", fontSize: 10.5, color: dark },
    { text: "Management", fontSize: 10.5, bold: true, color: dark },
    { text: "Ashtech Digital Solutions", fontSize: 10.5, color: dark, margin: [0, 0, 0, 16] },
    { text: [{ text: "Application type: ", bold: true }, data.category], fontSize: 10, color: dark, margin: [0, 0, 0, 7] },
    { text: [{ text: "Subject: ", bold: true }, data.subject], fontSize: 10.5, color: dark, margin: [0, 0, 0, 16] },
    { text: "Respected Sir/Madam,", fontSize: 10.5, color: dark, margin: [0, 0, 0, 12] },
    ...paragraphs(data.body),
    { text: "Sincerely,", fontSize: 10.5, color: dark, margin: [0, 10, 0, 22] },
    { text: data.employeeName, fontSize: 10.5, bold: true, color: dark },
    { text: `${data.employeeCode} · ${data.designation}`, fontSize: 9.5, color: muted, margin: [0, 2, 0, 0] },
    ...(data.submittedAt
      ? [{ text: `Submitted: ${new Date(data.submittedAt).toLocaleString("en-PK", { timeZone: "Asia/Karachi" })}${data.status ? ` · Status: ${data.status}` : ""}`, fontSize: 8.5, color: muted, margin: [0, 10, 0, 0] }]
      : []),
  ];

  const definition = {
    pageSize: "A4",
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
        ? [{ image: logo, width: 285, opacity: 0.075, absolutePosition: { x: (pageSize.width - 285) / 2, y: (pageSize.height - 255) / 2 } }]
        : []),
      boundedLetterheadBlock([{
        text: "© Ashtech Digital Solutions | Reg. No.: Z-25-17581/25 | www.ashtechdigitalsolutions.com",
        fontSize: 8,
        color: orange,
        alignment: "center",
      }], pageSize.width - 42 * 2, 42, pageSize.height - 34),
    ],
    content: [{ columns: [{ width: 595.28 - 76 * 2, stack: content }], columnGap: 0 }],
    defaultStyle: { font: "Roboto" },
  };

  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(definition).getBuffer((buffer: Uint8Array) => resolve(Buffer.from(buffer)));
    } catch (error) {
      reject(error);
    }
  });
}
