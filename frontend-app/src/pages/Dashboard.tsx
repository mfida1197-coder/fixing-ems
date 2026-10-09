import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuUsers,
  LuBriefcase,
  LuFolderKanban,
  LuCircleCheck,
  LuTrendingUp,
  LuTrendingDown,
  LuScale,
  LuBuilding2,
  LuWallet,
  LuCreditCard,
  LuPlus,
  LuArrowRight,
  LuCalendar,
  LuHistory,
} from "react-icons/lu";
import { api } from "../lib/api";
import { getAttendanceDashboard } from "../lib/attendanceDashboardApi";
import type { AdminAttendanceDashboardData } from "../types/attendanceDashboard";
import { AttendanceTeamStatus } from "../components/AttendanceAnalytics";
import { FinanceOverviewChart } from "../components/FinanceOverviewChart";
import { hasFrontendPermission } from "../permissions";
import type { Txn, FinanceAccount } from "./Finance";

type DashData = {
  headcount: number;
  active_clients: number;
  projects: { upcoming: number; ongoing: number; done: number; handed_over: number };
  finance?: { inflow_pkr: number; outflow_pkr: number };
};

type FinanceFilter = "all" | "inflow" | "outflow";
type RecentActivity = {
  action: string;
  entity_type: string;
  entity_id: number | null;
  created_at: string | null;
  full_name: string;
};

const activityDateFormat = new Intl.DateTimeFormat("en-PK", {
  timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short",
});

type DashboardProps = {
  role: string;
  userName?: string;
  onOpenEmployees: (status: string) => void;
  onOpenFinance: (filter: FinanceFilter) => void;
  onOpenFinanceAccounts?: () => void;
  onOpenClients: () => void;
  onOpenProjects: () => void;
};

function karachiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const PERIOD_OPTIONS = [
  { value: "all_time", label: "All time" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "custom", label: "Custom range" },
];

export default function Dashboard({
  role,
  userName,
  onOpenEmployees,
  onOpenFinance,
  onOpenFinanceAccounts,
  onOpenClients,
  onOpenProjects,
}: DashboardProps) {
  const [data, setData] = useState<DashData | null>(null);
  const [error, setError] = useState("");
  const [attendanceError, setAttendanceError] = useState("");
  const [attendance, setAttendance] = useState<AdminAttendanceDashboardData | null>(null);
  const [activity, setActivity] = useState<RecentActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState("");
  const [activityRetry, setActivityRetry] = useState(0);
  const canViewActivity = hasFrontendPermission(role, "recent_activity:view");

  // Accounts state
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  // Shared Finance Range State
  const [periodFilter, setPeriodFilter] = useState("all_time");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [txns, setTxns] = useState<Txn[]>([]);

  const hasFinanceAccess = hasFrontendPermission(role, "finance:manage") || !!data?.finance;

  useEffect(() => {
    api<DashData>("/api/dashboard")
      .then(setData)
      .catch((caught) => setError(caught.message));

    if (hasFrontendPermission(role, "finance:manage")) {
      api<{ transactions: Txn[] }>("/api/finance/transactions")
        .then((response) => setTxns(response.transactions))
        .catch((caught) => console.error("Transactions load error", caught));

      setAccountsLoading(true);
      api<{ accounts: FinanceAccount[] }>("/api/finance/accounts")
        .then((response) => setAccounts(response.accounts))
        .catch((caught) => console.error("Accounts load error", caught))
        .finally(() => setAccountsLoading(false));
    }
  }, [role]);

  useEffect(() => {
    setActivity([]);
    setActivityError("");
    if (!canViewActivity) { setActivityLoading(false); return; }
    const controller = new AbortController();
    setActivityLoading(true);
    api<{ activity: RecentActivity[] }>("/api/dashboard/activity", { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setActivity(response.activity); })
      .catch(() => { if (!controller.signal.aborted) setActivityError("Recent activity could not be loaded. Please try again."); })
      .finally(() => { if (!controller.signal.aborted) setActivityLoading(false); });
    return () => controller.abort();
  }, [canViewActivity, activityRetry]);

  const loadAttendance = useCallback(async () => {
    setAttendanceError("");
    try {
      setAttendance(await getAttendanceDashboard(karachiToday(), 7));
    } catch (caught) {
      setAttendanceError(
        caught instanceof Error ? caught.message : "Attendance analytics could not be loaded."
      );
    }
  }, []);

  useEffect(() => {
    void loadAttendance();
  }, [loadAttendance]);

  // Exact same filtering logic as Finance > Transactions
  const filteredTxns = useMemo(() => {
    return txns.filter((t) => {
      const date = new Date(t.txn_date);
      const now = new Date();
      if (periodFilter === "this_month") {
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      }
      if (periodFilter === "last_month") {
        const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return date.getMonth() === last.getMonth() && date.getFullYear() === last.getFullYear();
      }
      if (periodFilter === "this_quarter") {
        const q = Math.floor(now.getMonth() / 3);
        return Math.floor(date.getMonth() / 3) === q && date.getFullYear() === now.getFullYear();
      }
      if (periodFilter === "custom" && dateFrom && dateTo) {
        return date >= new Date(dateFrom) && date <= new Date(dateTo);
      }
      return true;
    });
  }, [txns, periodFilter, dateFrom, dateTo]);

  // Sum using PKR conversion rules (amount_pkr) from transactions
  const filteredInflow = useMemo(() => {
    if (txns.length === 0 && data?.finance && periodFilter === "all_time") {
      return data.finance.inflow_pkr;
    }
    return filteredTxns
      .filter((t) => t.type === "inflow")
      .reduce((sum, t) => sum + Number(t.amount_pkr), 0);
  }, [filteredTxns, txns.length, data?.finance, periodFilter]);

  const filteredOutflow = useMemo(() => {
    if (txns.length === 0 && data?.finance && periodFilter === "all_time") {
      return data.finance.outflow_pkr;
    }
    return filteredTxns
      .filter((t) => t.type === "outflow")
      .reduce((sum, t) => sum + Number(t.amount_pkr), 0);
  }, [filteredTxns, txns.length, data?.finance, periodFilter]);

  const filteredNet = filteredInflow - filteredOutflow;

  const periodLabel =
    periodFilter === "this_month"
      ? "This month"
      : periodFilter === "last_month"
      ? "Last month"
      : periodFilter === "this_quarter"
      ? "This quarter"
      : periodFilter === "custom"
      ? "Selected period"
      : "All time";

  const fmt = (n: number) => {
    const abs = Math.abs(n);
    let compact: string;
    if (abs >= 1_000_000) compact = (abs / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
    else if (abs >= 1_000) compact = (abs / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
    else compact = String(abs.toFixed(0));
    return `${n < 0 ? "-" : ""}PKR ${compact}`;
  };

  // Determine friendly time greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
  }, []);

  if (error) {
    return (
      <main className="content main-dashboard-page">
        <p className="error-text">{error}</p>
      </main>
    );
  }

  if (!data) return null;

  return (
    <main className="content main-dashboard-page">
      {/* 4. DASHBOARD HEADER */}
      <header className="dash-greeting-header">
        <div className="dash-greeting-copy">
          <h1 className="dash-greeting-title">
            {greeting}, {userName || "Admin"}
          </h1>
          <p className="dash-greeting-subtitle">
            Here's a quick overview of your organization.
          </p>
        </div>
      </header>

      {/* 5. TOP ORGANIZATION KPI CARDS */}
      <section className="dash-kpi-grid-4" aria-label="Organization KPI overview">
        {/* Active Employees */}
        <button
          type="button"
          className="dash-kpi-card"
          onClick={() => onOpenEmployees("active")}
          aria-label={`Active Employees: ${data.headcount}`}
        >
          <div className="dash-kpi-top">
            <div className="dash-kpi-icon-bubble dash-bubble-orange">
              <LuUsers size={20} />
            </div>
            <span className="dash-kpi-label">Active Employees</span>
          </div>
          <div className="dash-kpi-body">
            <strong className="dash-kpi-number">{data.headcount}</strong>
            <span className="dash-kpi-footnote">
              View active employees
              <LuArrowRight size={13} className="dash-kpi-link-arrow" />
            </span>
          </div>
        </button>

        {/* Active Clients */}
        <button
          type="button"
          className="dash-kpi-card"
          onClick={onOpenClients}
          aria-label={`Active Clients: ${data.active_clients}`}
        >
          <div className="dash-kpi-top">
            <div className="dash-kpi-icon-bubble dash-bubble-blue">
              <LuBriefcase size={20} />
            </div>
            <span className="dash-kpi-label">Active Clients</span>
          </div>
          <div className="dash-kpi-body">
            <strong className="dash-kpi-number">{data.active_clients}</strong>
            <span className="dash-kpi-footnote">
              Open clients
              <LuArrowRight size={13} className="dash-kpi-link-arrow" />
            </span>
          </div>
        </button>

        {/* Ongoing Projects */}
        <button
          type="button"
          className="dash-kpi-card"
          onClick={onOpenProjects}
          aria-label={`Ongoing Projects: ${data.projects.ongoing}`}
        >
          <div className="dash-kpi-top">
            <div className="dash-kpi-icon-bubble dash-bubble-green">
              <LuFolderKanban size={20} />
            </div>
            <span className="dash-kpi-label">Ongoing Projects</span>
          </div>
          <div className="dash-kpi-body">
            <strong className="dash-kpi-number">{data.projects.ongoing}</strong>
            <span className="dash-kpi-footnote">
              Open projects
              <LuArrowRight size={13} className="dash-kpi-link-arrow" />
            </span>
          </div>
        </button>

        {/* Handed Over */}
        <button
          type="button"
          className="dash-kpi-card"
          onClick={onOpenProjects}
          aria-label={`Handed Over Projects: ${data.projects.handed_over}`}
        >
          <div className="dash-kpi-top">
            <div className="dash-kpi-icon-bubble dash-bubble-purple">
              <LuCircleCheck size={20} />
            </div>
            <span className="dash-kpi-label">Handed Over</span>
          </div>
          <div className="dash-kpi-body">
            <strong className="dash-kpi-number">{data.projects.handed_over}</strong>
            <span className="dash-kpi-footnote">
              View portfolio
              <LuArrowRight size={13} className="dash-kpi-link-arrow" />
            </span>
          </div>
        </button>
      </section>

      {/* 6. FINANCIAL KPI CARDS */}
      {hasFinanceAccess && (
        <section className="dash-kpi-grid-3" aria-label="Financial KPI overview">
          {/* Total Inflow */}
          <button
            type="button"
            className="dash-kpi-card dash-kpi-finance-card"
            onClick={() => onOpenFinance("inflow")}
            aria-label={`Total Inflow: ${fmt(filteredInflow)}`}
          >
            <div className="dash-kpi-top">
              <div className="dash-kpi-icon-bubble dash-bubble-inflow">
                <LuTrendingUp size={20} />
              </div>
              <span className="dash-kpi-label">Total Inflow</span>
            </div>
            <div className="dash-kpi-body">
              <strong className="dash-kpi-number dash-number-inflow">
                {fmt(filteredInflow)}
              </strong>
              <span className="dash-kpi-footnote">
                Inflows · {periodLabel}
                <LuArrowRight size={13} className="dash-kpi-link-arrow" />
              </span>
            </div>
          </button>

          {/* Total Outflow */}
          <button
            type="button"
            className="dash-kpi-card dash-kpi-finance-card"
            onClick={() => onOpenFinance("outflow")}
            aria-label={`Total Outflow: ${fmt(filteredOutflow)}`}
          >
            <div className="dash-kpi-top">
              <div className="dash-kpi-icon-bubble dash-bubble-outflow">
                <LuTrendingDown size={20} />
              </div>
              <span className="dash-kpi-label">Total Outflow</span>
            </div>
            <div className="dash-kpi-body">
              <strong className="dash-kpi-number dash-number-outflow">
                {fmt(filteredOutflow)}
              </strong>
              <span className="dash-kpi-footnote">
                Outflows · {periodLabel}
                <LuArrowRight size={13} className="dash-kpi-link-arrow" />
              </span>
            </div>
          </button>

          {/* Net Balance */}
          <button
            type="button"
            className="dash-kpi-card dash-kpi-finance-card"
            onClick={() => onOpenFinance("all")}
            aria-label={`Net Balance: ${fmt(filteredNet)}`}
          >
            <div className="dash-kpi-top">
              <div className="dash-kpi-icon-bubble dash-bubble-net">
                <LuScale size={20} />
              </div>
              <span className="dash-kpi-label">Net Balance</span>
            </div>
            <div className="dash-kpi-body">
              <strong
                className={`dash-kpi-number ${
                  filteredNet >= 0 ? "dash-number-net-pos" : "dash-number-outflow"
                }`}
              >
                {fmt(filteredNet)}
              </strong>
              <span className="dash-kpi-footnote">
                Net · {periodLabel}
                <LuArrowRight size={13} className="dash-kpi-link-arrow" />
              </span>
            </div>
          </button>
        </section>
      )}

      {attendanceError && <p className="attendance-action-error">{attendanceError}</p>}

      {/* 7 & 8. FINANCIAL OVERVIEW | TEAM STATUS ROW */}
      <section className="dash-analytics-row" aria-label="Analytics overview">
        {/* Left: Financial Overview */}
        {hasFinanceAccess && (
          <div className="dash-panel-card dash-finance-overview-panel">
            <div className="dash-panel-head">
              <div className="dash-panel-title-group">
                <h2 className="dash-panel-title">Financial Overview</h2>
                <p className="dash-panel-sub">Inflow vs Outflow over the selected period</p>
              </div>

              {/* Date range selector */}
              <div className="dash-filter-cluster">
                <div className="dash-select-container">
                  <LuCalendar size={14} className="dash-select-icon" />
                  <select
                    className="dash-select-input"
                    value={periodFilter}
                    onChange={(event) => setPeriodFilter(event.target.value)}
                    aria-label="Finance overview period"
                  >
                    {PERIOD_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                {periodFilter === "custom" && (
                  <div className="dash-custom-range-inputs">
                    <input
                      type="date"
                      className="dash-date-picker"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      aria-label="From date"
                    />
                    <span className="dash-range-sep">to</span>
                    <input
                      type="date"
                      className="dash-date-picker"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      aria-label="To date"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="dash-chart-wrapper">
              <FinanceOverviewChart txns={filteredTxns} />
            </div>

            <div className="dash-chart-legend">
              <span className="dash-legend-badge">
                <i className="dash-dot dash-dot-inflow" />
                Inflow
              </span>
              <span className="dash-legend-badge">
                <i className="dash-dot dash-dot-outflow" />
                Outflow
              </span>
            </div>
          </div>
        )}

        {/* Right: Team Status / Team Roster */}
        {attendance && (
          <div className="dash-panel-card dash-team-status-panel">
            <div className="dash-panel-head">
              <div className="dash-panel-title-group">
                <h2 className="dash-panel-title">Team Status</h2>
                <p className="dash-panel-sub">Current roster distribution</p>
              </div>
            </div>
            <div className="dash-team-status-container">
              <AttendanceTeamStatus
                data={attendance.teamStatus}
                centerLabel="Total Employees"
              />
            </div>
          </div>
        )}
      </section>

      {/* 9 & 10. ACCOUNTS CURRENT BALANCE */}
      {hasFinanceAccess && (
        <section className="dash-accounts-section" aria-label="Accounts Current Balance">
          <div className="dash-accounts-header">
            <div>
              <h2 className="dash-section-title">Accounts Current Balance</h2>
              <p className="dash-section-subtitle">
                Real-time balances across all active company accounts
              </p>
            </div>
            {onOpenFinanceAccounts && (
              <button
                type="button"
                className="dash-add-account-action"
                onClick={onOpenFinanceAccounts}
              >
                <LuPlus size={15} />
                <span>View / Add Account</span>
              </button>
            )}
          </div>

          {accountsLoading ? (
            <div className="dash-accounts-empty-state">
              <p>Loading accounts…</p>
            </div>
          ) : accounts.length === 0 ? (
            <div className="dash-accounts-empty-state">
              <LuWallet size={36} className="dash-empty-account-icon" />
              <p className="dash-empty-text">No finance accounts found.</p>
              {onOpenFinanceAccounts && (
                <button
                  type="button"
                  className="btn-primary"
                  style={{ width: "auto", marginTop: 8 }}
                  onClick={onOpenFinanceAccounts}
                >
                  Manage Accounts
                </button>
              )}
            </div>
          ) : (
            <div className="dash-accounts-grid">
              {accounts.map((acc) => {
                const numBal = Number(acc.current_balance);
                const isBank = acc.account_type === "bank";
                const isCash = acc.account_type === "cash";
                return (
                  <div
                    key={acc.id}
                    className="dash-account-card"
                    onClick={onOpenFinanceAccounts}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenFinanceAccounts?.();
                      }
                    }}
                  >
                    <div className="dash-account-header">
                      <div className="dash-account-identity">
                        <div
                          className={`dash-account-icon-wrap ${
                            isBank
                              ? "dash-account-icon-bank"
                              : isCash
                              ? "dash-account-icon-cash"
                              : "dash-account-icon-digital"
                          }`}
                        >
                          {isBank ? (
                            <LuBuilding2 size={18} />
                          ) : isCash ? (
                            <LuWallet size={18} />
                          ) : (
                            <LuCreditCard size={18} />
                          )}
                        </div>
                        <div className="dash-account-text">
                          <h3 className="dash-account-name">{acc.account_name}</h3>
                          <span className="dash-account-meta">
                            {isBank
                              ? `Bank · ${acc.bank_name || "Bank"}`
                              : isCash
                              ? "Cash Account"
                              : "Digital Account"}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`dash-account-status ${
                          acc.status === "active"
                            ? "dash-status-pill-active"
                            : "dash-status-pill-inactive"
                        }`}
                      >
                        {acc.status === "active" ? "Active" : "Inactive"}
                      </span>
                    </div>

                    {acc.account_number && (
                      <div className="dash-account-number">{acc.account_number}</div>
                    )}

                    <div className="dash-account-footer">
                      <span className="dash-account-balance-label">Current Balance</span>
                      <strong
                        className={`dash-account-balance-amount ${
                          numBal >= 0 ? "dash-amount-pos" : "dash-amount-neg"
                        }`}
                      >
                        {acc.currency}{" "}
                        {numBal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </strong>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
      {canViewActivity && (
        <section className="dash-panel-card dash-recent-activity" aria-labelledby="recent-activity-title" aria-busy={activityLoading}>
          <div className="dash-panel-head">
            <div className="dash-panel-title-group">
              <h2 className="dash-panel-title" id="recent-activity-title"><LuHistory size={19} aria-hidden="true" /> Recent Activity</h2>
              <p className="dash-panel-sub">Latest system actions · Pakistan time</p>
            </div>
          </div>
          {activityLoading ? <p className="dash-activity-state" role="status">Loading recent activity…</p>
            : activityError ? <div className="dash-activity-state"><p className="error-text" role="alert">{activityError}</p><button type="button" className="btn-sm" onClick={() => setActivityRetry((value) => value + 1)}>Retry</button></div>
            : activity.length === 0 ? <p className="dash-activity-state">No activity yet.</p>
            : <ul className="dash-activity-list">
              {activity.map((item, index) => {
                const date = item.created_at ? new Date(item.created_at) : null;
                const validDate = date && Number.isFinite(date.getTime());
                return <li className="dash-activity-row" key={`${item.created_at}-${index}`}>
                  <div className="dash-activity-copy">
                    <span className="dash-activity-action">{item.action.replace(/_/g, " ")}</span>
                    <strong className="dash-activity-entity">{item.entity_type.replace(/_/g, " ")}{item.entity_id != null ? ` #${item.entity_id}` : ""}</strong>
                    <span className="dash-activity-user">By {item.full_name || "Deleted user"}</span>
                  </div>
                  {validDate ? <time className="dash-activity-time" dateTime={date.toISOString()}>{activityDateFormat.format(date)}</time> : <span className="dash-activity-time">Time unavailable</span>}
                </li>;
              })}
            </ul>}
        </section>
      )}
    </main>
  );
}
