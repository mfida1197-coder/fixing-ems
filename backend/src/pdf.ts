import fs from "fs";
import path from "path";

const logoPath = path.join(__dirname, "ashtech-logo.png");

function getLogoBase64(): string | null {
  try {
    if (fs.existsSync(logoPath)) {
      return fs.readFileSync(logoPath).toString("base64");
    }
  } catch {}
  return null;
}

export interface PdfTable {
  sectionHeading?: string;
  keepTogether?: boolean;
  title?: string;
  headers: string[];
  rows: string[][];
  widths: (string | number)[];
}

export async function buildPdf(
  docTitle: string,
  subtitle: string,
  tables: PdfTable[]
): Promise<Buffer> {
  const pdfMake = require("pdfmake/build/pdfmake");
  const pdfFonts = require("pdfmake/build/vfs_fonts");
  pdfMake.vfs = pdfFonts.pdfMake.vfs;

  const orange = "#F97316";
  const orangeBg = "#FFF7ED";
  const gray = "#6b6b6b";
  const dark = "#1a1a1a";
  const logoBase64 = getLogoBase64();

  const content: any[] = [];

  if (logoBase64) {
    content.push({
      columns: [
        { image: `data:image/png;base64,${logoBase64}`, width: 45 },
        {
          stack: [
            { text: "Ashtech Digital Solutions", fontSize: 16, bold: true, color: dark },
            { text: "www.ashtechdigitalsolutions.com", fontSize: 8, color: gray },
          ],
          margin: [10, 5, 0, 0],
        },
      ],
      margin: [0, 0, 0, 8],
    });
  } else {
    content.push({ text: "Ashtech Digital Solutions", fontSize: 16, bold: true, color: dark });
    content.push({ text: "www.ashtechdigitalsolutions.com", fontSize: 8, color: gray, margin: [0, 2, 0, 8] });
  }

  content.push({
    canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.5, lineColor: orange }],
    margin: [0, 0, 0, 10],
  });

  content.push({ text: docTitle, fontSize: 14, bold: true, color: dark, margin: [0, 0, 0, 3] });
  content.push({ text: subtitle, fontSize: 8, color: gray, margin: [0, 0, 0, 14] });

  tables.forEach((table, ti) => {
    if (ti > 0) content.push({ text: "", margin: [0, 8, 0, 0] });

    if (table.title) {
      content.push({ text: table.title, fontSize: 10, bold: true, color: orange, margin: [0, 0, 0, 4] });
    }

    const body: any[][] = [
      table.headers.map(h => ({
        text: h, fontSize: 8, bold: true, color: orange,
        fillColor: orangeBg, margin: [3, 4, 3, 4],
        border: [false, false, false, true],
        borderColor: ["", "", "", orange],
      })),
    ];

    table.rows.forEach((row, ri) => {
      body.push(row.map(cell => ({
        text: String(cell ?? "-"), fontSize: 8, color: dark,
        fillColor: ri % 2 === 0 ? "#fafafa" : "#ffffff",
        margin: [3, 4, 3, 4],
        border: [false, false, false, true],
        borderColor: ["", "", "", "#eeeeee"],
      })));
    });

    if (table.sectionHeading) body.unshift([
      { text: table.sectionHeading, colSpan: table.headers.length, fontSize: 11, bold: true, color: dark, fillColor: orangeBg, margin: [6, 9, 6, 9], border: [false, false, false, false] },
      ...Array(table.headers.length - 1).fill({ text: "", border: [false, false, false, false] }),
    ]);

    if (table.rows.length === 0) {
      body.push([
        { text: "No records found", fontSize: 8, color: gray, colSpan: table.headers.length, margin: [3, 6, 3, 6], border: [false, false, false, false] },
        ...Array(table.headers.length - 1).fill({ text: "", border: [false, false, false, false] }),
      ]);
    }

    content.push({
      unbreakable: table.keepTogether === true,
      table: { headerRows: table.sectionHeading ? 2 : 1, keepWithHeaderRows: table.sectionHeading ? 1 : undefined, dontBreakRows: table.sectionHeading ? true : undefined, widths: table.widths, body },
      layout: {
        hLineWidth: () => 0.3,
        vLineWidth: () => 0,
        hLineColor: () => "#eeeeee",
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
    });

    content.push({
      canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: orange }],
      margin: [0, 0, 0, 4],
    });
  });

  const docDef: any = {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 50],
    content,
    footer: (currentPage: number, pageCount: number) => ({
      text: `Ashtech Digital Solutions EMS  ·  Generated ${new Date().toLocaleString("en-PK")}  ·  Page ${currentPage} of ${pageCount}`,
      fontSize: 7, color: gray, alignment: "center", margin: [40, 8, 40, 0],
    }),
    defaultStyle: { font: "Roboto" },
  };

  return new Promise((resolve, reject) => {
    try {
      const pdfDoc = pdfMake.createPdf(docDef);
      pdfDoc.getBuffer((buffer: Uint8Array) => {
        resolve(Buffer.from(buffer));
      });
    } catch (err) {
      reject(err);
    }
  });
}
