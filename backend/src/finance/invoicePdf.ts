import fs from "fs";
import path from "path";

export type InvoicePdfData = {
  invoiceNumber: string;
  transactionId?: string | null;
  issueDate: string;
  clientName: string;
  clientNtn: string | null;
  projectName: string;
  currency: string;
  subtotal: string;
  taxApplied: boolean;
  taxRate: string;
  taxAmount: string;
  total: string;
  amountPaid: string;
  remainingBalance: string;
  paymentMethod: string;
  senderBankName: string | null;
  receivingAccountName: string;
  receivingBankName: string | null;
  senderAccountNumber: string | null;
  documentTitle?: "INVOICE" | "PAYMENT VOUCHER" | "RECEIPT";
  partyLabel?: string;
  partyReference?: string | null;
  lineDescription?: string;
  summaryRows?: Array<{ label: string; value: string; accent?: "green" | "orange" }>;
  paymentDetails?: Array<{ label: string; value: string }>;
  footerStatement?: string;
};

function logoDataUrl(): string | null {
  const candidates = [
    path.join(__dirname, "..", "ashtech-logo.png"),
    path.join(__dirname, "..", "ashtech-logo-full.png"),
    path.join(process.cwd(), "src", "ashtech-logo.png"),
    path.join(process.cwd(), "src", "ashtech-logo-full.png"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return `data:image/png;base64,${fs.readFileSync(candidate).toString("base64")}`;
    }
  }
  return null;
}

function money(currency: string, value: string): string {
  return `${currency} ${Number(value).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function label(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export async function buildInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const pdfMake = require("pdfmake/build/pdfmake");
  const pdfFonts = require("pdfmake/build/vfs_fonts");
  pdfMake.vfs = pdfFonts.pdfMake.vfs;

  const orange = "#F97316";
  const paleOrange = "#FFF7ED";
  const dark = "#202124";
  const muted = "#777777";
  const light = "#E5E7EB";
  const logo = logoDataUrl();
  const paymentMethod = label(data.paymentMethod);
  const documentTitle = data.documentTitle ?? "INVOICE";
  const titleText = documentTitle === "INVOICE" ? "I N V O I C E" : documentTitle;
  const methodDisplay = data.paymentMethod === "bank_transfer" && data.senderBankName
    ? [
        { text: `${paymentMethod} (` },
        { text: data.senderBankName, bold: true },
        { text: ")" },
      ]
    : [{ text: paymentMethod }];
  const summaryRows: object[][] = data.summaryRows?.length ? data.summaryRows.map((row, index, rows) => {
    const final = index === rows.length - 1;
    const labelStyle = row.accent === "green" ? "paidLabel" : row.accent === "orange" ? "balanceLabel" : final ? "totalLabel" : "summaryLabel";
    const valueStyle = row.accent === "green" ? "paidValue" : row.accent === "orange" ? "balanceValue" : final ? "totalValue" : "summaryValue";
    return [{ text: row.label, style: labelStyle }, { text: row.value, style: valueStyle }];
  }) : [
    [{ text: "Subtotal", style: "summaryLabel" }, { text: money(data.currency, data.subtotal), style: "summaryValue" }],
    ...(data.taxApplied
      ? [[{ text: `Sales Tax (${Number(data.taxRate).toFixed(0)}%)`, style: "summaryLabel" }, { text: money(data.currency, data.taxAmount), style: "summaryValue" }]]
      : []),
    [{ text: "TOTAL INVOICE", style: "totalLabel" }, { text: money(data.currency, data.total), style: "totalValue" }],
    [{ text: "AMOUNT PAID", style: "paidLabel" }, { text: money(data.currency, data.amountPaid), style: "paidValue" }],
    [{ text: "REMAINING BALANCE", style: "balanceLabel" }, { text: money(data.currency, data.remainingBalance), style: "balanceValue" }],
  ];

  const content: object[] = [
    {
      columns: [
        logo
          ? { image: logo, width: 68 }
          : { text: "ASH", fontSize: 24, bold: true, color: orange, width: 75 },
        {
          stack: [
            { text: "ASHTECH DIGITAL SOLUTIONS", fontSize: 11, bold: true, color: orange, alignment: "right" },
            { text: "+92 335 3026439", fontSize: 8, color: orange, alignment: "right", margin: [0, 2, 0, 0] },
            { text: "business@ashtechdigitalsolutions.com", fontSize: 8, color: orange, alignment: "right" },
            { text: "www.ashtechdigitalsolutions.com", fontSize: 8, color: orange, alignment: "right" },
          ],
          width: "*",
        },
      ],
      margin: [0, 0, 0, 38],
    },
    {
      columns: [
        { text: titleText, fontSize: documentTitle === "INVOICE" ? 23 : 19, bold: true, color: dark, characterSpacing: documentTitle === "INVOICE" ? 0 : 1.2, width: "*" },
        {
          table: {
            widths: [84, 130],
            body: [
              [{ text: documentTitle === "INVOICE" ? "INVOICE NUMBER" : "DOCUMENT NUMBER", style: "metaLabel" }, { text: data.invoiceNumber, style: "metaValue" }],
              ...(data.transactionId ? [[{ text: "TRANSACTION ID", style: "metaLabel" }, { text: data.transactionId, style: "metaValue" }]] : []),
              [{ text: "DATE OF ISSUE", style: "metaLabel" }, { text: data.issueDate, style: "metaValue" }],
            ],
          },
          layout: "noBorders",
          width: 220,
        },
      ],
      margin: [30, 0, 0, 34],
    },
    {
      columns: [
        {
          stack: [
            { text: data.partyLabel ?? "BILL TO", style: "sectionLabel" },
            { text: data.clientName, fontSize: 12, bold: true, color: dark, margin: [0, 5, 0, 0] },
            ...(data.partyReference || data.clientNtn ? [{ text: data.partyReference ?? `NTN: ${data.clientNtn}`, fontSize: 9, color: muted, margin: [0, 3, 0, 0] }] : []),
          ],
          width: "50%",
        },
        {
          stack: [
            { text: documentTitle === "INVOICE" ? "BILLED BY" : documentTitle === "RECEIPT" ? "RECEIVED BY" : "PAID BY", style: "sectionLabel", alignment: "right" },
            { text: "Ashtech Digital Solutions", fontSize: 12, bold: true, color: dark, alignment: "right", margin: [0, 5, 0, 0] },
            { text: "business@ashtechdigitalsolutions.com", fontSize: 9, color: muted, alignment: "right", margin: [0, 3, 0, 0] },
          ],
          width: "50%",
        },
      ],
      margin: [30, 0, 30, 34],
    },
    {
      table: {
        headerRows: 1,
        widths: ["*", 75, 105],
        body: [
          [
            { text: "DESCRIPTION", style: "tableHeader" },
            { text: "CURRENCY", style: "tableHeader", alignment: "center" },
            { text: "AMOUNT", style: "tableHeader", alignment: "right" },
          ],
          [
            { text: data.lineDescription ?? data.projectName, fontSize: 11, color: dark, margin: [6, 8, 4, 8] },
            { text: data.currency, fontSize: 10, color: dark, alignment: "center", margin: [4, 8, 4, 8] },
            { text: Number(data.subtotal).toLocaleString("en-PK", { minimumFractionDigits: 2 }), fontSize: 11, color: dark, alignment: "right", margin: [4, 8, 6, 8] },
          ],
        ],
      },
      layout: {
        hLineWidth: (index: number) => index === 1 ? 1 : 0.35,
        vLineWidth: () => 0,
        hLineColor: (index: number) => index === 1 ? dark : light,
      },
      margin: [30, 0, 30, 24],
    },
    {
      columns: [
        { text: "", width: "*" },
        {
          table: {
            widths: [130, 115],
            body: summaryRows,
          },
          layout: {
            hLineWidth: (index: number) => index === summaryRows.length - 2 || index === summaryRows.length - 1 ? 0.8 : 0,
            vLineWidth: () => 0,
            hLineColor: () => light,
            fillColor: (rowIndex: number) => rowIndex === summaryRows.length - 1 ? paleOrange : null,
          },
          width: 250,
        },
      ],
      margin: [30, 0, 30, 30],
    },
    { text: "PAYMENT INFORMATION", style: "sectionLabel", margin: [30, 0, 30, 12] },
    ...(data.paymentDetails?.length ? [{
      table: {
        widths: ["*", "*"],
        body: Array.from({ length: Math.ceil(data.paymentDetails.length / 2) }, (_, rowIndex) => [0, 1].map((columnIndex) => {
          const detail = data.paymentDetails![rowIndex * 2 + columnIndex];
          return detail ? { stack: [{ text: detail.label.toUpperCase(), style: "paymentLabel" }, { text: detail.value, style: "paymentValue" }], margin: [0, 0, 12, 12] } : { text: "" };
        })),
      },
      layout: "noBorders",
      margin: [30, 0, 30, 22],
    }] : [{
      columns: [
        {
          stack: [
            { text: "METHOD", style: "paymentLabel" },
            { text: methodDisplay, fontSize: 11, color: dark, margin: [0, 4, 0, 0] },
            { text: "Account Number:", style: "paymentLabel", margin: [0, 13, 0, 0] },
            { text: data.senderAccountNumber || "Not provided", style: "paymentValue" },
          ],
          width: "50%",
        },
        {
          stack: [
            { text: "SENT TO", style: "paymentLabel" },
            { text: data.receivingAccountName, style: "paymentValue" },
          ],
          width: "50%",
        },
      ],
      margin: [30, 0, 30, 36],
    }]),
    { text: "Note:", fontSize: 9, color: muted, margin: [30, 0, 30, 8] },
    {
      text: data.footerStatement ?? "Thank you for your business. Any remaining balance is payable according to the agreed project terms.",
      fontSize: 9,
      color: muted,
      margin: [30, 0, 30, 22],
    },
    {
      text: `This is a computer-generated ${documentTitle.toLowerCase()} and does not require a signature.`,
      fontSize: 8,
      italics: true,
      color: "#999999",
      alignment: "center",
    },
  ];

  const definition = {
    pageSize: "A4",
    pageMargins: [42, 34, 42, 52],
    content,
    styles: {
      metaLabel: { fontSize: 7, color: "#999999", margin: [0, 2, 5, 2] },
      metaValue: { fontSize: 9, bold: true, color: dark, alignment: "right", margin: [0, 2, 0, 2] },
      sectionLabel: { fontSize: 8, bold: true, color: "#999999", characterSpacing: 0.8 },
      tableHeader: { fontSize: 8, bold: true, color: dark, margin: [6, 5, 6, 5] },
      summaryLabel: { fontSize: 9, color: muted, margin: [5, 5, 8, 5] },
      summaryValue: { fontSize: 9, color: dark, alignment: "right", margin: [8, 5, 5, 5] },
      totalLabel: { fontSize: 9, bold: true, color: dark, margin: [5, 7, 8, 7] },
      totalValue: { fontSize: 11, bold: true, color: dark, alignment: "right", margin: [8, 7, 5, 7] },
      paidLabel: { fontSize: 9, bold: true, color: "#15803D", margin: [5, 7, 8, 7] },
      paidValue: { fontSize: 10, bold: true, color: "#15803D", alignment: "right", margin: [8, 7, 5, 7] },
      balanceLabel: { fontSize: 9, bold: true, color: orange, margin: [5, 8, 8, 8] },
      balanceValue: { fontSize: 12, bold: true, color: orange, alignment: "right", margin: [8, 8, 5, 8] },
      paymentLabel: { fontSize: 7, bold: true, color: "#999999", characterSpacing: 0.6 },
      paymentValue: { fontSize: 11, bold: true, color: dark, margin: [0, 4, 0, 0] },
    },
    footer: () => ({
      text: "© Ashtech Digital Solutions | Reg. No.: Z-25-17581/25 | www.ashtechdigitalsolutions.com",
      fontSize: 8,
      color: orange,
      alignment: "center",
      margin: [42, 8, 42, 0],
    }),
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
