import { useEffect, useMemo, useRef, useState } from "react";
import type { PayrollContext } from "./Payroll";
import { api, authenticatedBlobUrl, downloadPdf, downloadFile, openAuthenticatedFile, superPasswordHeaders, hasSuperAuthorization } from "../lib/api";
import IconButton from "../components/IconButton";
import {
  LuWallet,
  LuCircleCheck,
  LuCirclePause,
  LuArrowLeft,
  LuArrowLeftRight,
  LuChevronDown,
  LuPlus,
  LuSearch,
  LuPencil,
  LuTrash2,
  LuPlay,
  LuPause,
  LuArrowDownToLine,
  LuArrowUpFromLine,
  LuTrendingUp,
  LuReceipt,
  LuLandmark,
} from "react-icons/lu";

type Category = { id: number; type: "inflow" | "outflow"; name: string };
export type FinanceAccount = {
  id: number;
  account_name: string;
  bank_name: string | null;
  account_number: string | null;
  account_type: "bank" | "cash" | "digital" | "other";
  currency: string;
  initial_balance: number;
  status: "active" | "inactive";
  current_balance: number | null;
  transaction_count: number;
  created_at: string;
  updated_at: string;
};
type AccountHistoryEntry = {
  id: number;
  source: "transaction" | "transfer";
  entry_date: string;
  invoice_number: string | null;
  description: string | null;
  type: "inflow" | "outflow";
  amount: number;
  currency: string;
  amount_pkr: number;
  account_amount: number | null;
  account_exchange_rate: string | null;
  balance_change: number;
  resulting_balance: number | null;
  client_name: string | null;
  project_name: string | null;
  from_account_name?: string;
  to_account_name?: string;
};
type AccountHistoryResult = { account: FinanceAccount; history: AccountHistoryEntry[] };
function accountMoney(value: number | null): string {
  return value === null ? "Needs historical account rate" : Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export type Txn = {
  id: number;
  transaction_id: string | null;
  project_applied_amount: string | null;
  project_applied_currency: string | null;
  project_exchange_rate: string | null;
  invoice_number: string | null;
  invoice_sequence: number | null;
  invoice_issue_date: string | null;
  invoice_currency: string | null;
  invoice_subtotal: number | null;
  invoice_tax_rate: number | null;
  invoice_tax_amount: number | null;
  invoice_tax_applied: boolean | number | null;
  invoice_total: number | null;
  type: "inflow" | "outflow";
  txn_date: string;
  description: string | null;
  amount: number;
  currency: string;
  exchange_rate: number;
  amount_pkr: number;
  payment_method: string;
  account_id: number | null;
  sender_bank_name: string | null;
  sender_account_number: string | null;
  account_name: string | null;
  receiving_bank_name: string | null;
  fa_type: string | null;
  category: string;
  custom_category: string | null;
  salary_base_amount: number | null;
  salary_bonus_amount: number | null;
  client_name: string | null;
  project_name: string | null;
  employee_name: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  invoice_path: string | null;
  created_at: string;
  created_by: number;
  created_by_name: string | null;
};
type Opt = { id: number; label: string };
type ProjectOpt = Opt & { client_id: number; project_value: number | null; sales_tax_percent: number | null; tax_amount: number; total_payable: number; total_paid: number; remaining_balance: number; value_currency: string };
type SalaryEmployee = { id: number; employee_code: string; full_name: string; salary_currency: string; final_salary: number };

const CURRENCIES = ["PKR", "USD", "AED", "EUR", "GBP", "SAR", "CAD"];
const PAK_BANKS = [
  "UBL",
  "HBL",
  "Bank Alfalah",
  "Meezan Bank",
  "MCB",
  "Allied Bank",
  "Faysal Bank",
  "Standard Chartered",
  "Askari Bank",
  "Bank of Punjab",
  "Other",
];

const emptyForm = {
  type: "inflow",
  category_id: "",
  description: "",
  txn_date: "",
  amount: "",
  currency: "PKR",
  custom_currency_code: "",
  currency_name: "",
  transaction_id: "",
  project_exchange_rate: "",
  account_exchange_rate: "",
  payroll_period: "",
  exchange_rate: "",
  payment_method: "bank_transfer",
  account_id: "",
  account_number: "",
  sender_bank_select: "UBL",
  custom_sender_bank: "",
  client_id: "",
  project_id: "",
  custom_category: "",
  employee_id: "",
  bonus: "0",
};

const emptyAccountForm = {
  account_name: "",
  bank_name_select: "UBL",
  custom_bank_name: "",
  bank_name: "UBL",
  account_number: "",
  account_type: "bank" as "bank" | "cash" | "digital" | "other",
  currency: "PKR",
  initial_balance: "0",
  status: "active" as "active" | "inactive",
};

const emptyTransferForm = {
  from_account_id: "",
  to_account_id: "",
  amount: "",
  transfer_date: "",
  description: "",
};

export default function Finance({ initialTransactionFilter, navigationKey, initialTab, payrollContext, initialTransactionId }: { initialTransactionFilter?: "all" | "inflow" | "outflow"; navigationKey?: number; initialTab?: "transactions" | "accounts"; payrollContext?: PayrollContext; initialTransactionId?: number }) {
  const [txns, setTxns] = useState<Txn[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [clients, setClients] = useState<Opt[]>([]);
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [salaryEmployees, setSalaryEmployees] = useState<SalaryEmployee[]>([]);
  const payrollPrepared = useRef(false);
  const [activeTab, setActiveTab] = useState<"transactions" | "accounts">(initialTab || "transactions");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [generateInvoice, setGenerateInvoice] = useState(false);
  const [selectedTxn, setSelectedTxn] = useState<Txn | null>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [invoiceMenuOpen, setInvoiceMenuOpen] = useState(false);
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [invoiceUrl, setInvoiceUrl] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterType, setFilterType] = useState<"all" | "inflow" | "outflow">("all");
  const [filterClient, setFilterClient] = useState("");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [periodFilter, setPeriodFilter] = useState("all_time");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [revealPass, setRevealPass] = useState("");
  const [gating, setGating] = useState(false);

  // ── Account management state ─────────────────────────────────────────────
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [accountForm, setAccountForm] = useState({ ...emptyAccountForm });
  const [accountError, setAccountError] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [pendingDeleteAccountId, setPendingDeleteAccountId] = useState<number | null>(null);
  const [pendingToggleAccountId, setPendingToggleAccountId] = useState<number | null>(null);
  const [pendingToggleTargetStatus, setPendingToggleTargetStatus] = useState<"active" | "inactive" | null>(null);
  const [accountGateOpen, setAccountGateOpen] = useState(false);
  const [accountGatePass, setAccountGatePass] = useState("");
  const [accountGating, setAccountGating] = useState(false);
  const [accountGateAction, setAccountGateAction] = useState<"edit" | "delete" | "toggle_status">("edit");
  const [accountSortOrder, setAccountSortOrder] = useState<"desc" | "asc">("desc");
  const [accountSearch, setAccountSearch] = useState("");
  const [selectedAccountHistory, setSelectedAccountHistory] = useState<AccountHistoryResult | null>(null);
  const [accountHistoryLoading, setAccountHistoryLoading] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [transferForm, setTransferForm] = useState({ ...emptyTransferForm });
  const [transferError, setTransferError] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [txnSortOrder] = useState<"desc" | "asc">("desc");

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
    if (initialTransactionFilter) {
      setActiveTab("transactions");
      setFilterType(initialTransactionFilter);
      setSelectedTxn(null);
    }
  }, [initialTab, initialTransactionFilter, navigationKey]);

  const today = new Date().toLocaleDateString("en-CA");
  useEffect(() => {
    if (!payrollContext || payrollPrepared.current || !categories.length || !salaryEmployees.length) return;
    const employee = salaryEmployees.find(item => item.id === payrollContext.employeeId);
    const category = categories.find(item => item.type === "outflow" && item.name === "salary");
    if (!employee || !category) { setError("Payroll salary/category is no longer available. Reload Payroll."); return; }
    const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type: string) => dateParts.find(item => item.type === type)?.value;
    const period = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "Asia/Karachi" }).format(new Date(`${payrollContext.period}T00:00:00Z`));
    const knownCurrency = ["PKR", "USD", "EUR", "GBP", "CAD"].includes(employee.salary_currency);
    setForm({ ...emptyForm, type: "outflow", category_id: String(category.id), employee_id: String(employee.id), amount: String(employee.final_salary), currency: knownCurrency ? employee.salary_currency : "Other", custom_currency_code: knownCurrency ? "" : employee.salary_currency, currency_name: knownCurrency ? "" : employee.salary_currency,
      payroll_period: payrollContext.period, txn_date: `${part("year")}-${part("month")}-${part("day")}`, description: `Salary - ${period} - ${employee.full_name} (${employee.employee_code})` });
    setActiveTab("transactions"); setShowForm(true); payrollPrepared.current = true;
  }, [payrollContext, categories, salaryEmployees]);
  useEffect(() => {
    if (!initialTransactionId) return;
    let active = true;
    api<{ transaction: Txn }>(`/api/finance/transactions/${initialTransactionId}`).then(data => { if (active) setSelectedTxn(data.transaction); }).catch((caught: Error) => { if (active) setError(caught.message); });
    return () => { active = false; };
  }, [initialTransactionId]);

  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    e.currentTarget.blur();
  };

  async function load(search = "") {
    const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
    const t = await api<{ transactions: Txn[] }>(`/api/finance/transactions${query}`);
    setTxns(t.transactions);
    // If a transaction is currently selected, refresh its data as well
    if (selectedTxn) {
      const refreshed = t.transactions.find((item) => item.id === selectedTxn.id);
      if (refreshed) {
        setSelectedTxn(refreshed);
      }
    }
  }

  async function loadAccounts() {
    const d = await api<{ accounts: FinanceAccount[] }>("/api/finance/accounts");
    setAccounts(d.accounts);
  }

  async function openAccountHistory(accountId: number) {
    setAccountHistoryLoading(true);
    setAccountError("");
    try {
      setSelectedAccountHistory(await api<AccountHistoryResult>(`/api/finance/accounts/${accountId}/history`));
    } catch (caught: any) {
      setAccountError(caught.message || "Unable to load account history");
    } finally {
      setAccountHistoryLoading(false);
    }
  }

  async function submitTransfer() {
    setTransferError("");
    const fromId = Number(transferForm.from_account_id);
    const toId = Number(transferForm.to_account_id);
    const amount = Number(transferForm.amount);
    if (!fromId || !toId) return setTransferError("From and To accounts are required");
    if (fromId === toId) return setTransferError("From and To accounts must be different");
    if (!Number.isFinite(amount) || amount <= 0) return setTransferError("Amount must be greater than 0");
    if (!transferForm.transfer_date) return setTransferError("Transfer date is required");
    setTransferring(true);
    try {
      await api("/api/finance/accounts/transfers", {
        method: "POST",
        body: JSON.stringify({
          from_account_id: fromId,
          to_account_id: toId,
          amount,
          transfer_date: transferForm.transfer_date,
          description: transferForm.description.trim() || null,
        }),
      });
      setTransferForm({ ...emptyTransferForm });
      setShowTransferForm(false);
      await loadAccounts();
    } catch (caught: any) {
      setTransferError(caught.message || "Unable to transfer funds");
    } finally {
      setTransferring(false);
    }
  }

  useEffect(() => {
    Promise.all([
      load(),
      loadAccounts(),
      api<{ categories: Category[] }>("/api/finance/categories").then((d) => setCategories(d.categories)),
      api<{ clients: any[] }>("/api/clients").then((d) => setClients(d.clients.map((c) => ({ id: c.id, label: c.company_name })))),
      api<{ projects: Array<{ id: number; name: string; client_id: number; project_value: number | null; sales_tax_percent: number | null; tax_amount: number; total_payable: number; total_paid: number; remaining_balance: number; value_currency: string }> }>("/api/projects")
        .then((d) => setProjects(d.projects.map((p) => ({
          id: p.id,
          label: p.name,
          client_id: p.client_id,
          project_value: p.project_value,
          sales_tax_percent: p.sales_tax_percent,
          tax_amount: p.tax_amount,
          total_payable: p.total_payable,
          total_paid: p.total_paid,
          remaining_balance: p.remaining_balance,
          value_currency: p.value_currency,
        })))),
      api<{ employees: SalaryEmployee[] }>("/api/finance/salary-employees").then((d) => setSalaryEmployees(d.employees)),
    ]).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    let active = true;
    const objectUrls: string[] = [];
    setAttachmentUrl("");
    setInvoiceUrl("");
    const loadPreview = async (path: string, setter: (value: string) => void) => {
      try {
        const url = await authenticatedBlobUrl(path);
        if (!active) return URL.revokeObjectURL(url);
        objectUrls.push(url);
        setter(url);
      } catch { /* Document actions surface their own errors. */ }
    };
    if (selectedTxn?.attachment_name) void loadPreview(`/api/finance/transactions/${selectedTxn.id}/attachment`, setAttachmentUrl);
    if (selectedTxn?.invoice_path) void loadPreview(`/api/finance/transactions/${selectedTxn.id}/invoice?preview=1`, setInvoiceUrl);
    return () => {
      active = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [selectedTxn?.id, selectedTxn?.attachment_name, selectedTxn?.invoice_path]);

  const clientProjects = useMemo(
    () => projects.filter((project) => String(project.client_id) === form.client_id),
    [projects, form.client_id],
  );
  const selectedProject = useMemo(
    () => projects.find((project) => String(project.id) === form.project_id) ?? null,
    [projects, form.project_id],
  );
  const selectedCategory = categories.find((category) => String(category.id) === form.category_id) ?? null;
  const selectedFinanceAccount = accounts.find(account => String(account.id) === form.account_id) ?? null;
  const transactionCurrency = form.currency === "Other" ? form.custom_currency_code.trim().toUpperCase() : form.currency;
  const requiresAccountRate = !!selectedFinanceAccount && selectedFinanceAccount.currency !== transactionCurrency && selectedFinanceAccount.currency !== "PKR";
  const isClientPayment = form.type === "inflow" && selectedCategory?.name === "client_payment";
  const isOtherCategory = selectedCategory?.name === "other_income" || selectedCategory?.name === "other_expense" || selectedCategory?.name === "other";
  const isSalary = form.type === "outflow" && selectedCategory?.name === "salary";
  const selectedSalaryEmployee = salaryEmployees.find((employee) => String(employee.id) === form.employee_id) ?? null;
  const salaryTotal = isSalary && selectedSalaryEmployee
    ? Number(selectedSalaryEmployee.final_salary) + Math.max(0, Number(form.bonus) || 0)
    : null;

  function set(key: keyof typeof emptyForm, value: string) {
    setForm((f) => ({ ...f, [key]: value, ...(key === "account_id" || key === "currency" || key === "custom_currency_code" ? { account_exchange_rate: "" } : {}) }));
  }

  const pkrPreview = useMemo(() => {
    const amt = salaryTotal ?? Number(form.amount);
    if (!amt || isNaN(amt) || amt <= 0) return null;
    if (form.currency === "PKR" || (form.currency === "Other" && form.custom_currency_code.trim().toUpperCase() === "PKR")) return amt;
    const rate = Number(form.exchange_rate);
    if (!rate || isNaN(rate) || rate <= 0) return null;
    return amt * rate;
  }, [form.amount, form.currency, form.custom_currency_code, form.exchange_rate, salaryTotal]);

  async function save() {
    setError("");
    if (!form.category_id || !form.txn_date || form.amount === "") {
      return setError("Category, date, and amount are required");
    }
    if (!form.account_id) return setError(form.type === "inflow" ? "Receiving EMS Account is required" : "Pay From EMS Account is required");
    if (requiresAccountRate && (!/^\d{1,8}(?:\.\d{1,4})?$/.test(form.account_exchange_rate) || Number(form.account_exchange_rate) <= 0)) return setError("Finance Account exchange rate must be positive with up to four decimal places");
    if (isOtherCategory && !form.custom_category.trim()) return setError("Specify Category is required");
    if (isClientPayment && (!form.client_id || !form.project_id)) return setError("Client and project are required for a client payment");
    if (isSalary && !selectedSalaryEmployee) return setError("Select an employee with configured salary information");
    if (form.txn_date > today) {
      return setError("Transaction date cannot be in the future");
    }
    const numAmt = Number(form.amount);
    if (isNaN(numAmt) || !isFinite(numAmt) || numAmt <= 0) {
      return setError("Amount must be a valid positive number");
    }
    const currencyCode = form.currency === "Other" ? form.custom_currency_code.trim().toUpperCase() : form.currency;
    if (!/^[A-Z]{3}$/.test(currencyCode)) return setError("Enter a three-letter currency code");
    if (form.currency === "Other" && !form.currency_name.trim()) return setError("Currency Name is required");
    if (currencyCode !== "PKR") {
      const numRate = Number(form.exchange_rate);
      if (!form.exchange_rate || isNaN(numRate) || !isFinite(numRate) || numRate <= 0) {
        return setError("Exchange rate is required and must be a positive number for non-PKR amounts");
      }
    }
    if (isClientPayment) {
      if (!selectedProject?.project_value || Number(selectedProject.project_value) <= 0) return setError("The selected project must have a valid Project Value");
      const sameCurrency = currencyCode === selectedProject.value_currency;
      const targetRate = selectedProject.value_currency === "PKR" ? 1 : Number(form.project_exchange_rate);
      if (!sameCurrency && (!Number.isFinite(targetRate) || targetRate <= 0)) return setError("A valid project exchange rate to PKR is required");
      const sourceRate = currencyCode === "PKR" ? 1 : Number(form.exchange_rate);
      const appliedAmount = sameCurrency ? numAmt : Math.round((Math.round(numAmt * sourceRate * 100) / 100) / targetRate * 100) / 100;
      if (appliedAmount <= 0) return setError("Payment rounds to zero in project currency");
      if (appliedAmount > Number(selectedProject.remaining_balance)) return setError(`Applied payment cannot exceed the remaining balance of ${selectedProject.value_currency} ${Number(selectedProject.remaining_balance).toFixed(2)}`);
    }
    if (form.type === "inflow" && form.payment_method === "bank_transfer") {
      const senderBank = form.sender_bank_select === "Other" ? form.custom_sender_bank.trim() : form.sender_bank_select;
      if (!senderBank) return setError("Sender Bank is required for a bank transfer");
      if (!form.account_number.trim()) return setError("Client/Sender Account Number is required for a bank transfer");
    }

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("type", form.type);
      fd.append("category_id", String(Number(form.category_id)));
      fd.append("txn_date", form.txn_date);
      fd.append("amount", String(Number(form.amount)));
      fd.append("currency", currencyCode);
      if (form.currency === "Other") fd.append("currency_name", form.currency_name.trim());
      if (form.transaction_id.trim()) fd.append("transaction_id", form.transaction_id.trim());
      fd.append("exchange_rate", String(currencyCode === "PKR" ? 1 : Number(form.exchange_rate)));
      fd.append("payment_method", form.payment_method);
      if (isClientPayment && form.project_exchange_rate) fd.append("project_exchange_rate", form.project_exchange_rate);
      if (form.description) fd.append("description", form.description);
      if (form.account_id) fd.append("account_id", form.account_id);
      if (requiresAccountRate) fd.append("account_exchange_rate", form.account_exchange_rate);
      if (isSalary && form.payroll_period) fd.append("payroll_period", form.payroll_period);
      if (form.client_id) fd.append("client_id", form.client_id);
      if (form.project_id) fd.append("project_id", form.project_id);
      if (isOtherCategory) fd.append("custom_category", form.custom_category.trim());
      if (isSalary && selectedSalaryEmployee) {
        fd.append("employee_id", String(selectedSalaryEmployee.id));
        fd.append("bonus", String(Math.max(0, Number(form.bonus) || 0)));
      }
      // Transaction-specific client/sender account number. Receiving account details come from account_id.
      if (form.type === "inflow" && form.payment_method === "bank_transfer") {
        const senderBank = form.sender_bank_select === "Other" ? form.custom_sender_bank.trim() : form.sender_bank_select;
        fd.append("sender_bank_name", senderBank);
        if (form.account_number.trim()) fd.append("account_number", form.account_number.trim());
      }
      if (attachmentFile) fd.append("attachment", attachmentFile);
      fd.append("generate_invoice", generateInvoice ? "true" : "false");

      await api("/api/finance/transactions", {
        method: "POST",
        body: fd,
      });

      setForm({ ...emptyForm });
      setAttachmentFile(null);
      setAttachmentError("");
      setGenerateInvoice(false);
      setShowForm(false);
      await Promise.all([load(invoiceSearch), loadAccounts()]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const accountBalancesByCurrency = useMemo(() => {
    const totals = new Map<string, number | null>();
    for (const account of accounts) {
      const currency = account.currency;
      const previous = totals.get(currency) ?? 0;
      totals.set(currency, totals.has(currency) && totals.get(currency) === null || account.current_balance === null
        ? null : Math.round((previous + Number(account.current_balance)) * 100) / 100);
    }
    return Array.from(totals, ([currency, balance]) => ({ currency, balance })).sort((a, b) => a.currency === "PKR" ? -1 : b.currency === "PKR" ? 1 : a.currency.localeCompare(b.currency));
  }, [accounts]);

  // ── Account CRUD helpers ──────────────────────────────────────────────────
  function handleAccountBankChange(bank: string) {
    setAccountForm((current) => ({
      ...current,
      bank_name_select: bank,
      custom_bank_name: bank === "Other" ? current.custom_bank_name : "",
      bank_name: bank === "Other" ? current.custom_bank_name : bank,
    }));
  }

  function openNewAccountForm() {
    setEditingAccountId(null);
    setAccountForm({ ...emptyAccountForm });
    setAccountError("");
    setShowAccountForm(true);
  }

  async function openEditAccountGate(acc: FinanceAccount) {
    const bankName = acc.bank_name ?? "";
    const isPresetBank = PAK_BANKS.includes(bankName) && bankName !== "Other";
    setEditingAccountId(acc.id);
    setAccountForm({
      account_name: acc.account_name,
      bank_name_select: bankName ? (isPresetBank ? bankName : "Other") : "UBL",
      custom_bank_name: bankName && !isPresetBank ? bankName : "",
      bank_name: bankName,
      account_number: acc.account_number ?? "",
      account_type: acc.account_type === "cash" ? "cash" : "bank",
      currency: acc.currency,
      initial_balance: String(acc.initial_balance),
      status: acc.status,
    });
    setAccountError("");
    setAccountGateAction("edit");
    if (await hasSuperAuthorization()) { setShowAccountForm(true); return; }
    setAccountGateOpen(true);
  }

  async function toggleAccountStatus(acc: FinanceAccount) {
    const newStatus = acc.status === "active" ? "inactive" : "active";
    setAccountError("");
    setPendingToggleAccountId(acc.id);
    setPendingToggleTargetStatus(newStatus);
    if (await hasSuperAuthorization()) { await doToggleAccountStatus(acc.id, newStatus, ""); return; }
    setAccountGateAction("toggle_status");
    setAccountGateOpen(true);
  }

  async function doToggleAccountStatus(id: number, status: "active" | "inactive", superPassword: string) {
    try {
      await api(`/api/finance/accounts/${id}`, {
        method: "PUT",
        headers: superPasswordHeaders(superPassword),
        body: JSON.stringify({ status }),
      });
      setPendingToggleAccountId(null);
      setPendingToggleTargetStatus(null);
      await loadAccounts();
    } catch (e: any) {
      setAccountGatePass("");
      setAccountError(e.message);
    }
  }

  async function openDeleteAccountGate(id: number) {
    if (await hasSuperAuthorization()) { await doDeleteAccount(id, ""); return; }
    setPendingDeleteAccountId(id);
    setAccountGateAction("delete");
    setAccountGateOpen(true);
  }

  async function submitAccountGate() {
    if (!accountGatePass) return setAccountError("Enter the Super Password");
    setAccountGating(true);
    setAccountError("");
    try {
      await api("/api/security/super-password/verify", {
        method: "POST",
        body: JSON.stringify({ password: accountGatePass }),
      });
      setAccountGateOpen(false);
      setAccountGatePass("");
      if (accountGateAction === "edit") {
        setShowAccountForm(true);
      } else if (accountGateAction === "delete" && pendingDeleteAccountId) {
        await doDeleteAccount(pendingDeleteAccountId, accountGatePass);
        setAccountGatePass("");
      } else if (accountGateAction === "toggle_status" && pendingToggleAccountId && pendingToggleTargetStatus) {
        await doToggleAccountStatus(pendingToggleAccountId, pendingToggleTargetStatus, accountGatePass);
        setAccountGatePass("");
      }
    } catch (e: any) {
      setAccountGatePass("");
      setAccountError(e.message);
    } finally {
      setAccountGating(false);
    }
  }

  async function saveAccount() {
    setAccountError("");
    const finalName = accountForm.account_name.trim();
    if (!finalName) return setAccountError("Account name is required");
    const { account_type, currency, initial_balance, account_number, status } = accountForm;
    if (!account_type) return setAccountError("Account type is required");
    const initBal = Number(initial_balance);
    if (isNaN(initBal)) return setAccountError("Initial balance must be a valid number");
    const bankName = account_type === "bank"
      ? (accountForm.bank_name_select === "Other" ? accountForm.custom_bank_name.trim() : accountForm.bank_name_select)
      : accountForm.bank_name.trim();

    setSavingAccount(true);
    try {
      const payload = {
        account_name: finalName,
        bank_name: bankName || null,
        account_number: account_number.trim() || null,
        account_type,
        currency: currency.toUpperCase(),
        initial_balance: initBal,
        status,
      };
      if (editingAccountId) {
        await api(`/api/finance/accounts/${editingAccountId}`, {
          method: "PUT",
          headers: superPasswordHeaders(accountGatePass),
          body: JSON.stringify(payload),
        });
      } else {
        await api("/api/finance/accounts", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      setShowAccountForm(false);
      setEditingAccountId(null);
      setAccountForm({ ...emptyAccountForm });
      setAccountGatePass("");
      await loadAccounts();
    } catch (e: any) {
      setAccountError(e.message);
    } finally {
      setSavingAccount(false);
    }
  }

  async function doDeleteAccount(id: number, superPassword: string) {
    if (!confirm("Delete this account? This action cannot be undone.")) {
      setPendingDeleteAccountId(null);
      return;
    }
    setAccountError("");
    try {
      await api(`/api/finance/accounts/${id}`, {
        method: "DELETE",
        headers: superPasswordHeaders(superPassword),
      });
      setPendingDeleteAccountId(null);
      await loadAccounts();
    } catch (e: any) {
      setAccountError(e.message);
    }
  }

  function setAccForm(key: keyof typeof emptyAccountForm, value: string) {
    setAccountForm((f) => ({ ...f, [key]: value }));
  }

  async function requestDelete(id: number) {
    setError("");
    if (await hasSuperAuthorization()) { await doDelete(id, ""); return; }
    setPendingDeleteId(id);
    setGateOpen(true);
  }

  async function submitGate() {
    if (!revealPass) return setError("Enter the Super Password");
    setGating(true);
    setError("");
    try {
      await api("/api/security/super-password/verify", {
        method: "POST",
        body: JSON.stringify({ password: revealPass }),
      });
      setGateOpen(false);
      if (pendingDeleteId) await doDelete(pendingDeleteId, revealPass);
      setRevealPass("");
    } catch (e: any) {
      setRevealPass("");
      setError(e.message);
    } finally {
      setGating(false);
    }
  }

  async function doDelete(id: number, superPassword: string) {
    if (!confirm("Delete this transaction? This will be recorded in the audit log.")) {
      setPendingDeleteId(null);
      return;
    }
    setError("");
    try {
      await api(`/api/finance/transactions/${id}`, {
        method: "DELETE",
        headers: superPasswordHeaders(superPassword),
      });
      setPendingDeleteId(null);
      if (selectedTxn && selectedTxn.id === id) {
        setSelectedTxn(null);
      }
      await Promise.all([load(), loadAccounts()]);
    } catch (e: any) {
      setError(e.message);
    }
  }

  function handleDownloadPdf() {
    let params = "";
    let label = "all";
    if (periodFilter === "this_month") {
      params = "?period=this_month";
      label = "this-month";
    } else if (periodFilter === "last_month") {
      params = "?period=last_month";
      label = "last-month";
    } else if (periodFilter === "this_quarter") {
      params = "?period=this_quarter";
      label = "this-quarter";
    } else if (periodFilter === "custom" && dateFrom && dateTo) {
      params = `?from=${dateFrom}&to=${dateTo}`;
      label = `${dateFrom}-to-${dateTo}`;
    }
    downloadPdf(`/api/reports/finance.pdf${params}`, `Ashtech-Finance-${label}.pdf`);
  }

  const fmt = (n: number) => `Rs ${Number(n).toLocaleString()}`;
  const catOptions = categories.filter((c) => c.type === form.type);

  const visibleTxns = txns.filter((t) => {
    const date = new Date(t.txn_date);
    const now = new Date();
    if (filterType !== "all" && t.type !== filterType) return false;
    if (filterClient && t.client_name !== filterClient) return false;
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

  const sortedAccounts = useMemo(() => {
    const filtered = accountSearch.trim()
      ? accounts.filter((a) =>
          a.account_name.toLowerCase().includes(accountSearch.toLowerCase()) ||
          (a.bank_name ?? "").toLowerCase().includes(accountSearch.toLowerCase()) ||
          (a.account_number ?? "").toLowerCase().includes(accountSearch.toLowerCase())
        )
      : accounts;
    return [...filtered].sort((a, b) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : a.id;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : b.id;
      return accountSortOrder === "desc" ? timeB - timeA : timeA - timeB;
    });
  }, [accounts, accountSortOrder, accountSearch]);

  const sortedVisibleTxns = useMemo(() => {
    return [...visibleTxns].sort((a, b) => {
      const dateA = new Date(a.txn_date).getTime();
      const dateB = new Date(b.txn_date).getTime();
      if (dateA !== dateB) {
        return txnSortOrder === "desc" ? dateB - dateA : dateA - dateB;
      }
      return txnSortOrder === "desc" ? b.id - a.id : a.id - b.id;
    });
  }, [visibleTxns, txnSortOrder]);

  const visibleInflow = visibleTxns.filter((t) => t.type === "inflow").reduce((s, t) => s + Number(t.amount_pkr), 0);
  const visibleOutflow = visibleTxns.filter((t) => t.type === "outflow").reduce((s, t) => s + Number(t.amount_pkr), 0);
  const visibleNet = visibleInflow - visibleOutflow;

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

  // TRANSACTION DETAILS VIEW
  if (selectedTxn) {
    const hasAttachment = !!selectedTxn.attachment_name;
    const hasInvoice = !!selectedTxn.invoice_path;

    const isImage =
      selectedTxn.attachment_mime?.startsWith("image/") ||
      /\.(jpg|jpeg|png|webp)$/i.test(selectedTxn.attachment_name || "");
    const isPdf =
      selectedTxn.attachment_mime === "application/pdf" ||
      /\.pdf$/i.test(selectedTxn.attachment_name || "");

    // ── Document viewer (attachment + invoice side-by-side or single) ──────
    const renderAttachmentViewer = () => {
      if (!hasAttachment) return null;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%" }}>
          {/* File info strip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              background: "#F9FAFB",
              borderRadius: "10px 10px 0 0",
              border: "1px solid #E5E7EB",
              borderBottom: "none",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 20, flexShrink: 0 }}>{isPdf ? "📄" : isImage ? "🖼️" : "📎"}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ui-text)", wordBreak: "break-word" }}>
                {selectedTxn.attachment_name}
              </div>
              <div style={{ fontSize: 11, color: "var(--ui-muted)", marginTop: 1 }}>
                {selectedTxn.attachment_size
                  ? `${(selectedTxn.attachment_size / 1024).toFixed(1)} KB`
                  : "Document"}
                {selectedTxn.attachment_mime ? ` · ${selectedTxn.attachment_mime}` : ""}
              </div>
            </div>
          </div>
          {/* Viewer area */}
          <div
            style={{
              flex: 1,
              border: "1px solid #E5E7EB",
              borderRadius: "0 0 10px 10px",
              overflow: "hidden",
              background: "#FAFAFA",
              minHeight: 400,
            }}
          >
            {isImage && (
              <a
                href={attachmentUrl}
                target="_blank"
                rel="noreferrer"
                title="Click image to open in full size"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 400, cursor: "zoom-in" }}
              >
                <img
                  src={attachmentUrl}
                  alt={selectedTxn.attachment_name || "Attachment"}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "500px",
                    objectFit: "contain",
                    borderRadius: 6,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                    display: "block",
                    margin: "auto",
                    padding: 12,
                  }}
                />
              </a>
            )}
            {isPdf && (
              <iframe
                src={attachmentUrl}
                title={selectedTxn.attachment_name || "PDF Document"}
                style={{ width: "100%", height: "100%", minHeight: 460, border: "none" }}
              />
            )}
            {!isImage && !isPdf && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 200, color: "var(--ui-muted)", fontSize: 13 }}>
                Preview not available. Use download button.
              </div>
            )}
          </div>
        </div>
      );
    };

    const renderInvoiceViewer = () => {
      if (!hasInvoice) return null;
      const invoiceName = selectedTxn.invoice_number
        ? `${selectedTxn.invoice_number}.pdf`
        : "Invoice.pdf";
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%" }}>
          {/* Invoice info strip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              background: "#FFF7ED",
              borderRadius: "10px 10px 0 0",
              border: "1px solid #FDBA74",
              borderBottom: "none",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 20, flexShrink: 0 }}>🧾</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ui-accent-deep)", wordBreak: "break-word" }}>
                {invoiceName}
              </div>
              <div style={{ fontSize: 11, color: "var(--ui-accent-deep)", marginTop: 1 }}>
                {selectedTxn.client_name ? "Client Invoice · PDF" : "Transaction Receipt / Voucher · PDF"}
              </div>
            </div>
          </div>
          {/* PDF iframe viewer */}
          <div
            style={{
              flex: 1,
              border: "1px solid #FDBA74",
              borderRadius: "0 0 10px 10px",
              overflow: "hidden",
              background: "#fff",
              minHeight: 400,
            }}
          >
            <iframe
              src={invoiceUrl}
              title={invoiceName}
              style={{ width: "100%", height: "100%", minHeight: 460, border: "none" }}
            />
          </div>
        </div>
      );
    };

    return (
      <div className="content">
        <div className="detail-header fin-detail-nav" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <button className="fin-btn-secondary fin-back-button" onClick={() => { setSelectedTxn(null); setAttachmentMenuOpen(false); setInvoiceMenuOpen(false); }}>
            <LuArrowLeft size={15} aria-hidden="true" /> Back to transactions
          </button>
          <div className="detail-actions" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {/* Attachment download button */}
            {hasAttachment && (
              <div style={{ position: "relative", display: "inline-block" }}>
                <button
                  type="button"
                  className="btn-download"
                  onClick={() => {
                    if (isPdf || isImage) {
                      setAttachmentMenuOpen((prev) => !prev);
                      setInvoiceMenuOpen(false);
                    } else {
                      downloadFile(
                        `/api/finance/transactions/${selectedTxn.id}/attachment`,
                        selectedTxn.attachment_name || "attachment"
                      );
                    }
                  }}
                  title="Download attachment"
                  style={{ cursor: "pointer" }}
                >
                  ⬇ Attachment {isPdf || isImage ? "▾" : ""}
                </button>
                {attachmentMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "calc(100% + 4px)",
                      background: "#ffffff",
                      border: "1px solid #E5E7EB",
                      borderRadius: 8,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                      zIndex: 50,
                      minWidth: 190,
                      overflow: "hidden",
                      padding: "4px 0",
                    }}
                  >
                    <button
                      type="button"
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        fontSize: 13,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "#1F2937",
                        fontWeight: 500,
                      }}
                      onClick={() => {
                        setAttachmentMenuOpen(false);
                        downloadFile(
                          `/api/finance/transactions/${selectedTxn.id}/attachment`,
                          selectedTxn.attachment_name || "attachment"
                        );
                      }}
                    >
                      ⬇ Download File
                    </button>
                    {(isPdf || isImage) && (
                      <a
                        href={attachmentUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          padding: "10px 14px",
                          textAlign: "left",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 13,
                          color: "#1F2937",
                          textDecoration: "none",
                          borderTop: "1px solid #F3F4F6",
                          fontWeight: 500,
                        }}
                        onClick={() => setAttachmentMenuOpen(false)}
                      >
                        ↗ View in Browser
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Invoice download button */}
            {hasInvoice && (
              <div style={{ position: "relative", display: "inline-block" }}>
                <button
                  type="button"
                  className="btn-download"
                  style={{ background: "var(--ui-surface-accent)", color: "var(--ui-accent-deep)", borderColor: "var(--ui-border)", cursor: "pointer" }}
                  onClick={() => {
                    setInvoiceMenuOpen((prev) => !prev);
                    setAttachmentMenuOpen(false);
                  }}
                  title="Invoice options"
                >
                  <LuReceipt size={15} aria-hidden="true" /> Invoice <LuChevronDown size={13} aria-hidden="true" />
                </button>
                {invoiceMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "calc(100% + 4px)",
                      background: "#ffffff",
                      border: "1px solid #E5E7EB",
                      borderRadius: 8,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                      zIndex: 50,
                      minWidth: 190,
                      overflow: "hidden",
                      padding: "4px 0",
                    }}
                  >
                    <button
                      type="button"
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        fontSize: 13,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "#1F2937",
                        fontWeight: 500,
                      }}
                      onClick={() => {
                        setInvoiceMenuOpen(false);
                        const invoiceName = selectedTxn.invoice_number
                          ? `${selectedTxn.invoice_number}.pdf`
                          : "Invoice.pdf";
                        downloadFile(
                          `/api/finance/transactions/${selectedTxn.id}/invoice`,
                          invoiceName
                        );
                      }}
                    >
                      ⬇ Download Invoice
                    </button>
                    <button
                      type="button"
                      style={{
                        padding: "10px 14px",
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        color: "#1F2937",
                        textDecoration: "none",
                        background: "none",
                        border: "none",
                        borderTop: "1px solid #F3F4F6",
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                      onClick={() => {
                        setInvoiceMenuOpen(false);
                        void openAuthenticatedFile(`/api/finance/transactions/${selectedTxn.id}/invoice?preview=1`).catch(() => setError("Unable to open invoice"));
                      }}
                    >
                      ↗ Open Invoice in Browser
                    </button>
                  </div>
                )}
              </div>
            )}

            <IconButton icon="trash" label="Delete transaction" className="icon-button-danger" onClick={() => requestDelete(selectedTxn.id)} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, marginTop: 4, flexWrap: "wrap" }}>
          <h1 className="page-title" style={{ margin: 0 }}>
            {selectedTxn.invoice_number ? `Invoice ${selectedTxn.invoice_number}` : "Transaction details"}
          </h1>
          <span
            className={`pill ${selectedTxn.type === "inflow" ? "pill-active" : "pill-resigned"}`}
            style={{ textTransform: "capitalize", fontSize: "12px", fontWeight: 700 }}
          >
            {selectedTxn.type === "inflow" ? "Inflow (Income)" : "Outflow (Expense)"}
          </span>
        </div>
        <p className="page-sub" style={{ marginBottom: 20 }}>
          {(selectedTxn.custom_category || selectedTxn.category).replace(/_/g, " ")} · {String(selectedTxn.txn_date).slice(0, 10)}
        </p>

        {gateOpen && (
          <div className="reveal-gate">
            <div className="form-title">Confirm with Super Password</div>
            <div className="unlock-row">
              <input
                type="password"
                className="field-input"
                placeholder="Super Password"
                value={revealPass}
                onChange={(e) => setRevealPass(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitGate()}
              />
              <button
                className="btn-primary"
                style={{ width: "auto", padding: "0 20px" }}
                onClick={submitGate}
                disabled={gating}
              >
                {gating ? "Checking…" : "Confirm"}
              </button>
              <button
                className="btn-sm"
                onClick={() => {
                  setGateOpen(false);
                  setPendingDeleteId(null);
                  setRevealPass("");
                  setError("");
                }}
              >
                Cancel
              </button>
            </div>
            {error && <p className="error-text">{error}</p>}
          </div>
        )}

        <div className="form-card" style={{ marginBottom: 24 }}>
          <div className="form-title">Transaction Information</div>
          <div className="detail-grid">
            {selectedTxn.invoice_number && (
              <div className="detail-row">
                <div className="detail-label">Invoice Number</div>
                <div className="detail-value invoice-number-value">{selectedTxn.invoice_number}</div>
              </div>
            )}
            <div className="detail-row">
              <div className="detail-label">Transaction Type</div>
              <div
                className="detail-value"
                style={{
                  fontWeight: 600,
                  textTransform: "capitalize",
                  color: selectedTxn.type === "inflow" ? "#15803D" : "#DC2626",
                }}
              >
                {selectedTxn.type === "inflow" ? "Inflow (+ Income)" : "Outflow (− Expense)"}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Category</div>
              <div className="detail-value">{(selectedTxn.custom_category || selectedTxn.category).replace(/_/g, " ")}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Amount & Currency</div>
              <div className="detail-value" style={{ fontWeight: 600 }}>
                {selectedTxn.currency} {Number(selectedTxn.amount).toLocaleString()}
                {selectedTxn.currency !== "PKR" && (
                  <span style={{ fontSize: "13px", color: "var(--ui-muted)", fontWeight: 400, marginLeft: 8 }}>
                    (@ {selectedTxn.exchange_rate} PKR)
                  </span>
                )}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label">PKR Value (Frozen)</div>
              <div
                className="detail-value"
                style={{
                  fontWeight: 700,
                  color: selectedTxn.type === "inflow" ? "#15803D" : "#DC2626",
                }}
              >
                {fmt(selectedTxn.amount_pkr)}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Transaction Date</div>
              <div className="detail-value">{String(selectedTxn.txn_date).slice(0, 10)}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Payment Method</div>
              <div className="detail-value" style={{ textTransform: "capitalize" }}>
                {selectedTxn.payment_method.replace(/_/g, " ")}
              </div>
            </div>
            {selectedTxn.account_name && (
              <div className="detail-row">
                <div className="detail-label">Finance Account</div>
                <div className="detail-value">
                  {selectedTxn.account_name}
                  {selectedTxn.fa_type && (
                    <span style={{ fontSize: 11, color: "var(--ui-muted)", marginLeft: 6, textTransform: "capitalize" }}>
                      ({selectedTxn.fa_type})
                    </span>
                  )}
                </div>
              </div>
            )}
            {selectedTxn.salary_base_amount !== null && (
              <div className="detail-row"><div className="detail-label">Final Employee Salary</div><div className="detail-value">{selectedTxn.currency} {Number(selectedTxn.salary_base_amount).toLocaleString()}</div></div>
            )}
            {Number(selectedTxn.salary_bonus_amount || 0) > 0 && (
              <div className="detail-row"><div className="detail-label">Bonus</div><div className="detail-value">{selectedTxn.currency} {Number(selectedTxn.salary_bonus_amount).toLocaleString()}</div></div>
            )}
            {selectedTxn.payment_method === "bank_transfer" && selectedTxn.sender_account_number && (
              <div className="detail-row">
                <div className="detail-label">Client/Sender Account Number</div>
                <div className="detail-value">{selectedTxn.sender_account_number}</div>
              </div>
            )}
            {selectedTxn.payment_method === "bank_transfer" && selectedTxn.sender_bank_name && (
              <div className="detail-row">
                <div className="detail-label">Sender Bank</div>
                <div className="detail-value">{selectedTxn.sender_bank_name}</div>
              </div>
            )}
            {selectedTxn.account_name && (
              <div className="detail-row">
                <div className="detail-label">{selectedTxn.type === "outflow" ? "Paid From" : "Received In"}</div>
                <div className="detail-value">{selectedTxn.account_name}{selectedTxn.receiving_bank_name ? ` · ${selectedTxn.receiving_bank_name}` : ""}</div>
              </div>
            )}
            {selectedTxn.invoice_number && selectedTxn.invoice_total !== null && (
              <>
                <div className="detail-row"><div className="detail-label">Invoice Subtotal</div><div className="detail-value">{selectedTxn.invoice_currency} {Number(selectedTxn.invoice_subtotal).toLocaleString()}</div></div>
                <div className="detail-row"><div className="detail-label">Sales Tax</div><div className="detail-value">{selectedTxn.invoice_tax_applied ? `${Number(selectedTxn.invoice_tax_rate).toFixed(0)}% · ${selectedTxn.invoice_currency} ${Number(selectedTxn.invoice_tax_amount).toLocaleString()}` : "Not applied"}</div></div>
                <div className="detail-row"><div className="detail-label">Total Invoice</div><div className="detail-value"><strong>{selectedTxn.invoice_currency} {Number(selectedTxn.invoice_total).toLocaleString()}</strong></div></div>
                <div className="detail-row"><div className="detail-label">Amount Paid</div><div className="detail-value amount-inflow">{selectedTxn.currency} {Number(selectedTxn.amount).toLocaleString()}</div></div>
                {!selectedTxn.project_applied_amount && <div className="detail-row"><div className="detail-label">Remaining Balance</div><div className="detail-value invoice-balance-value">{selectedTxn.invoice_currency} {(Number(selectedTxn.invoice_total) - Number(selectedTxn.amount)).toLocaleString()}</div></div>}
              </>
            )}
            <div className="detail-row">
              <div className="detail-label">Linked Entity</div>
              <div className="detail-value">
                {selectedTxn.client_name
                  ? `Client: ${selectedTxn.client_name}`
                  : selectedTxn.project_name
                  ? `Project: ${selectedTxn.project_name}`
                  : selectedTxn.employee_name
                  ? `Employee: ${selectedTxn.employee_name}`
                  : "—"}
              </div>
            </div>
            {selectedTxn.project_applied_amount && selectedTxn.project_applied_currency !== selectedTxn.currency && <>
              <div className="detail-row"><div className="detail-label">Applied to Project</div><div className="detail-value">{selectedTxn.project_applied_currency} {Number(selectedTxn.project_applied_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>
              <div className="detail-row"><div className="detail-label">Frozen Project Exchange Rate</div><div className="detail-value">1 {selectedTxn.project_applied_currency} = PKR {selectedTxn.project_exchange_rate}</div></div>
            </>}
            <div className="detail-row">
              <div className="detail-label">Description</div>
              <div className="detail-value">{selectedTxn.description || "—"}</div>
            </div>
          </div>

        </div>

        {/* ── Document Viewer Section (Attachment + Invoice side-by-side) ─── */}
        <div className="form-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
            <div className="form-title" style={{ margin: 0 }}>
              {hasAttachment && hasInvoice
                ? "Supporting Document & Invoice"
                : hasAttachment
                ? "Supporting Document / Attachment"
                : hasInvoice
                ? "Generated Invoice / Receipt"
                : "Documents"}
            </div>
            {hasAttachment && hasInvoice && (
              <div style={{ fontSize: 11, color: "var(--ui-muted)", fontStyle: "italic" }}>
                Attachment & invoice shown side by side
              </div>
            )}
          </div>

          {/* Neither */}
          {!hasAttachment && !hasInvoice && (
            <div
              style={{
                padding: "36px 16px",
                textAlign: "center",
                color: "#6B7280",
                background: "#F9FAFB",
                borderRadius: 10,
                border: "1px dashed #D1D5DB",
              }}
            >
              <span style={{ fontSize: 32, display: "block", marginBottom: 8 }}>📎</span>
              <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ui-text)" }}>
                No attachment or invoice available
              </div>
              <div style={{ fontSize: 12, color: "var(--ui-muted)", marginTop: 4 }}>
                This transaction does not have any attached document or generated invoice.
              </div>
            </div>
          )}

          {/* Attachment only */}
          {hasAttachment && !hasInvoice && renderAttachmentViewer()}

          {/* Invoice only */}
          {!hasAttachment && hasInvoice && renderInvoiceViewer()}

          {/* Both — side-by-side on desktop, stacked on mobile */}
          {hasAttachment && hasInvoice && (
            <div
              style={{
                display: "flex",
                gap: 16,
                alignItems: "stretch",
              }}
              className="docs-split-row"
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ui-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                  Attachment
                </div>
                {renderAttachmentViewer()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ui-accent-deep)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                  Invoice / Receipt
                </div>
                {renderInvoiceViewer()}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ADD FORM VIEW — show only the form, not the list/table
  if (showForm) {
    return (
      <div className="content">
        <div className="content-head">
          <h1 className="page-title">Add transaction</h1>
          <button className="btn-sm" onClick={() => {
            setForm({ ...emptyForm });
            setAttachmentFile(null);
            setAttachmentError("");
            setGenerateInvoice(false);
            setError("");
            setShowForm(false);
          }}>Close</button>
        </div>

        <div className="form-card">
          <div className="form-title">New transaction</div>
          <div className="form-grid">
            <div>
              <label className="field-label">Type *</label>
              <select
                className="field-input"
                value={form.type}
                onChange={(e) => {
                  setForm((current) => ({
                    ...current, type: e.target.value, category_id: "", custom_category: "",
                    client_id: "", project_id: "", employee_id: "", bonus: "0", amount: "", payroll_period: "",
                    account_number: "", custom_sender_bank: "", sender_bank_select: "UBL",
                  }));
                }}
              >
                <option value="inflow">Inflow (money in)</option>
                <option value="outflow">Outflow (money out)</option>
              </select>
            </div>
            <div>
              <label className="field-label">Category *</label>
              <select
                className="field-input"
                value={form.category_id}
                onChange={(e) => {
                  const category = categories.find((item) => String(item.id) === e.target.value);
                  const salary = form.type === "outflow" && category?.name === "salary";
                  const clientPayment = form.type === "inflow" && category?.name === "client_payment";
                  setForm((current) => ({
                    ...current, category_id: e.target.value, custom_category: "",
                    client_id: clientPayment ? current.client_id : "", project_id: clientPayment ? current.project_id : "",
                    employee_id: salary ? current.employee_id : "", bonus: salary ? current.bonus : "0", payroll_period: salary ? current.payroll_period : "",
                    amount: "",
                  }));
                }}
              >
                <option value="">Select category…</option>
                {catOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            {isOtherCategory && <div>
              <label className="field-label">Specify Category *</label>
              <input className="field-input" maxLength={120} value={form.custom_category}
                onChange={(e) => set("custom_category", e.target.value)} placeholder="e.g. Consulting income" />
            </div>}
            <div>
              <label className="field-label">Date *</label>
              <input
                type="date"
                className="field-input"
                max={today}
                value={form.txn_date}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val && val > today) {
                    setError("Transaction date cannot be in the future");
                    return;
                  }
                  setError("");
                  set("txn_date", val);
                }}
              />
            </div>
            <div>
              <label className="field-label">Description</label>
              <input
                className="field-input"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">Payment Amount *</label>
              <input
                type="number"
                className="field-input"
                min="0.01"
                step="any"
                value={form.amount}
                readOnly={isSalary}
                onWheel={handleWheel}
                onKeyDown={(e) => {
                  if (e.key === "-" || e.key === "e" || e.key === "E" || e.key === "+") {
                    e.preventDefault();
                  }
                }}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val.includes("-")) return;
                  if (val === "" || /^\d*\.?\d*$/.test(val)) {
                    set("amount", val);
                  }
                }}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData("text");
                  if (pasted.includes("-") || isNaN(Number(pasted)) || Number(pasted) <= 0) {
                    e.preventDefault();
                  }
                }}
                placeholder="e.g. 5000"
              />
              {isSalary && <span className="field-help">Calculated from final salary plus bonus.</span>}
            </div>
            <div>
              <label className="field-label">Currency</label>
              <select
                className="field-input"
                value={form.currency}
                disabled={isSalary && !!selectedSalaryEmployee}
                aria-describedby={isSalary && selectedSalaryEmployee ? "salary-currency-help" : undefined}
                onChange={(e) => setForm((current) => ({ ...current, currency: e.target.value, custom_currency_code: "", currency_name: "" }))}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c === "CAD" ? "CAD — Canadian Dollar" : c}</option>
                ))}
                <option value="Other">Other</option>
              </select>
              {isSalary && selectedSalaryEmployee && <span id="salary-currency-help" className="field-help">Locked to employee salary currency: {selectedSalaryEmployee.salary_currency}.</span>}
            </div>
            {form.currency === "Other" && <>
              <div><label className="field-label">Currency Code *</label><input className="field-input" readOnly={isSalary && !!selectedSalaryEmployee} maxLength={3} value={form.custom_currency_code} onChange={(e) => set("custom_currency_code", e.target.value.toUpperCase())} placeholder="e.g. JPY" required /></div>
              <div><label className="field-label">Currency Name *</label><input className="field-input" readOnly={isSalary && !!selectedSalaryEmployee} maxLength={80} value={form.currency_name} onChange={(e) => set("currency_name", e.target.value)} placeholder="e.g. Japanese Yen" required /></div>
            </>}
            <div><label className="field-label">Transaction ID</label><input className="field-input" maxLength={120} value={form.transaction_id} onChange={(e) => set("transaction_id", e.target.value)} placeholder="External payment reference (optional)" /></div>
            {form.currency !== "PKR" && (
              <div>
                <label className="field-label">Exchange rate to PKR *</label>
                <input
                  type="number"
                  className="field-input"
                  min="0.01"
                  step="any"
                  value={form.exchange_rate}
                  onWheel={handleWheel}
                  onKeyDown={(e) => {
                    if (e.key === "-" || e.key === "e" || e.key === "E" || e.key === "+") {
                      e.preventDefault();
                    }
                  }}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.includes("-")) return;
                    if (val === "" || /^\d*\.?\d*$/.test(val)) {
                      set("exchange_rate", val);
                    }
                  }}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData("text");
                    if (pasted.includes("-") || isNaN(Number(pasted)) || Number(pasted) <= 0) {
                      e.preventDefault();
                    }
                  }}
                  placeholder="e.g. 278.50"
                />
              </div>
            )}
            {isSalary && <>
              {form.payroll_period && <div><label className="field-label">Payroll period</label><input className="field-input" type="month" value={form.payroll_period.slice(0, 7)} min="2000-01" max="2100-12" onChange={event => event.target.value && set("payroll_period", `${event.target.value}-01`)} /></div>}
              <div>
                <label className="field-label">Employee *</label>
                <select className="field-input" value={form.employee_id} onChange={(e) => {
                  const employee = salaryEmployees.find((item) => String(item.id) === e.target.value);
                  const bonus = Math.max(0, Number(form.bonus) || 0);
                  setForm((current) => ({ ...current, employee_id: e.target.value,
                    currency: employee ? (CURRENCIES.includes(employee.salary_currency) ? employee.salary_currency : "Other") : current.currency,
                    custom_currency_code: employee && !CURRENCIES.includes(employee.salary_currency) ? employee.salary_currency : "",
                    currency_name: employee && !CURRENCIES.includes(employee.salary_currency) ? employee.salary_currency : "",
                    exchange_rate: employee?.salary_currency === "PKR" ? "" : current.exchange_rate,
                    amount: employee ? String(Number(employee.final_salary) + bonus) : "" }));
                }}>
                  <option value="">Select employee…</option>
                  {salaryEmployees.map((employee) => <option key={employee.id} value={employee.id}>
                    {employee.full_name} ({employee.employee_code}) — {employee.salary_currency} {Number(employee.final_salary).toLocaleString()}
                  </option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Bonus (optional)</label>
                <input type="number" min="0" step="any" className="field-input" value={form.bonus}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value !== "" && (!/^\d*\.?\d*$/.test(value) || Number(value) < 0)) return;
                    setForm((current) => ({ ...current, bonus: value,
                      amount: selectedSalaryEmployee ? String(Number(selectedSalaryEmployee.final_salary) + (Number(value) || 0)) : "" }));
                  }} />
                {selectedSalaryEmployee && <span className="field-help">
                  Final salary {selectedSalaryEmployee.salary_currency} {Number(selectedSalaryEmployee.final_salary).toLocaleString()} + bonus = {selectedSalaryEmployee.salary_currency} {Number(salaryTotal).toLocaleString()}
                </span>}
              </div>
            </>}
            <div>
              <label className="field-label">Payment method</label>
              <select
                className="field-input"
                value={form.payment_method}
                onChange={(e) => set("payment_method", e.target.value)}
              >
                {["bank_transfer", "cash"].map((m) => (
                  <option key={m} value={m}>
                    {m.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">{form.type === "inflow" ? "Receiving EMS Account" : "Pay From EMS Account"} *</label>
              <select
                className="field-input"
                value={form.account_id}
                onChange={(e) => set("account_id", e.target.value)}
              >
                <option value="">Select account…</option>
                {accounts.filter((a) => a.status === "active").map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.account_name}{a.bank_name ? ` (${a.bank_name})` : ""}
                  </option>
                ))}
              </select>
            </div>
            {requiresAccountRate && selectedFinanceAccount && <div className="project-total-preview">
              <label className="field-label">Finance Account Exchange Rate · 1 {selectedFinanceAccount.currency} = PKR
                <input className="field-input" type="number" min="0.0001" step="0.0001" required value={form.account_exchange_rate} onWheel={handleWheel} onChange={event => set("account_exchange_rate", event.target.value)} />
              </label>
              <span>Transaction: {transactionCurrency} {Number(salaryTotal ?? form.amount).toLocaleString()}</span>
              <span>Finance Account: {selectedFinanceAccount.account_name} · {selectedFinanceAccount.currency}</span>
              <strong>Applied to Account: {selectedFinanceAccount.currency} {pkrPreview !== null && Number(form.account_exchange_rate) > 0 ? (Math.round(Math.round(pkrPreview * 100) / Number(form.account_exchange_rate)) / 100).toFixed(2) : "Enter valid exchange rates"}</strong>
            </div>}
            {form.type === "inflow" && form.payment_method === "bank_transfer" && (
              <>
                <div>
                  <label className="field-label">Sender Bank *</label>
                  <select
                    className="field-input"
                    value={form.sender_bank_select}
                    onChange={(e) => setForm((current) => ({
                      ...current,
                      sender_bank_select: e.target.value,
                      custom_sender_bank: e.target.value === "Other" ? current.custom_sender_bank : "",
                    }))}
                  >
                    {PAK_BANKS.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
                  </select>
                  <span className="field-help">Bank from which the client sent this payment.</span>
                </div>
                {form.sender_bank_select === "Other" && (
                  <div>
                    <label className="field-label">Bank Name *</label>
                    <input
                      className="field-input"
                      value={form.custom_sender_bank}
                      onChange={(e) => set("custom_sender_bank", e.target.value)}
                      maxLength={100}
                      placeholder="Enter the client's sending bank"
                    />
                  </div>
                )}
                <div>
                  <label className="field-label">Client/Sender Account Number *</label>
                  <input
                    className="field-input"
                    value={form.account_number}
                    onChange={(e) => {
                      const val = e.target.value;
                      // Allow digits, letters (for IBAN etc.), spaces, hyphens, underscores
                      if (val === "" || /^[0-9A-Za-z\s\-_]+$/.test(val)) {
                        set("account_number", val);
                      }
                    }}
                    placeholder="Account used by the client to send payment"
                  />
                </div>
              </>
            )}
            {isClientPayment && <div>
              <label className="field-label">Client *</label>
              <select
                className="field-input"
                value={form.client_id}
                onChange={(e) => setForm((current) => ({ ...current, client_id: e.target.value, project_id: "" }))}
              >
                <option value="">—</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>}
            {isClientPayment && <div>
              <label className="field-label">Project *</label>
              <select
                className="field-input"
                value={form.project_id}
                onChange={(e) => {
                  setForm((current) => ({
                    ...current,
                    project_id: e.target.value,
                    project_exchange_rate: "",
                  }));
                }}
                disabled={!form.client_id}
              >
                <option value="">{form.client_id ? "Select project…" : "Select a client first"}</option>
                {clientProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>}
            {isClientPayment && selectedProject && <div className="project-total-preview">
              <span className="field-label">Project Billing</span>
              <strong>
                Remaining: {selectedProject.value_currency} {selectedProject.project_value === null
                  ? "Not set"
                  : Number(selectedProject.remaining_balance).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </strong>
              <span className="field-help">Total payable {selectedProject.value_currency} {Number(selectedProject.total_payable).toFixed(2)} · Paid {selectedProject.value_currency} {Number(selectedProject.total_paid).toFixed(2)}</span>
            </div>}
            {isClientPayment && selectedProject && (form.currency === "Other" ? form.custom_currency_code.trim().toUpperCase() : form.currency) !== selectedProject.value_currency && <div className="project-total-preview">
              <span className="field-label">Cross-Currency Payment</span>
              <span className="field-help">Payment received: {form.currency === "Other" ? form.custom_currency_code.toUpperCase() : form.currency} {Number(form.amount || 0).toFixed(2)} · Project currency: {selectedProject.value_currency}</span>
              {selectedProject.value_currency !== "PKR" && <label className="field-label">Project Exchange Rate · 1 {selectedProject.value_currency} = PKR<input className="field-input" type="number" min="0.0001" step="0.0001" value={form.project_exchange_rate} onWheel={handleWheel} onChange={(e) => set("project_exchange_rate", e.target.value)} placeholder="e.g. 280" required /></label>}
              <strong>Applied to Project: {selectedProject.value_currency} {pkrPreview !== null && (selectedProject.value_currency === "PKR" || Number(form.project_exchange_rate) > 0) ? (Math.round(pkrPreview * 100) / 100 / (selectedProject.value_currency === "PKR" ? 1 : Number(form.project_exchange_rate))).toFixed(2) : "Enter valid exchange rates"}</strong>
              <span className="field-help">Conversion is verified by the server and frozen when recorded.</span>
            </div>}
            <div>
              <label className="field-label">Invoice / Receipt Attachment (Optional)</label>
              <input
                type="file"
                className="field-input"
                accept=".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  if (file) {
                    if (file.size > 10 * 1024 * 1024) {
                      setAttachmentError("File size exceeds 10MB limit");
                      setAttachmentFile(null);
                      e.target.value = "";
                      return;
                    }
                    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
                    if (![".pdf", ".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
                      setAttachmentError("Unsupported file type. Please upload a PDF or JPG/PNG image.");
                      setAttachmentFile(null);
                      e.target.value = "";
                      return;
                    }
                    setAttachmentError("");
                    setAttachmentFile(file);
                  } else {
                    setAttachmentFile(null);
                    setAttachmentError("");
                  }
                }}
              />
              {attachmentFile && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "12px",
                    color: "#15803D",
                    marginTop: 4,
                    flexWrap: "wrap",
                    gap: 6,
                  }}
                >
                  <span style={{ wordBreak: "break-word", minWidth: 0, flex: 1 }}>
                    ✓ Selected: {attachmentFile.name} ({(attachmentFile.size / 1024).toFixed(1)} KB)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachmentFile(null);
                      setAttachmentError("");
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#DC2626",
                      cursor: "pointer",
                      fontSize: "11px",
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
              {attachmentError && (
                <span className="error-text" style={{ fontSize: "12px", display: "block" }}>
                  {attachmentError}
                </span>
              )}
              <span style={{ fontSize: "11px", color: "var(--ui-muted)", marginTop: "2px", display: "block" }}>
                Supported formats: PDF, JPG, JPEG, PNG, WEBP (Max 10MB)
              </span>
            </div>
          </div>

          {/* ── Generate Invoice Toggle ──────────────────────────────────── */}
          <div
            style={{
              marginTop: 20,
              padding: "16px 18px",
              background: generateInvoice ? "#FFF7ED" : "#F9FAFB",
              borderRadius: 10,
              border: `1.5px solid ${generateInvoice ? "#FDBA74" : "#E5E7EB"}`,
              display: "flex",
              alignItems: "flex-start",
              gap: 14,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onClick={() => setGenerateInvoice((value) => !value)}
          >
            <div style={{ paddingTop: 2, flexShrink: 0 }}>
              <input
                id="generate-invoice-toggle"
                type="checkbox"
                checked={generateInvoice}
                onChange={(e) => {
                  e.stopPropagation();
                  setGenerateInvoice(e.target.checked);
                }}
                style={{ width: 17, height: 17, cursor: "pointer", accentColor: "var(--ui-accent)" }}
              />
            </div>
            <div>
              <label
                htmlFor="generate-invoice-toggle"
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  color: generateInvoice ? "#92400E" : "#374151",
                  cursor: "pointer",
                  display: "block",
                  marginBottom: 3,
                }}
              >
                🧾 Generate Invoice / Receipt
              </label>
              <div style={{ fontSize: 12, color: generateInvoice ? "var(--ui-accent-deep)" : "var(--ui-muted)", lineHeight: 1.5 }}>
                {generateInvoice
                  ? (isClientPayment ? "The server will create a project payment receipt using the project's configured sales tax and cumulative balance." : "The server will create a numbered receipt/payment voucher using the applicable transaction details.")
                  : "Enable this to generate a numbered document for this transaction."}
              </div>
            </div>
          </div>

          {pkrPreview !== null && (
            <div className="pkr-preview">
              Will be recorded as <strong>{fmt(pkrPreview)}</strong> — locked at this rate forever
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <button
              className="btn-primary"
              style={{ width: "auto", padding: "0 24px" }}
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save transaction"}
            </button>
            <button
              className="btn-sm"
              onClick={() => {
                setForm({ ...emptyForm });
                setAttachmentFile(null);
                setAttachmentError("");
                setGenerateInvoice(false);
                setError("");
                setShowForm(false);
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // MAIN FINANCE LIST VIEW
  return (
    <div className="content">
      {/* ── Finance Page Header ─────────────────────────────────────────── */}
      <div className="fin-page-header">
        <div className="fin-page-header-left">
          <p className="fin-page-kicker">FINANCE MANAGEMENT</p>
          <h1 className="page-title" style={{ margin: 0 }}>
            {activeTab === "accounts" ? "Accounts" : "Transactions"}
          </h1>
          <p className="fin-page-sub">
            {activeTab === "accounts"
              ? "Manage your financial accounts, balances and status."
              : "Track all company inflows and outflows."}
          </p>
        </div>
        <div className="fin-page-header-right">
          {activeTab === "transactions" ? (
            <>
              <button className="fin-btn-secondary" onClick={handleDownloadPdf}>
                <LuArrowDownToLine size={15} /> Download PDF
              </button>
              <button className="fin-btn-primary" onClick={() => setShowForm(true)}>
                <LuPlus size={15} /> Add transaction
              </button>
            </>
          ) : (
            <>
              <button
                className="fin-btn-secondary fin-back-button"
                onClick={() => selectedAccountHistory ? setSelectedAccountHistory(null) : setActiveTab("transactions")}
              >
                <LuArrowLeft size={15} />
                {selectedAccountHistory ? "Back to accounts" : "Back to transactions"}
              </button>
              {!showAccountForm && !showTransferForm && !selectedAccountHistory && (
                <button
                  className="fin-btn-secondary"
                  onClick={() => {
                    setTransferForm({ ...emptyTransferForm, transfer_date: today });
                    setTransferError("");
                    setShowTransferForm(true);
                  }}
                >
                  <LuArrowLeftRight size={15} aria-hidden="true" /> Transfer Funds
                </button>
              )}
              {!showAccountForm && !showTransferForm && !selectedAccountHistory && (
                <button className="fin-btn-primary" onClick={openNewAccountForm}>
                  <LuPlus size={15} /> Add account
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Segmented Tabs ──────────────────────────────────────────────── */}
      <div className="fin-tabs-row">
        <button
          className={`fin-tab ${activeTab === "transactions" ? "fin-tab-active" : ""}`}
          onClick={() => { setActiveTab("transactions"); setShowAccountForm(false); setAccountError(""); }}
        >
          <LuReceipt size={15} />
          <span>Transactions</span>
        </button>
        <button
          className={`fin-tab ${activeTab === "accounts" ? "fin-tab-active" : ""}`}
          onClick={() => { setActiveTab("accounts"); setError(""); }}
        >
          <LuWallet size={15} />
          <span>Accounts</span>
          {accounts.length > 0 && <span className="fin-tab-badge">{accounts.length}</span>}
        </button>
      </div>

      {/* ══════════════════════════ ACCOUNTS TAB ══════════════════════════ */}
      {activeTab === "accounts" && (
        <div style={{ marginTop: 8 }}>
          {accountHistoryLoading && <div className="empty-note">Loading account history…</div>}
          {/* Account Super Password gate */}
          {accountGateOpen && (
            <div className="reveal-gate">
              <div className="form-title">Confirm with Super Password</div>
              <div className="unlock-row">
                <input
                  type="password"
                  className="field-input"
                  placeholder="Super Password"
                  value={accountGatePass}
                  onChange={(e) => setAccountGatePass(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitAccountGate()}
                />
                <button
                  className="btn-primary"
                  style={{ width: "auto", padding: "0 20px" }}
                  onClick={submitAccountGate}
                  disabled={accountGating}
                >
                  {accountGating ? "Checking…" : "Confirm"}
                </button>
                <button
                  className="btn-sm"
                  onClick={() => {
                    setAccountGateOpen(false);
                    setAccountGatePass("");
                    setPendingDeleteAccountId(null);
                    setPendingToggleAccountId(null);
                    setPendingToggleTargetStatus(null);
                    setAccountError("");
                  }}
                >
                  Cancel
                </button>
              </div>
              {accountError && <p className="error-text">{accountError}</p>}
            </div>
          )}

          {!accountGateOpen && accountError && <p className="error-text">{accountError}</p>}

          {/* Add / Edit Account Form */}
          {showAccountForm && (
            <div className="form-card" style={{ marginBottom: 24 }}>
              <div className="form-title">{editingAccountId ? "Edit account" : "New account"}</div>
              <div className="form-grid">
                <div>
                  <label className="field-label">Account Name *</label>
                  <input
                    className="field-input"
                    value={accountForm.account_name}
                    onChange={(e) => setAccForm("account_name", e.target.value)}
                    placeholder="This is what will be shown in the invoice"
                  />
                </div>

                <div>
                  <label className="field-label">Account Type *</label>
                  <select
                    className="field-input"
                    value={accountForm.account_type}
                    onChange={(e) => setAccForm("account_type", e.target.value as any)}
                  >
                    <option value="bank">Bank</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>

                {accountForm.account_type === "bank" && (
                  <div>
                    <label className="field-label">Bank Name</label>
                    <select
                      className="field-input"
                      value={accountForm.bank_name_select}
                      onChange={(e) => handleAccountBankChange(e.target.value)}
                    >
                      {PAK_BANKS.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
                    </select>
                  </div>
                )}

                {accountForm.account_type === "bank" && accountForm.bank_name_select === "Other" && (
                  <div>
                    <label className="field-label">Other Bank Name</label>
                    <input
                      className="field-input"
                      value={accountForm.custom_bank_name}
                      onChange={(e) => setAccountForm((current) => ({ ...current, custom_bank_name: e.target.value, bank_name: e.target.value }))}
                      placeholder="Enter the actual bank name"
                    />
                  </div>
                )}

                <div>
                  <label className="field-label">
                    Account Number / Identifier {accountForm.account_type === "cash" ? "(optional)" : ""}
                  </label>
                  <input
                    className="field-input"
                    value={accountForm.account_number}
                    onChange={(e) => setAccForm("account_number", e.target.value)}
                    placeholder={accountForm.account_type === "cash" ? "Optional for cash" : "e.g. 0123456789"}
                  />
                </div>

                <div>
                  <label className="field-label">Currency</label>
                  <select
                    className="field-input"
                    value={accountForm.currency}
                    onChange={(e) => setAccForm("currency", e.target.value)}
                  >
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>

                <div>
                  <label className="field-label">Initial Balance</label>
                  <input
                    type="number"
                    className="field-input"
                    value={accountForm.initial_balance}
                    onWheel={handleWheel}
                    onChange={(e) => setAccForm("initial_balance", e.target.value)}
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="field-label">Status</label>
                  <select
                    className="field-input"
                    value={accountForm.status}
                    onChange={(e) => setAccForm("status", e.target.value as any)}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              {accountError && <p className="error-text">{accountError}</p>}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                <button
                  className="btn-primary"
                  style={{ width: "auto", padding: "0 24px" }}
                  onClick={saveAccount}
                  disabled={savingAccount}
                >
                  {savingAccount ? "Saving…" : editingAccountId ? "Save changes" : "Save account"}
                </button>
                <button
                  className="btn-sm"
                  onClick={() => {
                    setShowAccountForm(false);
                    setEditingAccountId(null);
                    setAccountForm({ ...emptyAccountForm });
                    setAccountGatePass("");
                    setAccountError("");
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {showTransferForm && (
            <div className="form-card finance-transfer-form" style={{ marginBottom: 24 }}>
              <div className="form-title">Transfer Funds</div>
              <p className="page-sub">Move existing money between two EMS accounts without changing company inflow or outflow totals.</p>
              <div className="form-grid">
                <div><label className="field-label">From Account *</label><select className="field-input" value={transferForm.from_account_id} onChange={(event) => setTransferForm((current) => ({ ...current, from_account_id: event.target.value }))}><option value="">Select source account</option>{accounts.filter((account) => account.status === "active").map((account) => <option key={account.id} value={account.id}>{account.account_name} · {account.currency} {accountMoney(account.current_balance)}</option>)}</select></div>
                <div><label className="field-label">To Account *</label><select className="field-input" value={transferForm.to_account_id} onChange={(event) => setTransferForm((current) => ({ ...current, to_account_id: event.target.value }))}><option value="">Select destination account</option>{accounts.filter((account) => account.status === "active" && String(account.id) !== transferForm.from_account_id).map((account) => <option key={account.id} value={account.id}>{account.account_name} · {account.currency}</option>)}</select></div>
                <div><label className="field-label">Amount *</label><input className="field-input" type="number" min="0.01" step="0.01" value={transferForm.amount} onWheel={handleWheel} onChange={(event) => setTransferForm((current) => ({ ...current, amount: event.target.value }))} /></div>
                <div><label className="field-label">Date *</label><input className="field-input" type="date" max={today} value={transferForm.transfer_date} onChange={(event) => setTransferForm((current) => ({ ...current, transfer_date: event.target.value }))} /></div>
                <div className="finance-transfer-note"><label className="field-label">Description / Note</label><input className="field-input" maxLength={255} value={transferForm.description} onChange={(event) => setTransferForm((current) => ({ ...current, description: event.target.value }))} placeholder="Optional transfer note" /></div>
              </div>
              {transferError && <p className="error-text">{transferError}</p>}
              <div className="inline-actions"><button className="btn-primary" disabled={transferring} onClick={submitTransfer}>{transferring ? "Transferring…" : "Transfer Funds"}</button><button className="btn-sm" onClick={() => { setShowTransferForm(false); setTransferError(""); setTransferForm({ ...emptyTransferForm }); }}>Cancel</button></div>
            </div>
          )}

          {!showAccountForm && !showTransferForm && selectedAccountHistory && (
            <section className="finance-account-history">
              <div className="finance-account-history-head">
                <div><p className="attendance-kicker">Account details</p><h2>{selectedAccountHistory.account.account_name}</h2><p>{selectedAccountHistory.account.bank_name || "EMS Account"}{selectedAccountHistory.account.account_number ? ` · ${selectedAccountHistory.account.account_number}` : ""}</p></div>
                <div><small>Current Balance</small><strong className={Number(selectedAccountHistory.account.current_balance) >= 0 ? "amount-inflow" : "amount-outflow"}>{selectedAccountHistory.account.currency} {accountMoney(selectedAccountHistory.account.current_balance)}</strong></div>
              </div>
              <div className="finance-account-history-list">
                {selectedAccountHistory.history.map((entry) => <article key={`${entry.source}-${entry.id}`} className={`finance-account-history-entry finance-account-history-${entry.type}`}><div className="finance-account-history-main"><span className={entry.type === "inflow" ? "amount-inflow" : "amount-outflow"}>{entry.type === "inflow" ? "+" : "−"}</span><div><strong>{entry.source === "transfer" ? (entry.type === "inflow" ? `Transfer from ${entry.from_account_name}` : `Transfer to ${entry.to_account_name}`) : entry.description || (entry.type === "inflow" ? "Account inflow" : "Account outflow")}</strong><small>{String(entry.entry_date).slice(0, 10)}{entry.invoice_number ? ` · Invoice ${entry.invoice_number}` : ""}{entry.client_name ? ` · ${entry.client_name}` : ""}{entry.project_name ? ` / ${entry.project_name}` : ""}</small>{entry.source === "transfer" && entry.description && <small>{entry.description}</small>}</div></div><div className="finance-account-history-amount"><strong className={entry.type === "inflow" ? "amount-inflow" : "amount-outflow"}>{entry.type === "inflow" ? "+" : "−"} {selectedAccountHistory.account.currency} {accountMoney(entry.account_amount === null ? null : Math.abs(Number(entry.account_amount)))}</strong>{entry.source === "transaction" && entry.currency !== selectedAccountHistory.account.currency && <><small>Original: {entry.currency} {Number(entry.amount).toLocaleString()}</small>{entry.account_exchange_rate && <small>Rate: 1 {selectedAccountHistory.account.currency} = PKR {entry.account_exchange_rate}</small>}</>}<small>Balance: {selectedAccountHistory.account.currency} {accountMoney(entry.resulting_balance)}</small></div></article>)}
                {!selectedAccountHistory.history.length && <div className="empty-note">No transactions exist for this account.</div>}
              </div>
            </section>
          )}

          {/* Accounts list */}
          {!showAccountForm && !showTransferForm && !selectedAccountHistory && (
            <>
              {/* KPI Cards for Accounts */}
              <div className="fin-kpi-row">
                <div className="fin-kpi-card">
                  <div className="fin-kpi-icon fin-kpi-icon-accent">
                    <LuWallet size={22} />
                  </div>
                  <div className="fin-kpi-body">
                    <div className="fin-kpi-label">Account Balances</div>
                    <div className={`fin-account-currency-totals${accountBalancesByCurrency.length <= 1 ? " is-single" : ""}`}>
                      {!accountBalancesByCurrency.length && <span>No accounts yet</span>}
                      {accountBalancesByCurrency.slice(0, accountBalancesByCurrency.length > 3 ? 2 : 3).map(({ currency, balance }) => <span className="fin-account-currency-total" key={currency} title={`${currency} ${accountMoney(balance)}`}>
                        <span>{currency}</span><strong style={{ color: balance === null ? "var(--ui-muted)" : balance < 0 ? "var(--fin-negative)" : "var(--fin-positive)" }}>{balance === null ? "Rate needed" : accountBalancesByCurrency.length === 1 ? accountMoney(balance) : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(balance)}</strong>
                      </span>)}
                      {accountBalancesByCurrency.length > 3 && <details className="fin-account-currency-more"><summary>+{accountBalancesByCurrency.length - 2} more</summary><div>{accountBalancesByCurrency.slice(2).map(({ currency, balance }) => <p key={currency}>{currency} <strong>{accountMoney(balance)}</strong></p>)}</div></details>}
                    </div>
                    <div className="fin-kpi-sub">{accountBalancesByCurrency.length === 1 ? "Balances across all accounts" : "Balances grouped by currency"}</div>
                  </div>
                </div>
                <div className="fin-kpi-card">
                  <div className="fin-kpi-icon fin-kpi-icon-success">
                    <LuCircleCheck size={22} />
                  </div>
                  <div className="fin-kpi-body">
                    <div className="fin-kpi-label">Active Accounts</div>
                    <div className="fin-kpi-value fin-kpi-value-success">
                      {accounts.filter((a) => a.status === "active").length}
                    </div>
                    <div className="fin-kpi-sub">Accounts currently active</div>
                  </div>
                </div>
                <div className="fin-kpi-card">
                  <div className="fin-kpi-icon fin-kpi-icon-muted">
                    <LuCirclePause size={22} />
                  </div>
                  <div className="fin-kpi-body">
                    <div className="fin-kpi-label">Inactive Accounts</div>
                    <div className="fin-kpi-value fin-kpi-value-muted">
                      {accounts.filter((a) => a.status === "inactive").length}
                    </div>
                    <div className="fin-kpi-sub">Accounts currently inactive</div>
                  </div>
                </div>
              </div>

              {/* Search + Sort Row */}
              <div className="fin-controls-row">
                <div className="fin-search-box">
                  <LuSearch size={15} className="fin-search-icon" />
                  <input
                    className="fin-search-input"
                    type="search"
                    placeholder="Search accounts by name, bank or identifier..."
                    value={accountSearch}
                    onChange={(e) => setAccountSearch(e.target.value)}
                  />
                </div>
                <div className="fin-sort-box">
                  <span className="fin-sort-label">Sort:</span>
                  <select
                    className="field-input"
                    style={{ width: "auto", minWidth: 170, marginBottom: 0, height: 38 }}
                    value={accountSortOrder}
                    onChange={(e) => setAccountSortOrder(e.target.value as "desc" | "asc")}
                  >
                    <option value="desc">Newest → Oldest</option>
                    <option value="asc">Oldest → Newest</option>
                  </select>
                </div>
              </div>

              {accounts.length === 0 ? (
                <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--ui-muted)", background: "var(--ui-surface-soft)", borderRadius: 10, border: "1px dashed var(--ui-border)" }}>
                  <span style={{ fontSize: 36, display: "block", marginBottom: 8 }}>🏦</span>
                  <div style={{ fontWeight: 600, fontSize: 15, color: "var(--ui-text)" }}>No accounts yet</div>
                  <div style={{ fontSize: 13, color: "var(--ui-muted)", marginTop: 4, marginBottom: 16 }}>
                    Add an account to track where money flows and company balances.
                  </div>
                  <button
                    className="btn-primary"
                    style={{ width: "auto", padding: "0 24px" }}
                    onClick={openNewAccountForm}
                  >
                    + Add first account
                  </button>
                </div>
              ) : (
                <>
                  <div className="table-scroll">
                    <table className="table fin-accounts-table">
                      <thead>
                        <tr>
                          <th>Account</th>
                          <th>Identifier</th>
                          <th>Bank / Type</th>
                          <th>Balance</th>
                          <th>Status</th>
                          <th style={{ textAlign: "right" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedAccounts.map((acc) => {
                          const numBal = Number(acc.current_balance);
                          const initial = acc.account_name.trim().charAt(0).toUpperCase();
                          return (
                            <tr key={acc.id} className="finance-account-row" tabIndex={0} onClick={() => openAccountHistory(acc.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openAccountHistory(acc.id); } }}>
                              <td>
                                <div className="fin-acc-cell">
                                  <div className="fin-acc-avatar">{initial}</div>
                                  <div>
                                    <div className="fin-acc-name">{acc.account_name}</div>
                                    <div className="fin-acc-type" style={{ textTransform: "capitalize" }}>{acc.account_type} Account</div>
                                  </div>
                                </div>
                              </td>
                              <td className="fin-acc-identifier">{acc.account_number || "—"}</td>
                              <td>
                                <div className="fin-acc-name">{acc.bank_name || acc.account_type}</div>
                                <div className="fin-acc-type" style={{ textTransform: "capitalize" }}>{acc.account_type}</div>
                              </td>
                              <td>
                                <div className="fin-acc-balance" style={{ color: numBal >= 0 ? "var(--fin-positive)" : "var(--fin-negative)" }}>
                                  {acc.currency} {accountMoney(acc.current_balance)}
                                </div>
                                <div className="fin-acc-type">
                                  {acc.transaction_count} txn{acc.transaction_count !== 1 ? "s" : ""} · Initial: {Number(acc.initial_balance).toLocaleString()}
                                </div>
                              </td>
                              <td>
                                <span className={`fin-status-badge ${acc.status === "active" ? "fin-status-active" : "fin-status-inactive"}`}>
                                  {acc.status === "active" ? "Active" : "Inactive"}
                                </span>
                              </td>
                              <td>
                                <div className="fin-row-actions" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    className="fin-action-btn"
                                    onClick={(event) => { event.stopPropagation(); openEditAccountGate(acc); }}
                                    title="Edit account details"
                                  >
                                    <LuPencil size={13} /> Edit
                                  </button>
                                  <button
                                    className="fin-action-btn"
                                    onClick={(event) => { event.stopPropagation(); toggleAccountStatus(acc); }}
                                    title={acc.status === "active" ? "Deactivate this account" : "Re-activate this account"}
                                  >
                                    {acc.status === "active" ? <><LuPause size={13} /> Deactivate</> : <><LuPlay size={13} /> Activate</>}
                                  </button>
                                  <button
                                    className="fin-action-btn fin-action-btn-danger"
                                    onClick={(event) => { event.stopPropagation(); openDeleteAccountGate(acc.id); }}
                                    title="Delete account (blocked if historical transactions exist)"
                                  >
                                    <LuTrash2 size={13} /> Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {sortedAccounts.length === 0 && accountSearch && (
                          <tr><td colSpan={6}><div className="empty-note">No accounts match your search.</div></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════ TRANSACTIONS TAB ══════════════════════ */}
      {activeTab === "transactions" && (<>
      <div className="fin-kpi-row">
        <div className="fin-kpi-card">
          <div className="fin-kpi-icon fin-kpi-icon-success">
            <LuArrowDownToLine size={22} />
          </div>
          <div className="fin-kpi-body">
            <div className="fin-kpi-label">Inflow · {periodLabel}</div>
            <div className="fin-kpi-value fin-kpi-value-success">{fmt(visibleInflow)}</div>
          </div>
        </div>
        <div className="fin-kpi-card">
          <div className="fin-kpi-icon fin-kpi-icon-danger">
            <LuArrowUpFromLine size={22} />
          </div>
          <div className="fin-kpi-body">
            <div className="fin-kpi-label">Outflow · {periodLabel}</div>
            <div className="fin-kpi-value fin-kpi-value-danger">{fmt(visibleOutflow)}</div>
          </div>
        </div>
        <div className="fin-kpi-card">
          <div className="fin-kpi-icon fin-kpi-icon-accent">
            <LuTrendingUp size={22} />
          </div>
          <div className="fin-kpi-body">
            <div className="fin-kpi-label">Net · {periodLabel}</div>
            <div className="fin-kpi-value" style={{ color: visibleNet >= 0 ? "var(--fin-positive)" : "var(--fin-negative)" }}>{fmt(visibleNet)}</div>
          </div>
        </div>
      </div>

      {gateOpen && (
        <div className="reveal-gate">
          <div className="form-title">Confirm with Super Password</div>
          <div className="unlock-row">
            <input
              type="password"
              className="field-input"
              placeholder="Super Password"
              value={revealPass}
              onChange={(e) => setRevealPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitGate()}
            />
            <button
              className="btn-primary"
              style={{ width: "auto", padding: "0 20px" }}
              onClick={submitGate}
              disabled={gating}
            >
              {gating ? "Checking…" : "Confirm"}
            </button>
            <button
              className="btn-sm"
              onClick={() => {
                setGateOpen(false);
                setPendingDeleteId(null);
                setRevealPass("");
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}
        </div>
      )}

      {!gateOpen && error && <p className="error-text">{error}</p>}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div className="tabs">
          <button
            className={`tab ${filterType === "all" ? "tab-active" : ""}`}
            onClick={() => setFilterType("all")}
          >
            All
          </button>
          <button
            className={`tab ${filterType === "inflow" ? "tab-active" : ""}`}
            onClick={() => setFilterType("inflow")}
          >
            Inflows
          </button>
          <button
            className={`tab ${filterType === "outflow" ? "tab-active" : ""}`}
            onClick={() => setFilterType("outflow")}
          >
            Outflows
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <form
            className="invoice-search"
            onSubmit={(event) => {
              event.preventDefault();
              load(invoiceSearch).catch((cause) => setError(cause instanceof Error ? cause.message : "Search failed"));
            }}
          >
            <input
              className="field-input"
              value={invoiceSearch}
              onChange={(event) => setInvoiceSearch(event.target.value)}
              placeholder="Search invoice number"
              aria-label="Search by invoice number"
            />
            <button className="btn-sm" type="submit">Search</button>
            {invoiceSearch && <button className="btn-sm" type="button" onClick={() => { setInvoiceSearch(""); load().catch((cause) => setError(cause instanceof Error ? cause.message : "Search failed")); }}>Clear</button>}
          </form>
          <select
            className="field-input"
            style={{ maxWidth: 160, marginBottom: 0, height: 38 }}
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value)}
          >
            <option value="all_time">All time</option>
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
            <option value="this_quarter">This quarter</option>
            <option value="custom">Custom range</option>
          </select>
          {periodFilter === "custom" && (
            <>
              <input
                type="date"
                className="field-input"
                style={{ maxWidth: 160, marginBottom: 0, height: 38 }}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <span style={{ color: "var(--ui-muted)", fontSize: 13 }}>to</span>
              <input
                type="date"
                className="field-input"
                style={{ maxWidth: 160, marginBottom: 0, height: 38 }}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </>
          )}
          <select
            className="field-input"
            style={{ maxWidth: 220, marginBottom: 0, height: 38 }}
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.label}>
                {c.label}
              </option>
            ))}
          </select>
          {filterClient && (
            <span className="pkr-preview" style={{ marginBottom: 0 }}>
              out: Rs{" "}
              {visibleTxns
                .filter((t) => t.client_name === filterClient && t.type === "outflow")
                .reduce((s, t) => s + Number(t.amount_pkr), 0)
                .toLocaleString()}
              {" · "}in: Rs{" "}
              {visibleTxns
                .filter((t) => t.client_name === filterClient && t.type === "inflow")
                .reduce((s, t) => s + Number(t.amount_pkr), 0)
                .toLocaleString()}
            </span>
          )}
        </div>
      </div>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Invoice Number</th>
              <th>Date</th>
              <th>Category</th>
              <th>Description</th>
              <th>Linked to</th>
              <th>Amount</th>
              <th>Payment Method</th>
              <th>Transaction ID</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedVisibleTxns.map((t) => (
              <tr
                key={t.id}
                onClick={() => setSelectedTxn(t)}
                style={{ cursor: "pointer" }}
                title="Click to view transaction details and attached document"
              >
                <td className="finance-reference-cell">
                  {t.invoice_number ? <><strong>{t.invoice_number}</strong><small>Invoice</small></> : <><strong>—</strong><small>No invoice</small></>}
                </td>
                <td>{String(t.txn_date).slice(0, 10)}</td>
                <td>{(t.custom_category || t.category).replace(/_/g, " ")}</td>
                <td>{t.description ?? "—"}</td>
                <td>{t.client_name ?? t.project_name ?? t.employee_name ?? "—"}</td>
                <td className={t.type === "inflow" ? "amount-inflow" : "amount-outflow"}>
                  {t.type === "inflow" ? "+" : "−"} {t.currency} {Number(t.amount).toLocaleString()}
                  {t.currency !== "PKR" && <span className="detail-label"> @ {t.exchange_rate}</span>}
                </td>
                <td><span className={`finance-payment-method finance-payment-${t.payment_method === "cash" ? "cash" : "bank"}`}>
                  {t.payment_method === "cash" ? <LuWallet size={14} /> : <LuLandmark size={14} />}
                  {t.payment_method === "cash" ? "Cash" : t.payment_method === "bank_transfer" || t.payment_method === "card" ? "Bank Transfer" : t.payment_method.replace(/_/g, " ")}
                </span></td>
                <td className="finance-external-reference">{t.transaction_id || "—"}</td>
                <td>
                  <div className="row-actions">
                    <IconButton
                      icon="trash"
                      label={`Delete transaction ${t.invoice_number || t.id}`}
                      className="icon-button-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestDelete(t.id);
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {!visibleTxns.length && (
              <tr>
                <td colSpan={9}>
                  <div className="empty-note">No transactions match</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </>)}
    </div>
  );
}
