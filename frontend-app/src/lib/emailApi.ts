import { api, BASE } from "./api";
export type EmailAccount = { slot: "primary" | "secondary"; email: string | null; status: "connected" | "not_connected" | "reconnect_required" };
export type EmailRecipient = { id: number; name: string; email: string | null };
export const getEmailAccounts = () => api<{ accounts: EmailAccount[] }>("/api/email/accounts");
export async function connectEmailAccount(slot: string) {
  const response = await fetch(`${BASE}/api/email/accounts/${slot}/connect`, { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${sessionStorage.getItem("ems_token") || ""}`, "Content-Type": "application/json" }, body: "{}" });
  const data = await response.json() as { authorization_url?: string; error?: string };
  if (!response.ok || !data.authorization_url) throw new Error(data.error || "Unable to connect account");
  return data.authorization_url;
}
