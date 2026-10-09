export type FrontendPermission = "finance:manage" | "recent_activity:view";

const ROLE_PERMISSIONS: Record<string, ReadonlySet<FrontendPermission>> = {
  super_admin: new Set(["finance:manage", "recent_activity:view"]),
  admin: new Set(["finance:manage"]),
  employee: new Set(),
};

export function hasFrontendPermission(role: string, permission: FrontendPermission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
