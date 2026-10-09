import { useEffect, useRef, useState } from "react";
import {
  LuLayoutDashboard,
  LuCalendarCheck,
  LuUsers,
  LuBriefcase,
  LuFolderKanban,
  LuWallet,
  LuClipboardList,
  LuMail,
  LuSettings,
  LuLogOut,
  LuMenu,
  LuX,
  LuBell,
  LuTrendingUp,
  LuFileText,
} from "react-icons/lu";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Employees from "./pages/Employees";
import Clients from "./pages/Clients";
import Projects from "./pages/Projects";
import Finance from "./pages/Finance";
import PageTransition from "./components/PageTransition";
import Payroll from "./pages/Payroll";
import type { PayrollContext } from "./pages/Payroll";
import Settings, { PasswordForm } from "./pages/Settings";
import EmployeeDashboard from "./pages/EmployeeDashboard";
import EmployeeProjects from "./pages/EmployeeProjects";
import OfficialLetters from "./pages/OfficialLetters";
import PortalNotificationBell from "./components/PortalNotificationBell";
import SuperPasswordAuthorization from "./components/SuperPasswordAuthorization";
import Attendance from "./pages/Attendance";
import Applications from "./pages/Applications";
import Requests from "./pages/Requests";
import AttendanceAdminSection from "./pages/AttendanceAdminSection";
import ModeSelection from "./pages/ModeSelection";
import { api } from "./lib/api";
import type { AuthUser } from "./types/auth";
import { hasFrontendPermission } from "./permissions";
import ThemeToggle from "./components/ThemeToggle";
import ClientPortal from "./pages/ClientPortal";
import Email from "./pages/Email";
import { useNavigationNotifications } from "./hooks/useNavigationNotifications";

type Tab =
  | "dashboard"
  | "employees"
  | "clients"
  | "projects"
  | "finance"
  | "payroll"
  | "attendance"
  | "requests"
  | "email"
  | "leave"
  | "holidays"
  | "settings";

type EmployeeTab = "dashboard" | "attendance" | "applications" | "projects" | "settings" | "letters";
type FinanceShortcutFilter = "all" | "inflow" | "outflow";

const NAV_TABS: {
  id: Tab;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  permission?: "finance:manage";
}[] = [
  { id: "dashboard", label: "Dashboard", icon: LuLayoutDashboard },
  { id: "attendance", label: "Attendance", icon: LuCalendarCheck },
  { id: "employees", label: "Employees", icon: LuUsers },
  { id: "clients", label: "Clients", icon: LuBriefcase },
  { id: "projects", label: "Projects", icon: LuFolderKanban },
  { id: "finance", label: "Finance", icon: LuWallet, permission: "finance:manage" },
  { id: "payroll", label: "Payroll", icon: LuBriefcase, permission: "finance:manage" },
  { id: "requests", label: "Requests", icon: LuClipboardList },
  { id: "email", label: "Email", icon: LuMail },
];

const EMPLOYEE_NAV_TABS: {
  id: EmployeeTab;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}[] = [
  { id: "dashboard", label: "Dashboard", icon: LuLayoutDashboard },
  { id: "attendance", label: "Attendance", icon: LuCalendarCheck },
  { id: "applications", label: "Applications", icon: LuClipboardList },
  { id: "projects", label: "Projects", icon: LuFolderKanban },
  { id: "letters", label: "Official Letters", icon: LuFileText },
];

function UserIdentity({ user }: { user: AuthUser }) {
  const roleLabel =
    user.role === "super_admin"
      ? "Super Administrator"
      : user.mode === "employee"
      ? "Employee"
      : user.mode === "client"
      ? "Client"
      : "Administrator";

  return (
    <div className="app-topbar-user" aria-label={`Signed in as ${user.name}, ${roleLabel}`}>
      <span className="app-user-avatar" aria-hidden="true">
        {user.name.trim().charAt(0).toUpperCase()}
      </span>
      <div className="app-user-info">
        <span className="app-user-name">{user.name}</span>
        <span className="app-user-role">{roleLabel}</span>
      </div>
    </div>
  );
}

function NavigationLabel({ label, count = 0 }: { label: string; count?: number }) {
  return (
    <span className="navigation-label">
      <span>{label}</span>
      {count > 0 && <span className="navigation-badge" aria-label={`${count} unread`} />}
    </span>
  );
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTabState] = useState<Tab>(() => {
    const stored = sessionStorage.getItem("ems_tab");
    const saved = (stored === "chat" ? "email" : stored) as Tab | null;
    return saved === "leave" || saved === "holidays" ? "attendance" : saved ?? "dashboard";
  });
  const [employeeTab, setEmployeeTabState] = useState<EmployeeTab>(() => {
    const saved = sessionStorage.getItem("ems_employee_tab");
    if (saved === "chat") return "attendance";
    if (saved === "leave") return "applications";
    if (saved === "account") return "attendance";
    return (saved as EmployeeTab) ?? "attendance";
  });
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("ems_theme");
    if (saved === "light" || saved === "dark") return saved;
    return "light";
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [payrollFinance, setPayrollFinance] = useState<{ context?: PayrollContext; transactionId?: number; key: number } | null>(null);
  useEffect(() => { if (tab !== "finance") setPayrollFinance(null); }, [tab]);
  const [clientTab, setClientTab] = useState<"dashboard" | "invoices" | "progress">("dashboard");
  const [employeeShortcut, setEmployeeShortcut] = useState<{ status: string; key: number } | null>(
    null
  );
  const [financeShortcut, setFinanceShortcut] = useState<{
    filter: FinanceShortcutFilter;
    key: number;
  } | null>(null);
  const [financeInitialTab, setFinanceInitialTab] = useState<"transactions" | "accounts">(
    "transactions"
  );

  const sidebarRef = useRef<HTMLElement>(null);
  const toggleBtnRef = useRef<HTMLButtonElement>(null);
  const initialTabRef = useRef(tab);
  const initialEmployeeTabRef = useRef(employeeTab);
  const notifications = useNavigationNotifications(user);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("ems_theme", theme);
  }, [theme]);

  useEffect(() => {
    window.history.replaceState(
      {
        ...window.history.state,
        emsTab: initialTabRef.current,
        emsEmployeeTab: initialEmployeeTabRef.current,
      },
      "",
      window.location.href
    );
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as {
        emsTab?: Tab;
        emsEmployeeTab?: EmployeeTab;
        employeeStatus?: string;
        financeFilter?: FinanceShortcutFilter;
      } | null;
      if (state?.emsTab) {
        setTabState(state.emsTab);
        sessionStorage.setItem("ems_tab", state.emsTab);
        setEmployeeShortcut(
          state.employeeStatus ? { status: state.employeeStatus, key: Date.now() } : null
        );
        setFinanceShortcut(
          state.financeFilter ? { filter: state.financeFilter, key: Date.now() } : null
        );
      }
      if (state?.emsEmployeeTab) {
        setEmployeeTabState(state.emsEmployeeTab);
        sessionStorage.setItem("ems_employee_tab", state.emsEmployeeTab);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!user || user.mode === "client" || user.mode === "selection_required") return;
    const requestsOpen =
      user.mode === "employee" ? employeeTab === "applications" : tab === "requests";
    if (requestsOpen) void notifications.markRequestsRead();
  }, [user, tab, employeeTab, notifications.markRequestsRead]);

  function toggleTheme() {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  }

  function setTab(t: Tab) {
    if (t === "employees") setEmployeeShortcut(null);
    if (t === "finance") {
      setFinanceShortcut(null);
      setFinanceInitialTab("transactions");
    }
    sessionStorage.setItem("ems_tab", t);
    setTabState(t);
    window.history.pushState(
      { ...window.history.state, emsTab: t, employeeStatus: undefined, financeFilter: undefined },
      "",
      window.location.href
    );
  }

  function openEmployeesWithStatus(status: string) {
    setEmployeeShortcut({ status, key: Date.now() });
    sessionStorage.setItem("ems_tab", "employees");
    setTabState("employees");
    window.history.pushState(
      { ...window.history.state, emsTab: "employees", employeeStatus: status, financeFilter: undefined },
      "",
      window.location.href
    );
  }

  function openFinanceWithFilter(filter: FinanceShortcutFilter) {
    setFinanceInitialTab("transactions");
    setFinanceShortcut({ filter, key: Date.now() });
    sessionStorage.setItem("ems_tab", "finance");
    setTabState("finance");
    window.history.pushState(
      { ...window.history.state, emsTab: "finance", financeFilter: filter, employeeStatus: undefined },
      "",
      window.location.href
    );
  }

  function openFinanceWithAccounts() {
    setFinanceInitialTab("accounts");
    setFinanceShortcut(null);
    sessionStorage.setItem("ems_tab", "finance");
    setTabState("finance");
    window.history.pushState(
      { ...window.history.state, emsTab: "finance", financeFilter: undefined, employeeStatus: undefined },
      "",
      window.location.href
    );
  }

  function setEmployeeTab(nextTab: EmployeeTab) {
    sessionStorage.setItem("ems_employee_tab", nextTab);
    setEmployeeTabState(nextTab);
    window.history.pushState(
      { ...window.history.state, emsEmployeeTab: nextTab },
      "",
      window.location.href
    );
  }

  useEffect(() => {
    const token = sessionStorage.getItem("ems_token");
    if (!token) return setChecking(false);
    api<{ user: AuthUser }>("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => sessionStorage.removeItem("ems_token"))
      .finally(() => setChecking(false));
  }, []);

  // Accessibility: close sidebar on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSidebarOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Click outside to close sidebar
  useEffect(() => {
    if (!sidebarOpen) return;

    function handleClickOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node | null;
      if (!target) return;

      if (sidebarRef.current && sidebarRef.current.contains(target)) {
        return;
      }
      if (toggleBtnRef.current && toggleBtnRef.current.contains(target)) {
        return;
      }
      setSidebarOpen(false);
    }

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [sidebarOpen]);

  async function signOut() {
    try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch { /* Local logout still completes if offline. */ }
    sessionStorage.removeItem("ems_token");
    sessionStorage.removeItem("ems_tab");
    sessionStorage.removeItem("ems_employee_tab");
    setEmployeeTabState("attendance");
    setUser(null);
  }

  if (checking) return null;
  if (!user) return <Login onLogin={setUser} theme={theme} onToggleTheme={toggleTheme} />;

  if (user.requires_mode_selection || user.mode === "selection_required") {
    return <ModeSelection user={user} onSelected={setUser} onSignOut={signOut} />;
  }

  if (user.mode === "client" || user.role === "client") {
    return (
      <div className="app-layout client-app-layout">
        <div className={`app-backdrop ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />
        <aside id="client-main-sidebar" ref={sidebarRef} className={`app-sidebar ${sidebarOpen ? "drawer-open" : ""}`} aria-label="Client navigation">
          <div className="app-sidebar-inner">
            <div className="app-sidebar-brand">
              <img src="/logo.png" alt="Ashtech Digital Solutions" className="app-sidebar-logo" />
              <div className="app-sidebar-brand-text"><span className="app-sidebar-brand-name">Ashtech</span><span className="app-sidebar-brand-sub">Digital Solutions</span></div>
            </div>
            <nav className="app-sidebar-nav" aria-label="Client pages">
              {([{ id: "dashboard", label: "Dashboard", icon: LuLayoutDashboard }, { id: "invoices", label: "Invoices", icon: LuClipboardList }, { id: "progress", label: "Progress Updates", icon: LuTrendingUp }] as const).map((item) => {
                const Icon = item.icon;
                return <button key={item.id} type="button" className={`app-sidebar-item ${clientTab === item.id ? "active" : ""}`} aria-current={clientTab === item.id ? "page" : undefined} onClick={() => { setClientTab(item.id); setSidebarOpen(false); }}><span className="app-sidebar-icon"><Icon size={18} /></span><span>{item.label}</span></button>;
              })}
            </nav>
            <div className="app-sidebar-footer"><button type="button" className="app-sidebar-signout-btn" onClick={signOut}><LuLogOut size={16} /><span>Sign Out</span></button></div>
          </div>
        </aside>
        <div className="app-main-wrapper">
          <header className="app-topbar">
            <div className="app-topbar-left">
              <button ref={toggleBtnRef} type="button" className="app-hamburger-btn employee-menu-btn" onClick={() => setSidebarOpen((previous) => !previous)} aria-label={sidebarOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={sidebarOpen} aria-controls="client-main-sidebar">{sidebarOpen ? <LuX size={20} /> : <LuMenu size={20} />}</button>
<span className="app-portal-label">CLIENT PORTAL</span>
            </div>
            <div className="app-topbar-right"><PortalNotificationBell count={notifications.portalUnread} notices={notifications.letterNotifications} onRead={notifications.readEmailNotice} /><ThemeToggle theme={theme} onToggle={toggleTheme} compact /><UserIdentity user={user} /></div>
          </header>
          <PageTransition section={clientTab}><ClientPortal key={clientTab} view={clientTab} /></PageTransition>
        </div>
      </div>
    );
  }

  // Employee mode
  if (user.mode === "employee") {
    return (
      <div className="app-layout employee-app-layout">
        <div className={`app-backdrop ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />
        <aside id="employee-main-sidebar" ref={sidebarRef} className={`app-sidebar ${sidebarOpen ? "drawer-open" : ""}`} aria-label="Employee navigation">
          <div className="app-sidebar-inner">
            <div className="app-sidebar-brand">
              <img src="/logo.png" alt="Ashtech Digital Solutions" className="app-sidebar-logo" />
              <div className="app-sidebar-brand-text">
                <span className="app-sidebar-brand-name">Ashtech</span>
                <span className="app-sidebar-brand-sub">Digital Solutions</span>
              </div>
            </div>
            <nav className="app-sidebar-nav" aria-label="Employee pages">
              {EMPLOYEE_NAV_TABS.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.id} type="button" className={`app-sidebar-item ${employeeTab === item.id ? "active" : ""}`}
                    aria-current={employeeTab === item.id ? "page" : undefined}
                    onClick={() => { setEmployeeTab(item.id); setSidebarOpen(false); }}>
                    <span className="app-sidebar-icon"><Icon size={18} /></span>
                    <NavigationLabel label={item.label} count={item.id === "applications" ? notifications.requestUnread : item.id === "letters" ? notifications.letterUnread : 0} />
                  </button>
                );
              })}
            </nav>
            <div className="app-sidebar-footer">
              <button type="button" className={`app-sidebar-item ${employeeTab === "settings" ? "active" : ""}`} onClick={() => { setEmployeeTab("settings"); setSidebarOpen(false); }} aria-current={employeeTab === "settings" ? "page" : undefined}><span className="app-sidebar-icon"><LuSettings size={18} /></span><span>Settings</span></button>
              <button type="button" className="app-sidebar-signout-btn" onClick={signOut}><LuLogOut size={16} /><span>Sign Out</span></button>
            </div>
          </div>
        </aside>
        <div className="app-main-wrapper">
          <header className="app-topbar">
            <div className="app-topbar-left">
              <button ref={toggleBtnRef} type="button" className="app-hamburger-btn employee-menu-btn"
                onClick={() => setSidebarOpen((previous) => !previous)}
                aria-label={sidebarOpen ? "Close navigation menu" : "Open navigation menu"}
                aria-expanded={sidebarOpen} aria-controls="employee-main-sidebar">
                {sidebarOpen ? <LuX size={20} /> : <LuMenu size={20} />}
              </button>
<span className="app-portal-label">EMPLOYEE PORTAL</span>
            </div>
            <div className="app-topbar-right">
              <PortalNotificationBell count={notifications.portalUnread} notices={notifications.letterNotifications} onRead={notifications.readEmailNotice} onLetter={() => setEmployeeTab("letters")} />
              <ThemeToggle theme={theme} onToggle={toggleTheme} compact />
              <UserIdentity user={user} />
            </div>
          </header>
          <PageTransition section={employeeTab}>
          {employeeTab === "dashboard" && <EmployeeDashboard user={user} />}
          {employeeTab === "attendance" && <Attendance />}
          {employeeTab === "applications" && <Applications />}
          {employeeTab === "projects" && <EmployeeProjects />}
          {employeeTab === "letters" && <OfficialLetters />}
          {employeeTab === "settings" && <main className="content"><div className="content-head"><h1 className="page-title">Settings</h1></div><section className="employee-security-section"><PasswordForm title="Change Password" endpoint="/api/settings/change-login-password" note="Change the password you use to sign in to the employee portal." /></section></main>}
          </PageTransition>
        </div>
      </div>
    );
  }

  const canManageFinance = hasFrontendPermission(user.role, "finance:manage");
  const navigationTabs = NAV_TABS.filter(
    (item) => !item.permission || hasFrontendPermission(user.role, item.permission)
  );
  const effectiveTab = (tab === "finance" || tab === "payroll") && !canManageFinance ? "dashboard" : tab;

  return (
    <div className="app-layout">
      <SuperPasswordAuthorization />
      {/* Mobile Drawer Backdrop */}
      <div
        className={`app-backdrop ${sidebarOpen ? "open" : ""}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* 2. FIXED LEFT SIDEBAR (Desktop) & LEFT DRAWER (Mobile) */}
      <aside
        id="app-main-sidebar"
        ref={sidebarRef}
        className={`app-sidebar ${sidebarOpen ? "drawer-open" : ""}`}
        aria-label="Main Navigation"
      >
        <div className="app-sidebar-inner">
          {/* Top Brand Block */}
          <div className="app-sidebar-brand">
            <img
              src="/logo.png"
              alt="Ashtech Digital Solutions"
              className="app-sidebar-logo"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <div className="app-sidebar-brand-text">
              <span className="app-sidebar-brand-name">Ashtech</span>
              <span className="app-sidebar-brand-sub">Digital Solutions</span>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="app-sidebar-nav" aria-label="Main Pages">
            {navigationTabs.map((t) => {
              const Icon = t.icon;
              const count =
                t.id === "requests"
                  ? notifications.requestUnread
                  : 0;
              const isActive = effectiveTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`app-sidebar-item ${isActive ? "active" : ""}`}
                  onClick={() => {
                    setTab(t.id);
                    setSidebarOpen(false);
                  }}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className="app-sidebar-icon">
                    <Icon size={18} />
                  </span>
                  <span>{t.label}</span>
                  {count > 0 && <span className="app-sidebar-badge">{count}</span>}
                </button>
              );
            })}
          </nav>

          {/* Footer Controls: Settings & Sign Out */}
          <div className="app-sidebar-footer">
            <button
              type="button"
              className={`app-sidebar-item ${tab === "settings" ? "active" : ""}`}
              onClick={() => {
                setTab("settings");
                setSidebarOpen(false);
              }}
            >
              <span className="app-sidebar-icon">
                <LuSettings size={18} />
              </span>
              <span>Settings</span>
            </button>
            <button
              type="button"
              className="app-sidebar-signout-btn"
              onClick={() => {
                setSidebarOpen(false);
                signOut();
              }}
            >
              <LuLogOut size={16} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area Wrapper */}
      <div className="app-main-wrapper">
        {/* 3. TOP UTILITY HEADER */}
        <header className="app-topbar">
          <div className="app-topbar-left">
            {/* Mobile Hamburger on TOP-LEFT */}
            <button
              ref={toggleBtnRef}
              type="button"
              className="app-hamburger-btn"
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label={sidebarOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={sidebarOpen}
              aria-controls="app-main-sidebar"
            >
              {sidebarOpen ? <LuX size={20} /> : <LuMenu size={20} />}
            </button>

            <span className="app-portal-label">ADMIN PORTAL</span>
          </div>

          <div className="app-topbar-right">
            <button
              type="button"
              className="app-icon-action-btn"
              onClick={() => setTab("requests")}
              title="Notifications & Requests"
              aria-label="Notifications"
            >
              <LuBell size={18} />
              {notifications.requestUnread > 0 && <span className="app-notification-dot" />}
            </button>
            <ThemeToggle theme={theme} onToggle={toggleTheme} compact />
            <UserIdentity user={user} />
          </div>
        </header>

        {/* Tab Pages */}
        <PageTransition section={effectiveTab}>
        {effectiveTab === "dashboard" && (
          <Dashboard
            role={user.role}
            userName={user.name}
            onOpenEmployees={openEmployeesWithStatus}
            onOpenFinance={openFinanceWithFilter}
            onOpenFinanceAccounts={openFinanceWithAccounts}
            onOpenClients={() => setTab("clients")}
            onOpenProjects={() => setTab("projects")}
          />
        )}
        {effectiveTab === "employees" && (
          <Employees
            currentUserRole={user.role}
            onOpenSettings={() => setTab("settings")}
            initialStatus={employeeShortcut?.status}
            navigationKey={employeeShortcut?.key}
          />
        )}
        {effectiveTab === "clients" && <Clients canAccessFinance={canManageFinance} />}
        {effectiveTab === "projects" && <Projects canAccessFinance={canManageFinance} />}
        {effectiveTab === "finance" && canManageFinance && (
          <Finance
            key={payrollFinance?.key ?? "finance"}
            payrollContext={payrollFinance?.context}
            initialTransactionId={payrollFinance?.transactionId}
            initialTransactionFilter={financeShortcut?.filter}
            navigationKey={financeShortcut?.key}
            initialTab={financeInitialTab}
          />
        )}
        {effectiveTab === "payroll" && canManageFinance && <Payroll onPay={context => { setFinanceInitialTab("transactions"); setPayrollFinance({ context, key: Date.now() }); setTab("finance"); }} onView={transactionId => { setFinanceInitialTab("transactions"); setPayrollFinance({ transactionId, key: Date.now() }); setTab("finance"); }} />}
        {effectiveTab === "attendance" && (
          <AttendanceAdminSection
            onOpenPendingLeave={() => setTab("requests")}
            onOpenSettings={() => setTab("settings")}
          />
        )}
        {effectiveTab === "requests" && <Requests />}
        {effectiveTab === "email" && <Email />}
        {effectiveTab === "settings" && <Settings role={user.role} />}
        </PageTransition>
      </div>
    </div>
  );
}
