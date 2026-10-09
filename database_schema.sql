-- ============================================================
-- ASHTECH DIGITAL SOLUTIONS — EMS DATABASE SCHEMA (PHASE 0)
-- Stack: MySQL 8.x | Backend: Node.js | Frontend: React
-- Date: 30 July 2026
-- ============================================================
-- NOTES FOR DEVELOPER:
-- 1. Login passwords and the singleton Super Password -> bcrypt hash (cost 12+), done in Node, never plain text.
-- 2. Sensitive employee fields (cnic, bank_*, address) -> AES-256-GCM encrypted
--    at APPLICATION layer before insert. Encryption key lives in server .env only.
--    Columns are VARBINARY to hold ciphertext.
-- 3. Protected mutations require the Super Password for each operation.
-- 4. Every INSERT/UPDATE/DELETE and every Super Password attempt -> audit_logs.
-- ============================================================

CREATE DATABASE IF NOT EXISTS ashtech_ems
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ashtech_ems;

-- ------------------------------------------------------------
-- ROLES & USERS (role schema built now; only super_admin active in Phase 0)
-- ------------------------------------------------------------
CREATE TABLE roles (
  id          TINYINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(30) NOT NULL UNIQUE,          -- super_admin, admin, employee, client
  is_active   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO roles (name, is_active) VALUES
  ('super_admin', TRUE),
  ('admin',       TRUE),
  ('employee',    TRUE),
  ('client',      TRUE);

CREATE TABLE users (
  id                   INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  role_id              TINYINT UNSIGNED NOT NULL,
  full_name            VARCHAR(100) NOT NULL,
  email                VARCHAR(150) NULL UNIQUE,
  cnic                 VARCHAR(13) NULL UNIQUE,
  employee_id          INT UNSIGNED NULL UNIQUE,
  client_id            INT UNSIGNED NULL UNIQUE,
  password_hash        VARCHAR(100) NOT NULL,        -- bcrypt
  reveal_password_hash VARCHAR(100) NULL,            -- legacy migration source; no longer used by the application
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at        TIMESTAMP NULL,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- Legacy Reveal attempts retained for existing installations; new protected operations use super_password_attempts.
CREATE TABLE reveal_attempts (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  success     BOOLEAN NOT NULL,
  ip_address  VARCHAR(45) NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_reveal_user_time (user_id, created_at)
);

-- Singleton, securely hashed Super Password used for protected operations.
-- Legacy per-user reveal hashes remain only for backward-compatible migration.
CREATE TABLE system_security_settings (
  id                  TINYINT UNSIGNED PRIMARY KEY,
  super_password_hash VARCHAR(100) NOT NULL,
  updated_by          INT UNSIGNED NULL,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE super_password_attempts (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  success     BOOLEAN NOT NULL,
  ip_address  VARCHAR(45) NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_super_password_user_time (user_id, created_at)
);

-- ------------------------------------------------------------
-- EMPLOYEES  (general tier + sensitive tier in one table;
--             sensitive columns encrypted, masked by default)
-- ------------------------------------------------------------
CREATE TABLE departments (
  id    SMALLINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name  VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE employees (
  id               INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  employee_code    VARCHAR(20) NOT NULL UNIQUE,      -- e.g. ASH-001
  full_name        VARCHAR(100) NOT NULL,
  father_name      VARCHAR(100) NULL,
  email            VARCHAR(150) NULL,
  phone            VARCHAR(30)  NULL,
  designation      VARCHAR(80)  NOT NULL,
  department_id    SMALLINT UNSIGNED NULL,
  joining_date     DATE NOT NULL,
  leaving_date     DATE NULL,
  employment_type  ENUM('full_time','part_time','contract','intern') NOT NULL DEFAULT 'full_time',
  status           ENUM('active','resigned','terminated') NOT NULL DEFAULT 'active',
  cnic             VARCHAR(13)  NULL UNIQUE,         -- 13-digit numeric CNIC / username
  -- ---------- SENSITIVE TIER (AES-256 encrypted at app layer) ----------
  cnic_enc         VARBINARY(512) NULL,
  address_enc      VARBINARY(1024) NULL,
  bank_name_enc    VARBINARY(512) NULL,
  bank_account_enc VARBINARY(512) NULL,
  salary_amount    DECIMAL(12,2) NULL,               -- current monthly salary
  basic_salary    DECIMAL(12,2) NULL,               -- current monthly basic salary
  deductions   DECIMAL(12,2) NULL,
  allowances    DECIMAL(12,2) NULL,
  salary_currency  CHAR(3) NOT NULL DEFAULT 'PKR',
  -- last-4 stored plain for masked display without decryption:
  cnic_last4       CHAR(4) NULL,
  bank_last4       CHAR(4) NULL,
  -- --------------------------------------------------------------------
  photo_path       VARCHAR(255) NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id),
  INDEX idx_emp_status (status)
);

-- Restrict employee removal while an account remains linked; never cascade accounts.
ALTER TABLE users ADD CONSTRAINT fk_users_employee
  FOREIGN KEY (employee_id) REFERENCES employees(id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Uploaded employee documents (contract, CV, CNIC copy, etc.)
CREATE TABLE employee_documents (
  id           INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  employee_id  INT UNSIGNED NOT NULL,
  doc_type     ENUM('cnic','contract','cv','degree','other') NOT NULL,
  file_path    VARCHAR(255) NOT NULL,
  uploaded_by  INT UNSIGNED NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Public employee password-reset requests. Only the bcrypt hash is retained while pending;
-- final review clears it regardless of approval or rejection.
CREATE TABLE password_reset_requests (
  id                    BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  employee_id           INT UNSIGNED NOT NULL,
  user_id               INT UNSIGNED NOT NULL,
  pending_password_hash VARCHAR(100) NULL,
  status                ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at           TIMESTAMP NULL,
  reviewed_by           INT UNSIGNED NULL,
  rejection_reason      VARCHAR(300) NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_password_reset_status_requested (status, requested_at),
  INDEX idx_password_reset_user_status (user_id, status)
);

-- Generated official employee letters. Small identity snapshots keep historical
-- PDFs stable without duplicating the complete employee record.
CREATE TABLE employee_letters (
  id                       BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  employee_id              INT UNSIGNED NOT NULL,
  letter_type              VARCHAR(40) NOT NULL,
  issue_date               DATE NOT NULL,
  effective_date           DATE NOT NULL,
  subject                  VARCHAR(200) NOT NULL,
  body_text                TEXT NOT NULL,
  new_designation          VARCHAR(100) NULL,
  notes                    VARCHAR(500) NULL,
  employee_name_snapshot   VARCHAR(100) NOT NULL,
  employee_code_snapshot   VARCHAR(20) NOT NULL,
  designation_snapshot     VARCHAR(80) NOT NULL,
  project_snapshot         VARCHAR(150) NULL,
  file_name                VARCHAR(180) NOT NULL,
  created_by               INT UNSIGNED NULL,
  created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_employee_letters_employee_created (employee_id, created_at),
  INDEX idx_employee_letters_type_issue (letter_type, issue_date)
);

-- Employee-originated general applications, separate from leave requests.
CREATE TABLE general_applications (
  id                       INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  employee_id              INT UNSIGNED NOT NULL,
  submitted_by             INT UNSIGNED NOT NULL,
  category                 VARCHAR(100) NOT NULL,
  subject                  VARCHAR(200) NOT NULL,
  application_date         DATE NOT NULL,
  body_text                TEXT NOT NULL,
  status                   ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  submitted_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at              TIMESTAMP NULL,
  reviewed_by              INT UNSIGNED NULL,
  review_note              VARCHAR(500) NULL,
  employee_name_snapshot   VARCHAR(150) NOT NULL,
  employee_code_snapshot   VARCHAR(50) NOT NULL,
  designation_snapshot     VARCHAR(100) NOT NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_general_applications_employee (employee_id, submitted_at),
  INDEX idx_general_applications_status (status, submitted_at)
);

-- ------------------------------------------------------------
-- ATTENDANCE FOUNDATION
-- Timestamps ending in _utc are stored as UTC DATETIME(3).
-- work_date and leave/holiday dates are interpreted in timezone_name.
-- There are no automatic weekends or pre-seeded holidays.
-- ------------------------------------------------------------
CREATE TABLE organization_attendance_settings (
  id                       TINYINT UNSIGNED PRIMARY KEY,
  office_timezone          VARCHAR(64) NOT NULL DEFAULT 'Asia/Karachi',
  office_latitude          DECIMAL(10,7) NULL,
  office_longitude         DECIMAL(10,7) NULL,
  allowed_radius_meters    DECIMAL(10,2) NULL,
  updated_by               INT UNSIGNED NULL,
  created_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_org_attendance_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_org_attendance_singleton CHECK (id = 1),
  CONSTRAINT chk_org_attendance_latitude
    CHECK (office_latitude IS NULL OR office_latitude BETWEEN -90 AND 90),
  CONSTRAINT chk_org_attendance_longitude
    CHECK (office_longitude IS NULL OR office_longitude BETWEEN -180 AND 180),
  CONSTRAINT chk_org_attendance_location_bundle CHECK (
    (office_latitude IS NULL AND office_longitude IS NULL AND allowed_radius_meters IS NULL)
    OR
    (office_latitude IS NOT NULL AND office_longitude IS NOT NULL AND allowed_radius_meters > 0)
  )
);

INSERT INTO organization_attendance_settings (id, office_timezone)
VALUES (1, 'Asia/Karachi');

CREATE TABLE employee_attendance_settings (
  employee_id              INT UNSIGNED PRIMARY KEY,
  attendance_mode          ENUM('gps','remote') NOT NULL DEFAULT 'remote',
  weekly_target_minutes    INT UNSIGNED NOT NULL DEFAULT 0,
  monthly_target_minutes   INT UNSIGNED NOT NULL DEFAULT 0,
  updated_by               INT UNSIGNED NULL,
  created_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_employee_attendance_settings_employee
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_attendance_settings_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE attendance_sessions (
  id                       BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  employee_id              INT UNSIGNED NOT NULL,
  work_date                DATE NOT NULL,
  timezone_name            VARCHAR(64) NOT NULL DEFAULT 'Asia/Karachi',
  attendance_mode          ENUM('gps','remote') NOT NULL,
  state                    ENUM('open','completed','incomplete') NOT NULL DEFAULT 'open',
  check_in_at_utc          DATETIME(3) NOT NULL,
  check_out_at_utc         DATETIME(3) NULL,
  incomplete_reason        VARCHAR(255) NULL,
  open_employee_id         INT UNSIGNED
    GENERATED ALWAYS AS (CASE WHEN state = 'open' THEN employee_id ELSE NULL END) STORED,
  created_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_attendance_sessions_employee
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  CONSTRAINT chk_attendance_session_checkout_order
    CHECK (check_out_at_utc IS NULL OR check_out_at_utc >= check_in_at_utc),
  CONSTRAINT chk_attendance_session_state CHECK (
    (state = 'completed' AND check_out_at_utc IS NOT NULL)
    OR
    (state IN ('open','incomplete') AND check_out_at_utc IS NULL)
  ),
  INDEX idx_attendance_sessions_employee_date (employee_id, work_date, check_in_at_utc),
  INDEX idx_attendance_sessions_date_state (work_date, state),
  UNIQUE INDEX uq_attendance_one_open_session (open_employee_id)
);

CREATE TABLE attendance_breaks (
  id                       BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  attendance_session_id    BIGINT UNSIGNED NOT NULL,
  state                    ENUM('open','completed','incomplete') NOT NULL DEFAULT 'open',
  break_out_at_utc         DATETIME(3) NOT NULL,
  break_in_at_utc          DATETIME(3) NULL,
  incomplete_reason        VARCHAR(255) NULL,
  open_session_id          BIGINT UNSIGNED
    GENERATED ALWAYS AS (CASE WHEN state = 'open' THEN attendance_session_id ELSE NULL END) STORED,
  created_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_attendance_breaks_session
    FOREIGN KEY (attendance_session_id) REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
  CONSTRAINT chk_attendance_break_order
    CHECK (break_in_at_utc IS NULL OR break_in_at_utc >= break_out_at_utc),
  CONSTRAINT chk_attendance_break_state CHECK (
    (state = 'completed' AND break_in_at_utc IS NOT NULL)
    OR
    (state IN ('open','incomplete') AND break_in_at_utc IS NULL)
  ),
  INDEX idx_attendance_breaks_session_time (attendance_session_id, break_out_at_utc),
  INDEX idx_attendance_breaks_state (state),
  UNIQUE INDEX uq_attendance_one_open_break (open_session_id)
);

-- Durable date-level outcome. Session/break rows remain the underlying event
-- evidence, including an original check-in with no fabricated checkout.
CREATE TABLE attendance_day_statuses (
  employee_id               INT UNSIGNED NOT NULL,
  work_date                 DATE NOT NULL,
  status                    ENUM('absent','present','leave','short_leave','holiday') NOT NULL,
  finalized_at_utc          DATETIME(3) NOT NULL,
  PRIMARY KEY (employee_id, work_date),
  CONSTRAINT fk_attendance_day_statuses_employee
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  INDEX idx_attendance_day_statuses_date_status (work_date, status)
);

CREATE TABLE holidays (
  id                       INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  holiday_date             DATE NOT NULL UNIQUE,
  name                     VARCHAR(120) NOT NULL,
  created_by               INT UNSIGNED NULL,
  updated_by               INT UNSIGNED NULL,
  created_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_holidays_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_holidays_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_holiday_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
  INDEX idx_holidays_date (holiday_date)
);

CREATE TABLE leave_requests (
  id                       BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  employee_id              INT UNSIGNED NOT NULL,
  leave_type               ENUM('full_day','short_hours') NOT NULL DEFAULT 'full_day',
  start_date               DATE NOT NULL,
  end_date                 DATE NOT NULL,
  start_time               TIME NULL,
  end_time                 TIME NULL,
  timezone_name            VARCHAR(64) NOT NULL DEFAULT 'Asia/Karachi',
  reason                   TEXT NULL,
  status                   ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by             INT UNSIGNED NULL,
  reviewed_by              INT UNSIGNED NULL,
  reviewed_at              DATETIME(3) NULL,
  created_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_leave_requests_employee
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  CONSTRAINT fk_leave_requests_requested_by
    FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_leave_requests_reviewed_by
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_leave_date_order CHECK (end_date >= start_date),
  CONSTRAINT chk_leave_type_fields CHECK (
    (leave_type = 'full_day' AND start_time IS NULL AND end_time IS NULL)
    OR
    (leave_type = 'short_hours' AND start_date = end_date
      AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  ),
  INDEX idx_leave_employee_dates (employee_id, start_date, end_date),
  INDEX idx_leave_status_dates (status, start_date, end_date)
);

-- ------------------------------------------------------------
-- CLIENTS (minimal in Phase 0 — required for projects & inflows)
-- ------------------------------------------------------------
CREATE TABLE clients (
  id             INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  company_name   VARCHAR(150) NOT NULL,
  contact_person VARCHAR(100) NULL,
  email          VARCHAR(150) NULL,
  phone          VARCHAR(30)  NULL,
  country        VARCHAR(60)  NULL,
  ntn            VARCHAR(30)  NULL,                  -- numeric NTN (National Tax Number)
  status         ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

ALTER TABLE users
  ADD CONSTRAINT fk_users_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

-- ------------------------------------------------------------
-- PROJECTS (linked to client; handover tracked explicitly)
-- ------------------------------------------------------------
CREATE TABLE projects (
  id             INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  client_id      INT UNSIGNED NOT NULL,
  name           VARCHAR(150) NOT NULL,
  description    TEXT NULL,
  status         ENUM('upcoming','ongoing','done','handed_over') NOT NULL DEFAULT 'upcoming',
  start_date     DATE NULL,
  end_date       DATE NULL,
  expected_handover_date DATE NULL,
  handover_date  DATE NULL,                          -- set when status = handed_over
  project_value  DECIMAL(14,2) NULL,
  value_currency CHAR(3) NOT NULL DEFAULT 'USD',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  INDEX idx_proj_status (status)
);

CREATE TABLE project_progress_updates (
  id               BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  project_id       INT UNSIGNED NOT NULL,
  progress_percent TINYINT UNSIGNED NOT NULL,
  report           TEXT NOT NULL,
  created_by       INT UNSIGNED NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id),
  CHECK (progress_percent BETWEEN 0 AND 100),
  INDEX idx_project_progress_history (project_id, created_at, id)
);

CREATE TABLE project_requirements (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  project_id      INT UNSIGNED NOT NULL,
  client_id       INT UNSIGNED NOT NULL,
  current_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  INDEX idx_project_requirement_project (project_id, updated_at)
);

CREATE TABLE project_requirement_versions (
  id             BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  requirement_id BIGINT UNSIGNED NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  content        TEXT NOT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (requirement_id) REFERENCES project_requirements(id) ON DELETE CASCADE,
  UNIQUE KEY uq_project_requirement_version (requirement_id, version_number)
);

-- Which employees worked on which project
CREATE TABLE project_assignments (
  id           INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  project_id   INT UNSIGNED NOT NULL,
  employee_id  INT UNSIGNED NOT NULL,
  role_on_project VARCHAR(80) NULL,                  -- e.g. Frontend Dev, Lead
  assigned_at  DATE NULL,
  removed_at   DATE NULL,
  UNIQUE KEY uq_proj_emp (project_id, employee_id),
  FOREIGN KEY (project_id)  REFERENCES projects(id)  ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- FINANCE (multi-currency; PKR value LOCKED at transaction date)
-- ------------------------------------------------------------
CREATE TABLE finance_categories (
  id    SMALLINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  type  ENUM('inflow','outflow') NOT NULL,
  name  VARCHAR(60) NOT NULL,                        -- salary, subscription, client_payment, tools, rent...
  UNIQUE KEY uq_cat (type, name)
);

INSERT INTO finance_categories (type, name) VALUES
  ('inflow','client_payment'), ('inflow','other_income'),
  ('outflow','salary'), ('outflow','subscription'), ('outflow','tools'),
  ('outflow','marketing'), ('outflow','office'), ('outflow','other_expense');

-- Daily cached exchange rates (from API, one row per currency per day)
CREATE TABLE exchange_rates (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  currency    CHAR(3) NOT NULL,                      -- USD, AED, EUR, GBP, SAR...
  rate_to_pkr DECIMAL(12,4) NOT NULL,
  rate_date   DATE NOT NULL,
  source      VARCHAR(50) NOT NULL DEFAULT 'api',    -- api | manual
  UNIQUE KEY uq_rate (currency, rate_date)
);

-- Company finance accounts (Bank accounts, Cash in hand, digital wallets)
CREATE TABLE finance_accounts (
  id              INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  account_name    VARCHAR(100) NOT NULL,                 -- free-form invoice display name, e.g. Main Company Account
  bank_name       VARCHAR(100) NULL,                     -- actual bank/institution name, e.g. UBL
  account_number  VARCHAR(50) NULL,                      -- optional identifier (not required for cash)
  account_type    ENUM('bank','cash','digital','other') NOT NULL DEFAULT 'bank',
  currency        CHAR(3) NOT NULL DEFAULT 'PKR',
  initial_balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Internal movement between EMS accounts. These rows affect account balances
-- and histories but are not company revenue or expense transactions.
CREATE TABLE finance_account_transfers (
  id               INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  from_account_id  INT UNSIGNED NOT NULL,
  to_account_id    INT UNSIGNED NOT NULL,
  transfer_date    DATE NOT NULL,
  amount           DECIMAL(14,2) NOT NULL,
  currency         CHAR(3) NOT NULL,
  description      VARCHAR(255) NULL,
  created_by       INT UNSIGNED NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (from_account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (to_account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id),
  CHECK (from_account_id <> to_account_id),
  CHECK (amount > 0),
  INDEX idx_finance_transfer_from_date (from_account_id, transfer_date),
  INDEX idx_finance_transfer_to_date (to_account_id, transfer_date)
);

CREATE TABLE transactions (
  id                 INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  account_applied_amount   DECIMAL(14,2) NULL,
  account_applied_currency CHAR(3) NULL,
  account_exchange_rate    DECIMAL(12,4) NULL,
  invoice_number     VARCHAR(80) NULL,                       -- client-facing ASH-{CLIENT}-{PROJECT}-{SEQUENCE}
  invoice_sequence   INT UNSIGNED NULL,
  invoice_issue_date DATE NULL,
  invoice_currency   CHAR(3) NULL,
  invoice_subtotal   DECIMAL(16,2) NULL,
  invoice_tax_rate   DECIMAL(5,2) NULL,
  invoice_tax_applied TINYINT(1) NULL,                       -- persisted invoice decision; NULL for non-invoice rows
  invoice_tax_amount DECIMAL(16,2) NULL,
  invoice_total      DECIMAL(16,2) NULL,
  type               ENUM('inflow','outflow') NOT NULL,
  category_id        SMALLINT UNSIGNED NOT NULL,
  custom_category    VARCHAR(120) NULL,
  description        VARCHAR(255) NULL,
  txn_date           DATE NOT NULL,
  -- original currency amount:
  amount             DECIMAL(14,2) NOT NULL,
  currency           CHAR(3) NOT NULL DEFAULT 'PKR',
  -- LOCKED conversion (never recalculated):
  exchange_rate      DECIMAL(12,4) NOT NULL DEFAULT 1.0000,  -- rate actually received; manual override allowed
  amount_pkr         DECIMAL(16,2) NOT NULL,                 -- amount * exchange_rate, frozen forever
  payment_method     ENUM('bank_transfer','cash','card','crypto','other') NOT NULL DEFAULT 'bank_transfer',
  account_id         INT UNSIGNED NULL,                      -- internal finance account (inflow/outflow)
  bank_name          VARCHAR(100) NULL,                      -- client/sender bank for this specific transfer
  account_number     VARCHAR(50) NULL,                       -- client/sender account number for this payment
  -- optional links:
  client_id          INT UNSIGNED NULL,                 -- inflows: who paid
  project_id         INT UNSIGNED NULL,                 -- which project this relates to
  employee_id        INT UNSIGNED NULL,                 -- outflows: e.g. salary to whom
  salary_base_amount DECIMAL(14,2) NULL,                -- server-calculated basic + allowances - deductions
  salary_bonus_amount DECIMAL(14,2) NULL,               -- optional bonus included in amount
  attachment_path    VARCHAR(255) NULL,                 -- stored relative path in uploads
  attachment_name    VARCHAR(255) NULL,                 -- original filename
  attachment_mime    VARCHAR(100) NULL,                 -- MIME type (e.g. application/pdf, image/jpeg)
  attachment_size    INT UNSIGNED NULL,                 -- file size in bytes
  invoice_path       VARCHAR(255) NULL,                 -- generated invoice PDF filename in uploads/transactions
  created_by         INT UNSIGNED NOT NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES finance_categories(id),
  FOREIGN KEY (account_id)  REFERENCES finance_accounts(id) ON DELETE SET NULL,
  FOREIGN KEY (client_id)   REFERENCES clients(id),
  FOREIGN KEY (project_id)  REFERENCES projects(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (created_by)  REFERENCES users(id),
  INDEX idx_txn_date (txn_date),
  INDEX idx_txn_type (type),
  UNIQUE INDEX uq_transactions_invoice_number (invoice_number)
);

-- Row-locked per-client/project counter used for concurrency-safe invoice numbers.
CREATE TABLE invoice_sequences (
  client_id      INT UNSIGNED NOT NULL,
  project_id     INT UNSIGNED NOT NULL,
  last_sequence INT UNSIGNED NOT NULL DEFAULT 0,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, project_id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- ------------------------------------------------------------
-- AUDIT LOG (every write + every sensitive reveal)
-- ------------------------------------------------------------
CREATE TABLE audit_logs (
  id           BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id      INT UNSIGNED NULL,    -- NULL when the acting user's account has been deleted; row is preserved
  action       ENUM('create','update','delete','login','reveal_sensitive','reveal_failed','super_password_verified','super_password_failed') NOT NULL,
  entity_type  VARCHAR(40) NOT NULL,                 -- employee, client, project, transaction...
  entity_id    INT UNSIGNED NULL,
  changes_json JSON NULL,                            -- before/after for updates
  ip_address   VARCHAR(45) NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_entity (entity_type, entity_id),
  INDEX idx_audit_time (created_at)
);

-- ------------------------------------------------------------
-- GROUP CHAT
-- ------------------------------------------------------------
CREATE TABLE chat_groups (
  id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name       VARCHAR(120) NOT NULL,
  bubble     VARCHAR(3) NOT NULL,
  bubble_color CHAR(7) NOT NULL DEFAULT '#FFAE68',
  description VARCHAR(500) NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_chat_groups_updated (updated_at, id)
);

CREATE TABLE chat_messages (
  id             BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  group_id       BIGINT UNSIGNED NOT NULL,
  sender_user_id INT UNSIGNED NOT NULL,
  message        TEXT NOT NULL,
  message_type   ENUM('user','system') NOT NULL DEFAULT 'user',
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at      TIMESTAMP NULL,
  deleted_at     TIMESTAMP NULL,
  FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_user_id) REFERENCES users(id),
  INDEX idx_chat_messages_history (group_id, id),
  INDEX idx_chat_messages_sender (sender_user_id, created_at)
);

CREATE TABLE chat_group_members (
  group_id            BIGINT UNSIGNED NOT NULL,
  user_id             INT UNSIGNED NOT NULL,
  added_by            INT UNSIGNED NOT NULL,
  joined_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_read_message_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (added_by) REFERENCES users(id),
  FOREIGN KEY (last_read_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL,
  INDEX idx_chat_members_user (user_id, group_id)
);

CREATE TABLE request_notification_reads (
  user_id      INT UNSIGNED NOT NULL,
  request_type VARCHAR(32) NOT NULL,
  request_id   BIGINT UNSIGNED NOT NULL,
  read_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, request_type, request_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_request_notification_entity (request_type, request_id)
);
