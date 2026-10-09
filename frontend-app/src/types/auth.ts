export type SessionMode = "employee" | "admin" | "client" | "selection_required";

export type AuthUser = {
  id: number;
  name: string;
  email: string | null;
  cnic?: string | null;
  role: string;
  system_role: string;
  employee_id?: number | null;
  client_id?: number | null;
  mode: SessionMode;
  requires_mode_selection: boolean;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};
