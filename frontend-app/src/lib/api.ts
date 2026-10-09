export const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
let superPrompt: (() => Promise<void>) | null = null;
export function installSuperPasswordPrompt(prompt: (() => Promise<void>) | null) { superPrompt = prompt; }
export async function hasSuperAuthorization(): Promise<boolean> {
  try { return (await api<{ authorized: boolean }>("/api/security/super-password/status")).authorized; }
  catch { return false; }
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api<T>(path: string, options: RequestInit = {}, superRetry = false): Promise<T> {
  const token = sessionStorage.getItem("ems_token");
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;

  const extraHeaders: Record<string, string> = {};
  if (options.headers && typeof options.headers === "object") {
    for (const [k, v] of Object.entries(options.headers)) {
      extraHeaders[k] = v as string;
    }
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const payload = typeof data === "object" && data !== null
      ? data as { error?: unknown; code?: unknown; details?: unknown }
      : {};
    if (payload.code === "SUPER_PASSWORD_REQUIRED" && !superRetry && superPrompt) {
      await superPrompt();
      if (token !== sessionStorage.getItem("ems_token")) throw new ApiError("Session changed. Retry the action.", 401);
      return api<T>(path, options, true);
    }
    throw new ApiError(
      typeof payload.error === "string" ? payload.error : "Request failed",
      res.status,
      typeof payload.code === "string" ? payload.code : undefined,
      typeof payload.details === "object" && payload.details !== null
        ? payload.details as Record<string, unknown>
        : undefined,
    );
  }
  return data as T;
}

export function superPasswordHeaders(_password: string): Record<string, string> {
  // Verification is session-bound; never resend the password on protected actions.
  return {};
}

export async function authenticatedBlobUrl(path: string): Promise<string> {
  const token = sessionStorage.getItem("ems_token");
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token ?? ""}` },
  });
  if (!res.ok) throw new ApiError("Unable to open document", res.status);
  return URL.createObjectURL(await res.blob());
}

export async function openAuthenticatedFile(path: string): Promise<void> {
  const popup = window.open("", "_blank");
  if (popup) popup.opener = null;
  try {
    const url = await authenticatedBlobUrl(path);
    if (popup) popup.location.replace(url);
    else window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    popup?.close();
    throw error;
  }
}

// Download a PDF — sends auth token, triggers browser download
export async function downloadPdf(path: string, filename: string) {
  const token = sessionStorage.getItem("ems_token");
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token ?? ""}` },
  });
  if (!res.ok) { alert("Failed to generate PDF. Try again."); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Download or trigger any file download
export async function downloadFile(path: string, filename: string) {
  const token = sessionStorage.getItem("ems_token");
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token ?? ""}` },
  });
  if (!res.ok) { alert("Failed to download file."); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
