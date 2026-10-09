import { useEffect, useState } from "react";
import { LuWallet, LuClock, LuCircleCheck, LuArrowRight } from "react-icons/lu";
import { api } from "../lib/api";

type PayrollRow = { employee_id: number; employee_code: string; full_name: string; designation: string; net_salary: number; salary_currency: string; payroll_period: string; status: "pending" | "paid"; paid_at: string | null; finance_transaction_id: number | null };
export type PayrollContext = { employeeId: number; period: string };
const money = (value: number) => Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export default function Payroll({ onPay, onView }: { onPay: (context: PayrollContext) => void; onView: (id: number) => void }) {
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7));
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    api<{ payroll: PayrollRow[] }>(`/api/finance/payroll?period=${month}-01`).then(data => { if (active) setRows(data.payroll); }).catch((caught: Error) => { if (active) setError(caught.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month]);
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.salary_currency, Math.round(((totals.get(row.salary_currency) ?? 0) + Number(row.net_salary)) * 100) / 100);
  const periodLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "Asia/Karachi" }).format(new Date(`${month}-01T00:00:00Z`));
  return <div className="content payroll-page">
    <div className="fin-page-header"><div><p className="fin-page-kicker">Payroll Management</p><h1 className="page-title">Payroll</h1><p className="page-sub">Manage employee salary payments and payroll history.</p></div><label className="field-label">Payroll period<input className="field-input" type="month" min="2000-01" max="2100-12" value={month} onChange={event => event.target.value && setMonth(event.target.value)} /></label></div>
    {error && <p className="attendance-action-error" role="alert">{error}</p>}
    {loading ? <p role="status">Loading payroll…</p> : <>
      <div className="fin-kpi-row">
        <div className="fin-kpi-card"><div className="fin-kpi-icon fin-kpi-icon-accent"><LuWallet size={22} /></div><div className="fin-kpi-body"><div className="fin-kpi-label">Total Payroll</div><div className="payroll-currency-totals">{Array.from(totals, ([currency, amount]) => <strong key={currency}>{currency} {money(amount)}</strong>)}{!totals.size && <strong>No payable salaries</strong>}</div></div></div>
        <div className="fin-kpi-card"><div className="fin-kpi-icon fin-kpi-icon-accent"><LuClock size={22} /></div><div className="fin-kpi-body"><div className="fin-kpi-label">Pending</div><div className="fin-kpi-value">{rows.filter(row => row.status === "pending").length}</div><div className="fin-kpi-sub">employees</div></div></div>
        <div className="fin-kpi-card"><div className="fin-kpi-icon fin-kpi-icon-success"><LuCircleCheck size={22} /></div><div className="fin-kpi-body"><div className="fin-kpi-label">Paid</div><div className="fin-kpi-value fin-kpi-value-success">{rows.filter(row => row.status === "paid").length}</div><div className="fin-kpi-sub">employees</div></div></div>
      </div>
      <div className="payroll-list">{rows.map(row => <article className="payroll-row" key={row.employee_id}>
        <div className="payroll-employee"><span className="fin-acc-avatar">{row.full_name.charAt(0).toUpperCase()}</span><div><strong>{row.full_name}</strong><small>{row.employee_code} · {row.designation}</small></div></div>
        <div><small>Salary</small><strong>{row.salary_currency} {money(row.net_salary)}</strong></div>
        <div><small>Payroll Period</small><span>{periodLabel}</span></div>
        <div><span className={`fin-status-badge ${row.status === "paid" ? "fin-status-active" : "payroll-pending"}`}>{row.status === "paid" ? "Paid" : "Pending"}</span>{row.status === "paid" && row.paid_at && <small>Paid {new Intl.DateTimeFormat("en", { timeZone: "Asia/Karachi", dateStyle: "medium" }).format(new Date(row.paid_at.endsWith("Z") ? row.paid_at : `${row.paid_at.replace(" ", "T")}Z`))}</small>}</div>
        <button className={row.status === "paid" ? "fin-btn-secondary" : "fin-btn-primary"} onClick={() => row.finance_transaction_id ? onView(row.finance_transaction_id) : onPay({ employeeId: row.employee_id, period: row.payroll_period })}>{row.status === "paid" ? "View Transaction" : "Pay Now"}<LuArrowRight size={15} /></button>
      </article>)}{!rows.length && <p className="empty-note">No eligible employees or paid payroll for this period.</p>}</div>
    </>}
  </div>;
}
