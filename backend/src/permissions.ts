export type Permission =
  | "dashboard:view"
  | "recent_activity:view"
  | "employees:manage"
  | "clients:manage"
  | "projects:manage"
  | "finance:manage"
  | "reports:view"
  | "attendance:read"
  | "attendance:analytics"
  | "attendance:reports"
  | "attendance:settings:manage"
  | "leave:manage"
  | "holidays:manage"
  | "password_resets:manage"
  | "employee_letters:manage"
  | "applications:manage"
  | "email:send"
  | "super_password:use"
  | "employee:promote_admin"
  | "super_password:change";

const ADMIN_PERMISSIONS: Permission[] = [
  "dashboard:view",
  "employees:manage",
  "clients:manage",
  "projects:manage",
  "finance:manage",
  "reports:view",
  "attendance:read",
  "attendance:analytics",
  "attendance:reports",
  "attendance:settings:manage",
  "leave:manage",
  "holidays:manage",
  "password_resets:manage",
  "employee_letters:manage",
  "applications:manage",
  "email:send",
  "super_password:use",
];

const ROLE_PERMISSIONS: Record<string, ReadonlySet<Permission>> = {
  super_admin: new Set<Permission>([
    ...ADMIN_PERMISSIONS,
    "recent_activity:view",
    "employee:promote_admin",
    "super_password:change",
  ]),
  admin: new Set<Permission>(ADMIN_PERMISSIONS),
  employee: new Set<Permission>(),
};

export function hasPermission(role: string | undefined, permission: Permission): boolean {
  return Boolean(role && ROLE_PERMISSIONS[role]?.has(permission));
}
