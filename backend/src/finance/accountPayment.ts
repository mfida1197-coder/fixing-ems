import { calculateProjectPayment } from "./projectPayment";

// Reuse the existing decimal-safe PKR bridge without mixing project/account storage.
export function calculateAccountPayment(amount: unknown, currency: string, transactionRate: unknown, accountCurrency: string, accountRate: unknown) {
  const result = calculateProjectPayment(amount, currency, transactionRate, accountCurrency, accountRate);
  return { amount: result.appliedAmount, currency: result.appliedCurrency, rate: result.projectRateToPkr, amountPkr: result.amountPkr };
}

export function accountAppliedSql(currency: string): string {
  return `CASE WHEN t.account_applied_amount IS NOT NULL AND t.account_applied_currency = ${currency} THEN t.account_applied_amount
    WHEN t.account_applied_amount IS NULL AND t.currency = ${currency} THEN t.amount
    WHEN t.account_applied_amount IS NULL AND ${currency} = 'PKR' THEN t.amount_pkr ELSE NULL END`;
}
