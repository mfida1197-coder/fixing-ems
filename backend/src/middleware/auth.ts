import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createHash } from "crypto";
import { hasPermission, Permission } from "../permissions";
import { SuperPasswordError, verifySuperPassword, superAuthorizedUntil, grantSuperAuthorization } from "../security/superPassword";
import { pool } from "../db";

export type SessionMode = "employee" | "admin" | "client" | "selection_required";

export interface AuthedRequest extends Request {
  user?: {
    id: number;
    system_role: string;
    role: string;
    mode: SessionMode;
    mode_selected: boolean;
    email: string | null;
    cnic?: string | null;
    employee_id?: number | null;
    client_id?: number | null;
    name?: string;
    sessionKey: string;
  };
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  let payload: any;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET as string) as any;
  } catch {
    return res.status(401).json({ error: "Session expired. Log in again" });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.full_name, u.email, u.cnic, u.employee_id, u.client_id, u.is_active,
              r.name AS role, r.is_active AS role_active, c.status AS client_status
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN clients c ON c.id = u.client_id
       WHERE u.id = ?
       LIMIT 1`,
      [payload.sub],
    );
    const currentUser = (rows as any[])[0];
    if (!currentUser || !currentUser.is_active || !currentUser.role_active
      || (currentUser.role === "client" && currentUser.client_status !== "active")) {
      return res.status(401).json({ error: "Account is no longer active" });
    }

    const systemRole = String(currentUser.role);
    const tokenSystemRole = String(payload.system_role || payload.role || "");
    const employeeId = currentUser.employee_id ?? null;
    const modeSelected = payload.mode_selected === true;
    let mode: SessionMode;
    let effectiveRole = systemRole;

    if (systemRole === "admin" && employeeId) {
      if (tokenSystemRole !== systemRole || !modeSelected || !["employee", "admin"].includes(payload.mode)) {
        mode = "selection_required";
        effectiveRole = "mode_selection";
      } else {
        mode = payload.mode;
        effectiveRole = mode === "employee" ? "employee" : "admin";
      }
    } else if (systemRole === "employee") {
      mode = "employee";
      effectiveRole = "employee";
    } else if (systemRole === "client") {
      mode = "client";
      effectiveRole = "client";
    } else {
      mode = "admin";
    }

    req.user = {
      id: payload.sub,
      system_role: systemRole,
      role: effectiveRole,
      mode,
      mode_selected:
        systemRole === "admin" && employeeId
          ? mode === "selection_required"
            ? false
            : modeSelected
          : true,
      email: currentUser.email,
      cnic: currentUser.cnic,
      employee_id: employeeId,
      client_id: currentUser.client_id ?? null,
      name: currentUser.full_name,
      sessionKey: createHash("sha256").update(token).digest("hex"),
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Not allowed" });
    }
    next();
  };
}

export function requireSelectedMode(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.mode === "selection_required") {
    return res.status(403).json({ error: "Choose Employee or Admin mode before continuing" });
  }
  next();
}

export function requirePermission(permission: Permission) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!hasPermission(req.user?.role, permission)) {
      return res.status(403).json({ error: "Not allowed" });
    }
    next();
  };
}

export async function requireSuperPassword(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user || !hasPermission(req.user.role, "super_password:use")) return res.status(403).json({ error: "Not allowed" });
    if (superAuthorizedUntil(req.user.id, req.user.sessionKey)) return next();
    const value = req.headers["x-super-password"];
    const password = Array.isArray(value) ? value[0] : value;
    if (!password) return res.status(403).json({ error: "Super Password is required", code: "SUPER_PASSWORD_REQUIRED" });
    await verifySuperPassword(req.user.id, typeof password === "string" ? password : "", req.ip ?? null);
    grantSuperAuthorization(req.user.id, req.user.sessionKey);
    next();
  } catch (error) {
    if (error instanceof SuperPasswordError) {
      return res.status(error.status).json({ error: error.message });
    }
    next(error);
  }
}
