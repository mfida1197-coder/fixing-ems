import { Router } from "express";
import bcrypt from "bcrypt";
import type { PoolConnection } from "mysql2/promise";
import { pool } from "../db";
import { audit } from "../audit";
import { salaryValues } from "../finance/salary";
import { encrypt, decrypt } from "../crypto";
import { requireAuth, requirePermission, requireSelectedMode, requireSuperPassword, AuthedRequest } from "../middleware/auth";

const router = Router();

// Employee self-profile: accessible by authenticated employee or admin
router.get("/me", requireAuth, requireSelectedMode, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const [rows] = await pool.execute(
      `SELECT e.id, e.employee_code, e.full_name, e.father_name, e.designation,
              e.status, e.joining_date, e.leaving_date, e.employment_type,
              e.email, e.phone, e.salary_currency,
              e.basic_salary, e.allowances, e.deductions,
              e.cnic, e.cnic_enc, e.cnic_last4, e.address_enc, e.bank_name_enc, e.bank_account_enc,
              d.name AS department
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.id = (SELECT employee_id FROM users WHERE id = ?)
       LIMIT 1`,
      [userId]
    );
    const emp = (rows as any[])[0];
    if (!emp) {
      return res.status(404).json({ error: "Employee record not found" });
    }
    const cnic = emp.cnic || (emp.cnic_enc ? decrypt(emp.cnic_enc) : null);
    res.json({
      employee: {
        id: emp.id,
        employee_code: emp.employee_code,
        full_name: emp.full_name,
        father_name: emp.father_name,
        designation: emp.designation,
        department: emp.department ?? null,
        joining_date: emp.joining_date,
        status: emp.status,
        employment_type: emp.employment_type,
        email: emp.email,
        phone: emp.phone,
        cnic: cnic,
        cnic_last4: emp.cnic_last4,
        salary_currency: emp.salary_currency,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch employee details" });
  }
});

// Admin-only employee management routes
router.use(requireAuth, requirePermission("employees:manage"));

router.get("/", async (_req, res) => {
  const [rows] = await pool.execute(
    `SELECT e.id, e.employee_code, e.full_name, e.designation, e.status,
            e.joining_date, d.name AS department
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     ORDER BY e.employee_code`
  );
  res.json({ employees: rows });
});

router.post("/", async (req: AuthedRequest, res) => {
  let connection: PoolConnection | undefined;
  try {
    const {
      employee_code, full_name, father_name, email, phone, designation,
      joining_date, employment_type, status,
      cnic, address, bank_name, bank_account,
      password, attendance_mode,
    } = req.body ?? {};

    let salary;
    try { salary = salaryValues(req.body ?? {}); }
    catch (caught) { return res.status(400).json({ error: caught instanceof Error ? caught.message : "Invalid salary" }); }
    if (status !== undefined && !["active", "resigned", "terminated"].includes(status)) {
      return res.status(400).json({ error: "Status must be active, resigned or terminated" });
    }

    if (!employee_code || !full_name || !designation || !joining_date) {
      return res.status(400).json({ error: "employee_code, full_name, designation, and joining_date are required" });
    }

    if (/\d/.test(designation)) {
      return res.status(400).json({ error: "Designation cannot contain numbers" });
    }

    const todayStr = new Date().toLocaleDateString("en-CA");
    if (joining_date > todayStr) {
      return res.status(400).json({ error: "Joining date cannot be a future date" });
    }

    const cleanCnic = cnic ? String(cnic).replace(/\D/g, "") : null;
    if (!cleanCnic || cleanCnic.length !== 13) {
      return res.status(400).json({ error: "CNIC must be exactly 13 digits (numbers only)" });
    }

    // Check whether that exact 13-digit CNIC already exists in the database
    const [existingEmpCnic] = await pool.execute(
      "SELECT id FROM employees WHERE cnic = ? LIMIT 1",
      [cleanCnic]
    );
    if ((existingEmpCnic as any[]).length > 0) {
      return res.status(409).json({ error: "An employee with this CNIC already exists." });
    }

    const [existingUserCnic] = await pool.execute(
      "SELECT id FROM users WHERE cnic = ? LIMIT 1",
      [cleanCnic]
    );
    if ((existingUserCnic as any[]).length > 0) {
      return res.status(409).json({ error: "This CNIC is already registered. Please use a different CNIC." });
    }

    // Check employee code uniqueness
    const [existingCode] = await pool.execute(
      "SELECT id FROM employees WHERE employee_code = ? LIMIT 1",
      [employee_code]
    );
    if ((existingCode as any[]).length > 0) {
      return res.status(409).json({ error: `Employee code "${employee_code}" is already assigned to another employee` });
    }

    if (phone && String(phone).trim()) {
      const cleanPhone = String(phone).replace(/\D/g, "");
      if (!/^[+]?[\d\s\-()]+$/.test(String(phone).trim()) || cleanPhone.length < 10 || cleanPhone.length > 15) {
        return res.status(400).json({ error: "Invalid phone number format" });
      }
    }

    if (email && String(email).trim()) {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(String(email).trim())) {
        return res.status(400).json({ error: "Invalid email address format" });
      }
    }

    // Default password is ash@001 if not provided by admin
    const empPassword = String(password || "ash@001").trim();
    if (!empPassword) {
      return res.status(400).json({ error: "Password cannot be empty" });
    }
    const passwordHash = await bcrypt.hash(empPassword, 12);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [result] = await connection.execute(
      `INSERT INTO employees
         (employee_code, full_name, father_name, email, phone, designation,
          joining_date, employment_type, status, cnic,
          cnic_enc, address_enc, bank_name_enc, bank_account_enc,
          salary_currency, basic_salary, allowances, deductions,
          cnic_last4, bank_last4)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_code, full_name, father_name ?? null,
        email && String(email).trim() ? String(email).trim() : null,
        phone && String(phone).trim() ? String(phone).trim() : null,
        String(designation).trim(),
        joining_date, employment_type ?? "full_time", status ?? "active",
        cleanCnic,
        encrypt(cleanCnic),
        address ? encrypt(address) : null,
        bank_name ? encrypt(bank_name) : null,
        bank_account ? encrypt(bank_account) : null,
        salary.salary_currency ?? "PKR",
        salary.basic_salary ?? null, salary.allowances ?? null, salary.deductions ?? null,
        cleanCnic.slice(-4),
        bank_account ? bank_account.replace(/\D/g, "").slice(-4) : null,
      ]
    );

    const id = (result as any).insertId;
    const attendanceMode = attendance_mode === "gps" ? "gps" : "remote";

    // Create employee user account using 13-digit numeric CNIC as login username
    const [roleRows] = await connection.execute("SELECT id FROM roles WHERE name = 'employee' LIMIT 1");
    const employeeRoleId = (roleRows as any[])[0]?.id ?? 3;

    await connection.execute(
      `INSERT INTO users (role_id, full_name, email, cnic, employee_id, password_hash, is_active)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [
        employeeRoleId,
        full_name,
        email && String(email).trim() ? String(email).trim() : null,
        cleanCnic,
        id,
        passwordHash,
      ]
    );
    await connection.execute(
      `INSERT IGNORE INTO employee_attendance_settings
         (employee_id, attendance_mode, weekly_target_minutes, monthly_target_minutes)
       VALUES (?, ?, 0, 0)`,
      [id, attendanceMode],
    );

    await audit(req.user!.id, "create", "employee", id, { employee_code, full_name }, req.ip ?? null, connection);
    await connection.commit();
    res.status(201).json({ id });
  } catch (err: any) {
    if (connection) await connection.rollback();
    if (err.code === "ER_DUP_ENTRY") {
      if (err.sqlMessage?.includes("cnic") || err.message?.includes("cnic") || err.message?.includes("uq_employees_cnic")) {
        return res.status(409).json({ error: "An employee with this CNIC already exists." });
      }
      if (err.sqlMessage?.includes("employee_code") || err.message?.includes("employee_code")) {
        return res.status(409).json({ error: "An employee with this employee code already exists." });
      }
    }
    res.status(500).json({ error: err.message || "Failed to create employee" });
  } finally {
    connection?.release();
  }
});

// DETAIL — everything shown directly (no masking)
router.get("/:id", async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT e.id, e.employee_code, e.full_name, e.father_name, e.email, e.phone,
            e.designation, e.department_id, e.joining_date, e.leaving_date,
            e.employment_type, e.status, e.salary_currency,
            e.basic_salary, e.allowances, e.deductions,
            e.cnic, e.cnic_enc, e.address_enc, e.bank_name_enc, e.bank_account_enc,
            pa.role_on_project AS assigned_role,
            p.name AS assigned_project,
            r.name AS system_role
     FROM employees e
     LEFT JOIN project_assignments pa ON pa.employee_id = e.id AND pa.removed_at IS NULL
     LEFT JOIN projects p ON p.id = pa.project_id
     LEFT JOIN users u ON u.employee_id = e.id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE e.id = ? LIMIT 1`,
    [req.params.id]
  );
  const e = (rows as any[])[0];
  if (!e) return res.status(404).json({ error: "Employee not found" });

  res.json({
    employee: {
      id: e.id, employee_code: e.employee_code, full_name: e.full_name,
      father_name: e.father_name, email: e.email, phone: e.phone,
      designation: e.designation, department_id: e.department_id,
      joining_date: e.joining_date, leaving_date: e.leaving_date,
      employment_type: e.employment_type, status: e.status,
      salary_currency: e.salary_currency,
      basic_salary: e.basic_salary, allowances: e.allowances, deductions: e.deductions,
      cnic: e.cnic || (e.cnic_enc ? decrypt(e.cnic_enc) : null),
      address: e.address_enc ? decrypt(e.address_enc) : null,
      bank_name: e.bank_name_enc ? decrypt(e.bank_name_enc) : null,
      bank_account: e.bank_account_enc ? decrypt(e.bank_account_enc) : null,
      assigned_project: e.assigned_project ?? null,
      assigned_role: e.assigned_role ?? null,
      system_role: e.system_role ?? null,
    },
  });
});

router.post(
  "/:id/promote",
  requirePermission("employee:promote_admin"),
  requireSuperPassword,
  async (req: AuthedRequest, res, next) => {
    try {
    const employeeId = Number(req.params.id);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      return res.status(400).json({ error: "Invalid employee ID" });
    }

    const [rows] = await pool.execute(
      `SELECT e.id, u.id AS linked_user_id, r.name AS current_role
       FROM employees e
       LEFT JOIN users u ON u.employee_id = e.id
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE e.id = ?
       LIMIT 2`,
      [employeeId],
    );
    if ((rows as any[]).length > 1) return res.status(409).json({ error: "Employee account relationship requires review" });
    const employee = (rows as any[])[0];
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    if (!employee.linked_user_id) {
      return res.status(409).json({ error: "Employee does not have a linked login account" });
    }
    if (employee.current_role === "admin") {
      return res.status(409).json({ error: "Employee is already an Admin" });
    }
    if (employee.current_role === "super_admin") {
      return res.status(409).json({ error: "Super Admin accounts cannot be changed through employee promotion" });
    }

    const [roleRows] = await pool.execute(
      "SELECT id FROM roles WHERE name = 'admin' AND is_active = TRUE LIMIT 1",
    );
    const adminRoleId = (roleRows as any[])[0]?.id;
    if (!adminRoleId) return res.status(503).json({ error: "Admin role is not active" });

    await pool.execute("UPDATE users SET role_id = ? WHERE id = ?", [adminRoleId, employee.linked_user_id]);
    await audit(
      req.user!.id,
      "update",
      "user",
      Number(employee.linked_user_id),
      { employee_id: employeeId, role: { from: employee.current_role, to: "admin" } },
      req.ip ?? null,
    );
      return res.json({ ok: true, role: "admin" });
    } catch (error) {
      next(error);
    }
  },
);

// UPDATE — requires the Super Password for this operation
router.post("/:id/demote", requirePermission("employee:promote_admin"), requireSuperPassword, async (req: AuthedRequest, res, next) => {
  const employeeId = Number(req.params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return res.status(400).json({ error: "Invalid employee ID" });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT e.id, u.id AS linked_user_id, r.name AS current_role FROM employees e
       JOIN users u ON u.employee_id = e.id
       JOIN roles r ON r.id = u.role_id WHERE e.id = ? LIMIT 2 FOR UPDATE`, [employeeId]);
    if ((rows as any[]).length > 1) {
      await connection.rollback();
      return res.status(409).json({ error: "Employee account relationship requires review" });
    }
    const employee = (rows as any[])[0];
    if (!employee || employee.current_role !== "admin") {
      await connection.rollback();
      return res.status(409).json({ error: "Only linked Admin accounts can be demoted to Employee" });
    }
    const [roles] = await connection.execute("SELECT id FROM roles WHERE name = 'employee' AND is_active = TRUE LIMIT 1");
    const employeeRoleId = (roles as any[])[0]?.id;
    if (!employeeRoleId) { await connection.rollback(); return res.status(503).json({ error: "Employee role is not active" }); }
    await connection.execute("UPDATE users SET role_id = ? WHERE id = ?", [employeeRoleId, employee.linked_user_id]);
    await audit(req.user!.id, "update", "user", Number(employee.linked_user_id), { employee_id: employeeId, role: { from: "admin", to: "employee" } }, req.ip ?? null, connection);
    await connection.commit();
    return res.json({ ok: true, role: "employee" });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

router.put("/:id", requireSuperPassword, async (req: AuthedRequest, res) => {
  let connection: PoolConnection | undefined;
  let committed = false;
  try {
    let salary;
    try { salary = salaryValues(req.body ?? {}); }
    catch (caught) { return res.status(400).json({ error: caught instanceof Error ? caught.message : "Invalid salary" }); }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    // Lock the parent row so concurrent password assignments cannot create two accounts.
    // SELECT * also permits read-only legacy inspection when user_id still exists.
    const [employeeRows] = await connection.execute("SELECT * FROM employees WHERE id = ? FOR UPDATE", [req.params.id]);
    const employee = (employeeRows as any[])[0];
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const newPassword = req.body.password ? String(req.body.password).trim() : "";
    const [linkedUsers] = await connection.execute("SELECT id FROM users WHERE employee_id = ? LIMIT 2 FOR UPDATE", [req.params.id]);
    if ((linkedUsers as any[]).length > 1) return res.status(409).json({ error: "Employee account relationship requires review" });
    const linkedUserId = (linkedUsers as any[])[0]?.id;
    if (newPassword && employee.user_id != null && Number(employee.user_id) !== Number(linkedUserId)) {
      return res.status(409).json({ error: "Legacy employee account relationship requires reconciliation before assigning a password" });
    }
    if (newPassword && linkedUserId && "user_id" in employee) {
      const [claims] = await connection.execute("SELECT id FROM employees WHERE user_id = ? AND id <> ? LIMIT 1 FOR UPDATE", [linkedUserId, req.params.id]);
      if ((claims as any[]).length) return res.status(409).json({ error: "Legacy employee account relationship requires reconciliation before assigning a password" });
    }
    const allowed = [
      "employee_code", "full_name", "father_name", "email", "phone", "designation",
      "joining_date", "leaving_date", "employment_type", "status",
      "salary_currency", "basic_salary", "allowances", "deductions",
    ];
    const sets: string[] = [];
    const vals: any[] = [];

    if (req.body.designation !== undefined && /\d/.test(req.body.designation)) {
      return res.status(400).json({ error: "Designation cannot contain numbers" });
    }

    const todayStr = new Date().toLocaleDateString("en-CA");
    if (req.body.joining_date !== undefined && req.body.joining_date > todayStr) {
      return res.status(400).json({ error: "Joining date cannot be a future date" });
    }

    if (req.body.phone !== undefined && req.body.phone) {
      const cleanPhone = String(req.body.phone).replace(/\D/g, "");
      if (!/^[+]?[\d\s\-()]+$/.test(String(req.body.phone).trim()) || cleanPhone.length < 10 || cleanPhone.length > 15) {
        return res.status(400).json({ error: "Invalid phone number format" });
      }
    }

    if (req.body.email !== undefined && req.body.email) {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(String(req.body.email).trim())) {
        return res.status(400).json({ error: "Invalid email address format" });
      }
    }

    // Employee Code uniqueness check (only if a new code is being submitted)
    if (req.body.employee_code !== undefined) {
      const newCode = String(req.body.employee_code).trim();
      if (!newCode) {
        return res.status(400).json({ error: "Employee code cannot be empty" });
      }
      const [dupRows] = await connection.execute(
        "SELECT id FROM employees WHERE employee_code = ? AND id != ? LIMIT 1",
        [newCode, req.params.id]
      );
      if ((dupRows as any[]).length > 0) {
        return res.status(409).json({ error: `Employee code "${newCode}" is already assigned to another employee` });
      }
    }

    for (const key of allowed) {
      if (req.body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(key in salary ? salary[key] : req.body[key]); }
    }
    if (req.body.cnic !== undefined) {
      const cleanCnic = req.body.cnic ? String(req.body.cnic).replace(/\D/g, "") : null;
      if (cleanCnic) {
        if (cleanCnic.length !== 13) {
          return res.status(400).json({ error: "CNIC must be exactly 13 digits (numbers only)" });
        }

        // Check if another employee has this CNIC
        const [dupEmp] = await connection.execute(
          "SELECT id FROM employees WHERE cnic = ? AND id != ? LIMIT 1",
          [cleanCnic, req.params.id]
        );
        if ((dupEmp as any[]).length > 0) {
          return res.status(409).json({ error: "An employee with this CNIC already exists." });
        }

        // Check if another user has this CNIC
        const [dupUser] = await connection.execute(
          "SELECT id FROM users WHERE cnic = ? AND (employee_id IS NULL OR employee_id != ?) LIMIT 1",
          [cleanCnic, req.params.id]
        );
        if ((dupUser as any[]).length > 0) {
          return res.status(409).json({ error: "This CNIC is already registered to another user. Please use a different CNIC." });
        }

        sets.push("cnic = ?", "cnic_enc = ?", "cnic_last4 = ?");
        vals.push(cleanCnic, encrypt(cleanCnic), cleanCnic.slice(-4));
      } else {
        sets.push("cnic = NULL", "cnic_enc = NULL", "cnic_last4 = NULL");
      }
    }
    if (req.body.address !== undefined) {
      sets.push("address_enc = ?");
      vals.push(req.body.address ? encrypt(req.body.address) : null);
    }
    if (req.body.bank_name !== undefined) {
      sets.push("bank_name_enc = ?");
      vals.push(req.body.bank_name ? encrypt(req.body.bank_name) : null);
    }
    if (req.body.bank_account !== undefined) {
      sets.push("bank_account_enc = ?", "bank_last4 = ?");
      vals.push(req.body.bank_account ? encrypt(req.body.bank_account) : null,
                req.body.bank_account ? String(req.body.bank_account).replace(/\D/g, "").slice(-4) : null);
    }

    if (!sets.length && !req.body.password) return res.status(400).json({ error: "Nothing to update" });
    if (req.body.status !== undefined && !["active", "resigned", "terminated"].includes(req.body.status)) {
      return res.status(400).json({ error: "Status must be active, resigned or terminated" });
    }

    if (sets.length) {
      vals.push(req.params.id);
      await connection.execute(`UPDATE employees SET ${sets.join(", ")} WHERE id = ?`, vals);
    }

    // Preserve existing name/email/CNIC synchronization; passwords change only explicitly.
    if (req.body.full_name !== undefined) {
      await connection.execute("UPDATE users SET full_name = ? WHERE employee_id = ?", [req.body.full_name, req.params.id]);
    }
    if (req.body.email !== undefined) {
      await connection.execute("UPDATE users SET email = ? WHERE employee_id = ?", [req.body.email && String(req.body.email).trim() ? String(req.body.email).trim() : null, req.params.id]);
    }
    if (req.body.cnic !== undefined) {
      const cleanCnic = req.body.cnic ? String(req.body.cnic).replace(/\D/g, "") : null;
      await connection.execute("UPDATE users SET cnic = ? WHERE employee_id = ?", [cleanCnic || null, req.params.id]);
    }
    // Create an account only for an explicit password assignment, never for a normal edit.
    if (newPassword) {
      const newPasswordHash = await bcrypt.hash(newPassword, 12);
      if (linkedUserId) {
        await connection.execute("UPDATE users SET password_hash = ? WHERE id = ? AND employee_id = ?", [newPasswordHash, linkedUserId, req.params.id]);
      } else {
        const [roles] = await connection.execute("SELECT id FROM roles WHERE name = 'employee' LIMIT 1");
        const roleId = (roles as any[])[0]?.id;
        if (!roleId) return res.status(503).json({ error: "Employee role is not configured" });
        const [currentRows] = await connection.execute("SELECT * FROM employees WHERE id = ? LIMIT 1", [req.params.id]);
        const current = (currentRows as any[])[0];
        await connection.execute(
          "INSERT INTO users (role_id, full_name, email, cnic, employee_id, password_hash, is_active) VALUES (?, ?, ?, ?, ?, ?, TRUE)",
          [roleId, current.full_name, current.email && String(current.email).trim() ? String(current.email).trim() : null, current.cnic || (current.cnic_enc ? decrypt(current.cnic_enc) : null), employee.id, newPasswordHash],
        );
      }
    }

    await audit(req.user!.id, "update", "employee", Number(req.params.id), { fields: sets.map(s => s.split(" ")[0]) }, req.ip ?? null, connection);
    await connection.commit();
    committed = true;
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") {
      if (err.sqlMessage?.includes("cnic") || err.message?.includes("cnic") || err.message?.includes("uq_employees_cnic")) {
        return res.status(409).json({ error: "An employee with this CNIC already exists." });
      }
      if (err.sqlMessage?.includes("employee_code") || err.message?.includes("employee_code")) {
        return res.status(409).json({ error: "An employee with this employee code already exists." });
      }
    }
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "An existing account conflicts with this employee; reconcile it before assigning a password" });
    res.status(500).json({ error: err.message || "Failed to update employee" });
  } finally {
    if (connection) {
      try { if (!committed) await connection.rollback(); }
      finally { connection.release(); }
    }
  }
});

// DELETE — requires the Super Password for this operation
router.delete("/:id", requireSuperPassword, async (req: AuthedRequest, res) => {
  const conn = await (pool as any).getConnection();
  try {
    await conn.beginTransaction();

    const empId = Number(req.params.id);

    // 1. Lock the employee before resolving its account.
    const [empRows] = await conn.execute(
      "SELECT id, full_name FROM employees WHERE id = ? LIMIT 1 FOR UPDATE",
      [empId]
    );
    const emp = (empRows as any[])[0];
    if (!emp) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: "Employee not found" });
    }

    // 2. Never choose an arbitrary account if legacy duplicates remain.
    const [uRows] = await conn.execute("SELECT id FROM users WHERE employee_id = ? LIMIT 2 FOR UPDATE", [empId]);
    if ((uRows as any[]).length > 1) {
      await conn.rollback(); conn.release();
      return res.status(409).json({ error: "Employee account relationship requires review" });
    }
    const userId: number | null = (uRows as any[])[0]?.id ?? null;

    if (userId && Number(userId) === Number(req.user!.id)) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ error: "You cannot delete your own employee account" });
    }

    const [historyRows] = await conn.execute(
      `SELECT
         (SELECT COUNT(*) FROM attendance_sessions WHERE employee_id = ?) AS attendance_count,
         (SELECT COUNT(*) FROM leave_requests WHERE employee_id = ?) AS leave_count,
         (SELECT COUNT(*) FROM employee_letters WHERE employee_id = ?) AS letter_count,
         (SELECT COUNT(*) FROM general_applications WHERE employee_id = ?) AS application_count`,
      [empId, empId, empId, empId],
    );
    const history = (historyRows as any[])[0];
    if (Number(history.attendance_count) > 0 || Number(history.leave_count) > 0 || Number(history.letter_count) > 0 || Number(history.application_count) > 0) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({
        error: "Employee cannot be permanently deleted while attendance, leave, application, or official letter history exists",
        code: "EMPLOYEE_HAS_PROTECTED_HISTORY",
      });
    }

    if (userId) {
      // 3. Nullify audit_logs.user_id for this user.
      //    The FK is ON DELETE SET NULL so the DB would do this automatically,
      //    but we do it explicitly inside the transaction for clarity and safety.
      //    Audit history rows are preserved — only the user reference is cleared.
      await conn.execute(
        "UPDATE audit_logs SET user_id = NULL WHERE user_id = ?",
        [userId]
      );

      // 4. Delete the user account.
      //    - reveal_attempts and super_password_attempts: ON DELETE CASCADE.
      //    - employee_documents.uploaded_by: FK is ON DELETE SET NULL → cleared automatically.
      await conn.execute("DELETE FROM users WHERE id = ?", [userId]);
    }

    // 5. Detach any salary/finance transactions that reference this employee.
    //    transactions.employee_id has no cascade; NULLing it preserves the
    //    financial record while allowing the employee row to be removed.
    await conn.execute(
      "UPDATE transactions SET employee_id = NULL WHERE employee_id = ?",
      [empId]
    );

    // 6. Delete the employee record.
    //    - employee_documents: FK is ON DELETE CASCADE → deleted automatically.
    //    - project_assignments: FK is ON DELETE CASCADE → deleted automatically.
    await conn.execute("DELETE FROM employees WHERE id = ?", [empId]);

    await conn.commit();
    conn.release();

    // 7. Record the deletion in audit log under the acting admin's account.
    await audit(req.user!.id, "delete", "employee", empId, { full_name: emp.full_name }, req.ip ?? null);

    res.json({ ok: true });
  } catch (err: any) {
    try { await conn.rollback(); } catch (_) {}
    conn.release();
    console.error("Employee deletion failed:", err);
    res.status(500).json({ error: err.message || "Failed to delete employee" });
  }
});

export default router;
