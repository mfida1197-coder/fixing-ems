import bcrypt from "bcrypt";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../src/db";
import { karachiDate } from "../src/finance/invoice";

const BASE_URL = process.env.API_URL || "http://localhost:4011/api";
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`PASS: ${message}`);
}

async function request(route: string, options: { method?: string; token?: string; json?: unknown; form?: FormData } = {}) {
  const response = await fetch(`${BASE_URL}${route}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.json === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.form ?? (options.json === undefined ? undefined : JSON.stringify(options.json)),
  });
  return { status: response.status, body: await response.json().catch(() => null) as any };
}

async function main() {
  const suffix = Date.now();
  const email = `finance-accounts-${suffix}@example.test`;
  const password = `Finance-${suffix}-safe`;
  let userId = 0;
  const accountIds: number[] = [];
  const transactionIds: number[] = [];
  try {
    const [roles] = await pool.execute<RowDataPacket[]>("SELECT id FROM roles WHERE name = 'super_admin' LIMIT 1");
    const hash = await bcrypt.hash(password, 12);
    const [user] = await pool.execute<ResultSetHeader>(
      "INSERT INTO users (role_id, full_name, email, password_hash, is_active) VALUES (?, 'Finance Account Verifier', ?, ?, TRUE)",
      [Number(roles[0].id), email, hash],
    );
    userId = user.insertId;
    const login = await request("/auth/login", { method: "POST", json: { email, password } });
    const token = String(login.body?.token ?? "");
    check(login.status === 200 && token.length > 10, "verification user can access Finance APIs");

    for (const [name, initial] of [["Transfer Source", 100000], ["Transfer Destination", 50000]] as const) {
      const created = await request("/finance/accounts", { method: "POST", token, json: { account_name: `${name} ${suffix}`, account_type: "cash", currency: "PKR", initial_balance: initial, status: "active" } });
      check(created.status === 201, `${name} account created`);
      accountIds.push(Number(created.body.id));
    }
    const [categories] = await pool.execute<RowDataPacket[]>("SELECT id FROM finance_categories WHERE type = 'inflow' LIMIT 1");
    const form = new FormData();
    form.set("type", "inflow"); form.set("category_id", String(categories[0].id)); form.set("txn_date", karachiDate());
    form.set("amount", "1000"); form.set("currency", "PKR"); form.set("exchange_rate", "1"); form.set("payment_method", "cash");
    form.set("account_id", String(accountIds[0])); form.set("description", "Balance verification inflow");
    const transaction = await request("/finance/transactions", { method: "POST", token, form });
    check(transaction.status === 201, "linked inflow transaction created");
    transactionIds.push(Number(transaction.body.id));
    let accounts = await request("/finance/accounts", { token });
    let source = accounts.body.accounts.find((item: any) => Number(item.id) === accountIds[0]);
    check(Number(source.current_balance) === 101000, "linked inflow immediately increases derived account balance");

    const summaryBeforeTransfer = await request("/finance/summary", { token });
    const transfer = await request("/finance/accounts/transfers", { method: "POST", token, json: { from_account_id: accountIds[0], to_account_id: accountIds[1], amount: 20000, transfer_date: karachiDate(), description: "Controlled transfer" } });
    check(transfer.status === 201, "internal account transfer succeeds atomically");
    accounts = await request("/finance/accounts", { token });
    source = accounts.body.accounts.find((item: any) => Number(item.id) === accountIds[0]);
    const destination = accounts.body.accounts.find((item: any) => Number(item.id) === accountIds[1]);
    check(Number(source.current_balance) === 81000 && Number(destination.current_balance) === 70000, "transfer decreases source and increases destination balances");
    const summaryAfterTransfer = await request("/finance/summary", { token });
    check(JSON.stringify(summaryAfterTransfer.body) === JSON.stringify(summaryBeforeTransfer.body), "internal transfer does not change company inflow/outflow totals");
    const sourceHistory = await request(`/finance/accounts/${accountIds[0]}/history`, { token });
    const destinationHistory = await request(`/finance/accounts/${accountIds[1]}/history`, { token });
    check(sourceHistory.body.history.some((item: any) => item.source === "transfer" && item.type === "outflow"), "source history contains transfer out");
    check(destinationHistory.body.history.some((item: any) => item.source === "transfer" && item.type === "inflow"), "destination history contains transfer in");

    await pool.execute("DELETE FROM transactions WHERE id = ?", [transactionIds[0]]);
    transactionIds.length = 0;
    accounts = await request("/finance/accounts", { token });
    source = accounts.body.accounts.find((item: any) => Number(item.id) === accountIds[0]);
    check(Number(source.current_balance) === 80000, "removing a transaction restores the derived account balance");
  } finally {
    if (transactionIds.length) await pool.query("DELETE FROM transactions WHERE id IN (?)", [transactionIds]);
    if (accountIds.length) {
      await pool.query("DELETE FROM finance_account_transfers WHERE from_account_id IN (?) OR to_account_id IN (?)", [accountIds, accountIds]);
      await pool.query("DELETE FROM finance_accounts WHERE id IN (?)", [accountIds]);
    }
    if (userId) {
      await pool.execute("DELETE FROM audit_logs WHERE user_id = ?", [userId]);
      await pool.execute("DELETE FROM users WHERE id = ?", [userId]);
    }
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
