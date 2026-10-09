export function netSalarySql(prefix = ""): string {
  return `ROUND(COALESCE(${prefix}basic_salary, 0) + COALESCE(${prefix}allowances, 0) - COALESCE(${prefix}deductions, 0), 2)`;
}
export const salaryFields = ["basic_salary", "allowances", "deductions"] as const;

export function salaryAmount(value: unknown, label = "Salary"): number | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  const text = typeof value === "string" ? value.trim() : String(value);
  if ((typeof value !== "string" && typeof value !== "number") ||
      !/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text) || !Number.isFinite(Number(text)) ||
      Number(text) > 9999999999.99) {
    throw new Error(`${label} must be a non-negative amount with at most 2 decimal places (maximum 9999999999.99)`);
  }
  return Number(text);
}

export function salaryValues(input: Record<string, unknown>): Record<string, number | string | null> {
  const result: Record<string, number | string | null> = {};
  for (const field of salaryFields) {
    if (input[field] !== undefined) result[field] = salaryAmount(input[field], field.replace(/_/g, " "));
  }
  if (input.salary_currency !== undefined) {
    if (typeof input.salary_currency !== "string" || !/^[A-Z]{3}$/.test(input.salary_currency)) {
      throw new Error("Salary currency must be a three-letter uppercase currency code");
    }
    result.salary_currency = input.salary_currency;
  }
  return result;
}

// Integer cents avoid floating-point artifacts; NULL components contribute zero.
export function netSalary(basic: unknown, allowances: unknown, deductions: unknown): number {
  const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100) || 0;
  return (cents(basic) + cents(allowances) - cents(deductions)) / 100;
}
