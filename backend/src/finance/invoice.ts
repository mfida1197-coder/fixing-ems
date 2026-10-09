const MONEY_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const GENERIC_PROJECT_ENDINGS = new Set([
  "SYSTEM",
  "SOFTWARE",
  "APPLICATION",
  "APP",
  "PROJECT",
  "PLATFORM",
]);

export type InvoiceAmounts = {
  taxApplied: boolean;
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  amountPaid: string;
  remainingBalance: string;
};

export function parseMoneyToMinor(value: unknown, fieldName: string): bigint {
  const normalized = String(value ?? "").trim();
  if (!MONEY_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must be a positive amount with no more than two decimal places`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor <= 0n) {
    throw new Error(`${fieldName} must be greater than zero`);
  }
  return minor;
}

export function minorToDecimal(minor: bigint): string {
  const sign = minor < 0n ? "-" : "";
  const absolute = minor < 0n ? -minor : minor;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function calculateProjectTotals(subtotalValue: unknown, taxPercentValue: unknown) {
  const subtotalMinor = parseMoneyToMinor(subtotalValue, "Invoice subtotal");
  // NULL is an explicit no-tax project setting; retain zero only in calculated
  // amounts/invoice snapshots, never as a replacement project setting.
  const taxRate = taxPercentValue == null ? 0 : Number(taxPercentValue);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new Error("Sales tax must be between 0 and 100 percent");
  const taxBasisPoints = BigInt(Math.round(taxRate * 100));
  const taxMinor = (subtotalMinor * taxBasisPoints + 5_000n) / 10_000n;
  const totalMinor = subtotalMinor + taxMinor;
  return { subtotal: minorToDecimal(subtotalMinor), taxRate: taxRate.toFixed(2), taxAmount: minorToDecimal(taxMinor), total: minorToDecimal(totalMinor), taxApplied: taxBasisPoints > 0n };
}

export function calculateInvoiceAmounts(subtotalValue: unknown, paidValue: unknown, taxPercentValue: unknown): InvoiceAmounts {
  const totals = calculateProjectTotals(subtotalValue, taxPercentValue);
  const paidMinor = parseMoneyToMinor(paidValue, "Payment amount");
  const totalMinor = parseMoneyToMinor(totals.total, "Invoice total");

  if (paidMinor > totalMinor) {
    throw new Error("Payment amount cannot exceed the invoice total");
  }

  return {
    ...totals,
    amountPaid: minorToDecimal(paidMinor),
    remainingBalance: minorToDecimal(totalMinor - paidMinor),
  };
}

function normalizedWords(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function clientInitials(clientName: string): string {
  const words = normalizedWords(clientName);
  const initials = words.map((word) => word[0]).join("");
  return initials || "CLIENT";
}

export function projectInitials(projectName: string): string {
  let words = normalizedWords(projectName);
  if (words.length >= 3 && GENERIC_PROJECT_ENDINGS.has(words[words.length - 1])) {
    words = words.slice(0, -1);
  }
  const initials = words.map((word) => word[0]).join("");
  return initials || "PROJECT";
}

export function buildInvoiceNumber(
  clientName: string,
  projectName: string,
  sequence: number,
): string {
  return `ASH-${clientInitials(clientName)}-${projectInitials(projectName)}-${String(sequence).padStart(4, "0")}`;
}

export function karachiDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
