import { api, BASE } from "./api";

export type ApplicationStatus = "pending" | "approved" | "rejected";

export type GeneralApplication = {
  id: number;
  employee_id?: number;
  category: string;
  subject: string;
  application_date: string;
  body_text?: string;
  status: ApplicationStatus;
  submitted_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  reviewed_by_name: string | null;
  employee_name_snapshot?: string;
  employee_code_snapshot?: string;
  designation_snapshot?: string;
};

export type ApplicationPayload = {
  category: string;
  subject: string;
  application_date: string;
  body: string;
};

export const getMyApplications = () => api<{ applications: GeneralApplication[] }>("/api/applications/me");
export const submitApplication = (payload: ApplicationPayload) => api<{ id: number; status: ApplicationStatus }>("/api/applications/me", { method: "POST", body: JSON.stringify(payload) });
export const getApplications = (status: ApplicationStatus | "all") => api<{ applications: GeneralApplication[] }>(`/api/applications?status=${status}`);
export const getApplication = (id: number, own = false) => api<{ application: GeneralApplication }>(`/api/applications/${own ? "me/" : ""}${id}`);
export const decideApplication = (id: number, action: "approve" | "reject", note: string | null) => api<{ ok: true; status: ApplicationStatus }>(`/api/applications/${id}/${action}`, { method: "POST", body: JSON.stringify({ note }) });

export async function openApplicationPreview(payload: ApplicationPayload) {
  const token = sessionStorage.getItem("ems_token");
  const response = await fetch(`${BASE}/api/applications/me/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || "Unable to preview the application");
  }
  const url = URL.createObjectURL(await response.blob());
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
