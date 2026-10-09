import assert from "assert/strict";
import { pool } from "../src/db";
import { encrypt, notifyEmployeeRequest, sendEmail, senderSlot } from "../src/email/gmail";
import { buildEmployeeLetterPdf } from "../src/employees/employeeLetterPdf";

async function main() {
  const originalExecute = pool.execute;
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const accounts = { primary: { email: "primary@example.com", refresh_token_encrypted: encrypt("primary-refresh"), status: "connected" }, secondary: { email: "secondary@example.com", refresh_token_encrypted: encrypt("secondary-refresh"), status: "connected" } };
  const sent: Array<{ token: string; raw: string }> = [];
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost/api/email/oauth/callback";
  pool.execute = (async (sql: string, values?: unknown[]) => {
    if (sql.includes("SELECT full_name")) return [[{ full_name: "Test Employee" }], []];
    if (sql.includes("SELECT email FROM")) return [[{ email: accounts.primary.email }], []];
    return [[accounts[values?.[0] as "primary" | "secondary"]], []];
  }) as unknown as typeof pool.execute;
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url).includes("/token")) {
      const refresh = new URLSearchParams(String(options?.body)).get("refresh_token");
      return new Response(JSON.stringify({ access_token: `${refresh}-access` }), { status: 200 });
    }
    sent.push({ token: (options?.headers as Record<string, string>).Authorization, raw: Buffer.from(JSON.parse(String(options?.body)).raw, "base64url").toString() });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    assert.throws(() => senderSlot("arbitrary"));
    await sendEmail("secondary", "employee@example.com", "Letter", "Body", { name: "letter.pdf", mime: "application/pdf", buffer: Buffer.from("%PDF-test") });
    assert.match(sent[0].token, /^Bearer secondary-refresh-access$/);
    assert.match(sent[0].raw, /From: secondary@example.com/);
    assert.match(sent[0].raw, /filename="letter.pdf"/);
    await notifyEmployeeRequest(1, "Leave Request");
    assert.match(sent[1].token, /^Bearer primary-refresh-access$/);
    assert.match(sent[1].raw, /To: primary@example.com/);
    assert(sent[1].raw.includes(Buffer.from("Employee: Test Employee\nRequest Type: Leave Request").toString("base64").slice(0, 50)));
    globalThis.fetch = (async () => { throw new Error("Simulated Google failure"); }) as typeof fetch;
    console.warn = () => {};
    await notifyEmployeeRequest(1, "General Application"); // notification failure is swallowed
  } finally { pool.execute = originalExecute; globalThis.fetch = originalFetch; console.warn = originalWarn; }

  const pdfMake = require("pdfmake/build/pdfmake");
  const originalCreate = pdfMake.createPdf;
  let definition: unknown;
  pdfMake.createPdf = (value: unknown) => { definition = value; return originalCreate.call(pdfMake, value); };
  try {
    const pdf = await buildEmployeeLetterPdf({ letterType: "hiring", issueDate: "2026-10-05", effectiveDate: "2026-10-05", subject: "Long letter margin check", body: Array(30).fill("MarginProbe " + "Long employee letter text should wrap safely inside both printable margins. ".repeat(12)).join("\n\n"), employeeName: "Test Employee", employeeCode: "TEST", designation: "Developer", projectName: null, newDesignation: null, notes: null });
    assert(pdf.subarray(0, 5).toString() === "%PDF-");
    const pages = await new Promise<Array<{ items: Array<{ type: string; item: { x: number; inlines?: Array<{ x: number; width: number; text: string }> } }> }>>(resolve => originalCreate.call(pdfMake, definition)._getPages({}, resolve));
    assert(pages.length > 1);
    let checked = 0;
    for (const page of pages) for (const item of page.items) {
      if (item.type !== "line" || !item.item.inlines?.some(inline => /MarginProbe|printable|employee letter/.test(inline.text))) continue;
      for (const inline of item.item.inlines) {
        assert(item.item.x + inline.x >= 75.5);
        const trailingSpace = /\s$/.test(inline.text) ? 3 : 0;
        assert(item.item.x + inline.x + inline.width - trailingSpace <= 519.8, `Right bound ${item.item.x + inline.x + inline.width}, text ${JSON.stringify(inline.text)}`);
      }
      checked++;
    }
    assert(checked > 30);
    console.log(`Email slot isolation, attachment, minimal notification/failure checks passed; ${pages.length}-page letter margin check passed.`);
  } finally { pdfMake.createPdf = originalCreate; await pool.end(); }
}
main().catch(async error => { console.error(error instanceof Error ? error.message : "Email verification failed"); await pool.end(); process.exitCode = 1; });
