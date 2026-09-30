-- ---------------------------------------------------------------------------
-- OpenRx schema patches
-- ---------------------------------------------------------------------------
-- `sql/database.sql` is the upstream OpenEMR base schema. OpenRx adds a number
-- of columns to *core* tables on top of it. Some of those are created at
-- runtime by the backend (`ALTER TABLE ... ADD COLUMN` in a try/catch), but
-- several are NOT — they only exist in the production database because they
-- were added there by hand.
--
-- That gap means a database built from this repository is not currently a
-- faithful copy of production: `users.registration_status` is read during
-- login, `patient_data.public_id` backs the patient portal, and
-- `patient_data.approved_at` drives chart approval. Applying this file closes
-- the gap so a fresh database — test or otherwise — matches what the code
-- expects.
--
-- Every statement is idempotent (MariaDB supports ADD COLUMN IF NOT EXISTS),
-- so this file is safe to run repeatedly and against an existing database.
--
-- TODO(openrx): fold these into the runtime self-healing `ensureSchema()`
-- methods so a fresh deployment cannot miss them, and keep this file as the
-- explicit record until then.
-- ---------------------------------------------------------------------------

-- users ---------------------------------------------------------------------
-- Registration/approval workflow (auth.controller.ts, admin.service.ts).
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_status VARCHAR(16) NULL;
-- Per-user privileges checked by the guards and admin endpoints.
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_edit_providers TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_charts TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_edit_charges TINYINT(1) NOT NULL DEFAULT 0;
-- Calendar colour used by the provider schedule UI.
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_color VARCHAR(20) NULL;

-- patient_data --------------------------------------------------------------
-- Sequential patient-facing identifier (e.g. RX-2608-00001) used by the portal.
ALTER TABLE patient_data ADD COLUMN IF NOT EXISTS public_id VARCHAR(32) NULL;
-- Chart approval + sharing state.
ALTER TABLE patient_data ADD COLUMN IF NOT EXISTS approved_at DATETIME NULL;
ALTER TABLE patient_data ADD COLUMN IF NOT EXISTS chart_shared TINYINT(1) NOT NULL DEFAULT 0;
-- Billing split between insurer and patient (billing.service.ts).
ALTER TABLE patient_data ADD COLUMN IF NOT EXISTS insurance_type VARCHAR(20) NOT NULL DEFAULT 'self_pay';
ALTER TABLE patient_data ADD COLUMN IF NOT EXISTS patient_responsibility_percent INT NOT NULL DEFAULT 100;

-- procedure_order -----------------------------------------------------------
ALTER TABLE procedure_order ADD COLUMN IF NOT EXISTS specimen_id INT NULL;

-- Encounter-based billing joins (also self-healed at runtime by BillingService).
ALTER TABLE ar_activity ADD COLUMN IF NOT EXISTS encounter INT(11) NOT NULL DEFAULT 0;
ALTER TABLE billing ADD COLUMN IF NOT EXISTS order_id INT NULL;
ALTER TABLE billing ADD COLUMN IF NOT EXISTS reverses_id INT NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_ref VARCHAR(40) NULL;

-- ---------------------------------------------------------------------------
-- Tables that exist in production but are declared NOWHERE in the repository
-- ---------------------------------------------------------------------------
-- These four back TypeORM entities (`*.entity.ts`) but no service creates them
-- and `synchronize` is off, so a database built from this repository does not
-- have them: /license/status, /documents and /imaging all fail with a 5xx. They
-- are reproduced here so the test database matches production.
--
-- TODO(openrx): these should move into the services' ensureSchema() methods
-- (or into migrations) — right now a fresh production deployment is missing
-- them, which is a real bug, not just a test-database problem.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS licenses (
  id           INT(11) NOT NULL AUTO_INCREMENT,
  licenseKey   VARCHAR(30) NOT NULL,
  tier         VARCHAR(20) DEFAULT 'basic',
  activatedAt  DATETIME DEFAULT NULL,
  expiresAt    DATETIME NOT NULL,
  status       VARCHAR(20) DEFAULT 'active',
  customerName VARCHAR(255) DEFAULT '',
  maxUsers     INT(11) DEFAULT 5,
  createdAt    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY licenseKey (licenseKey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS avatars (
  id           INT(11) NOT NULL AUTO_INCREMENT,
  userId       INT(11) NOT NULL,
  originalName VARCHAR(255) NOT NULL,
  mimeType     VARCHAR(100) NOT NULL,
  sizeBytes    BIGINT(20) NOT NULL,
  b2FileId     VARCHAR(255) NOT NULL,
  b2Path       VARCHAR(500) NOT NULL,
  createdAt    DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY userId (userId),
  KEY idx_userId (userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS imaging (
  id           INT(11) NOT NULL AUTO_INCREMENT,
  pid          INT(11) NOT NULL,
  eid          INT(11) DEFAULT NULL,
  type         VARCHAR(20) NOT NULL,
  originalName VARCHAR(255) NOT NULL,
  mimeType     VARCHAR(100) NOT NULL,
  sizeBytes    BIGINT(20) NOT NULL,
  b2FileId     VARCHAR(255) NOT NULL,
  b2Path       VARCHAR(500) NOT NULL,
  description  VARCHAR(500) DEFAULT '',
  uploadedBy   VARCHAR(100) NOT NULL,
  createdAt    DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pid (pid),
  KEY idx_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- InventoryService ensures the approval columns on `inventory_requests` at
-- lines ~520-530, but only creates the table at ~595. On a database where the
-- table does not exist yet the ALTERs fail ("Table doesn't exist"), the table
-- is then created WITHOUT these columns, and every query that selects them
-- breaks. Pre-creating the table with the production columns makes the ALTERs
-- no-ops and the CREATE TABLE IF NOT EXISTS harmless.
CREATE TABLE IF NOT EXISTS inventory_requests (
  id                  INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_number      VARCHAR(50) DEFAULT NULL,
  department          VARCHAR(100) DEFAULT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  requested_by_user_id INT DEFAULT NULL,
  requested_by_name   VARCHAR(255) DEFAULT NULL,
  reason              VARCHAR(255) DEFAULT NULL,
  notes               TEXT,
  approved_by_user_id INT DEFAULT NULL,
  approved_at         DATETIME DEFAULT NULL,
  approved_by_name    VARCHAR(255) DEFAULT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_req_status (status),
  KEY idx_req_department (department)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS documents_secure (
  id               INT(11) NOT NULL AUTO_INCREMENT,
  originalName     VARCHAR(255) NOT NULL,
  mimeType         VARCHAR(100) NOT NULL,
  sizeBytes        BIGINT(20) NOT NULL,
  b2FileId         VARCHAR(255) NOT NULL,
  b2Path           VARCHAR(500) NOT NULL,
  accessCodeHash   VARCHAR(255) NOT NULL,
  plainCode        VARCHAR(10) DEFAULT '',
  pid              INT(11) DEFAULT 0,
  uploaderUserId   INT(11) DEFAULT 0,
  uploadedBy       VARCHAR(100) NOT NULL,
  recipientContact VARCHAR(255) DEFAULT '',
  recipientName    VARCHAR(255) DEFAULT '',
  category         VARCHAR(50) DEFAULT 'general',
  status           VARCHAR(20) DEFAULT 'pending',
  notes            TEXT DEFAULT NULL,
  accessCount      INT(11) DEFAULT 0,
  lastAccessedAt   DATETIME DEFAULT NULL,
  createdAt        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pid (pid),
  KEY idx_uploader (uploaderUserId),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
