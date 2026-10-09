import { minorToDecimal, parseMoneyToMinor } from "./invoice";

function rateMinor(value: unknown, label: string): bigint {
  const text = String(value ?? "").trim();
  if (!/^\d{1,8}(?:\.\d{1,4})?$/.test(text)) throw new Error(`${label} must be positive with at most four decimal places`);
  const [whole, fraction = ""] = text.split(".");
  const rate = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
  if (rate <= 0n) throw new Error(`${label} must be greater than zero`);
  return rate;
}
function rateDecimal(rate: bigint): string { return `${rate / 10000n}.${String(rate % 10000n).padStart(4, "0")}`; }
function round(numerator: bigint, denominator: bigint): bigint { return (numerator + denominator / 2n) / denominator; }

export function calculateProjectPayment(amount: unknown, currency: string, paymentRate: unknown, projectCurrency: string, projectRate: unknown) {
  if (!/^[A-Z]{3}$/.test(currency) || !/^[A-Z]{3}$/.test(projectCurrency)) throw new Error("Invalid payment or project currency");
  const actual = parseMoneyToMinor(amount, "Payment amount");
  const sourceRate = currency === "PKR" ? 10000n : rateMinor(paymentRate, "Payment exchange rate to PKR");
  const targetRate = projectCurrency === currency ? sourceRate : projectCurrency === "PKR" ? 10000n : rateMinor(projectRate, "Project exchange rate to PKR");
  const pkrMinor = round(actual * sourceRate, 10000n);
  const applied = currency === projectCurrency ? actual : round(pkrMinor * 10000n, targetRate);
  if (actual > 99999999999999n || applied > 99999999999999n || pkrMinor > 9999999999999999n) throw new Error("Payment exceeds supported monetary precision");
  if (applied <= 0n) throw new Error("Payment rounds to zero in project currency");
  return { appliedAmount: minorToDecimal(applied), appliedCurrency: projectCurrency, projectRateToPkr: rateDecimal(targetRate), paymentRateToPkr: rateDecimal(sourceRate), amountPkr: minorToDecimal(pkrMinor) };
}

export function projectAppliedSql(currencyExpression: string): string {
  return `CASE WHEN t.project_applied_amount IS NOT NULL AND t.project_applied_currency = ${currencyExpression} THEN t.project_applied_amount WHEN t.project_applied_amount IS NULL AND t.currency = ${currencyExpression} THEN t.amount ELSE 0 END`;
}
