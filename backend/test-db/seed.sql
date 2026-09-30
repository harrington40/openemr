-- ---------------------------------------------------------------------------
-- OpenRx synthetic seed data
-- ---------------------------------------------------------------------------
-- Everything below is INVENTED. No production rows are copied, which is the
-- whole point: the test database must never contain real patient information.
--
-- It provides just enough baseline for the backend to boot cleanly and for the
-- authenticated API tests to have something to read:
--
--   * two staff accounts (an administrator and a physician)
--   * three patients, including one with a portal credential
--   * one appointment
--
-- Credentials (test-only, safe to publish):
--   admin    / OpenRxTest123
--   dr.test  / OpenRxTest123
--
-- Re-running this file is safe: every insert is keyed and uses INSERT ...
-- ON DUPLICATE KEY UPDATE or a fixed primary key.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Staff accounts
-- ---------------------------------------------------------------------------
-- Every account is inserted BY USERNAME, never by id. `users.id` is
-- AUTO_INCREMENT and may already hold rows the application created
-- (inventory.manager, for one), so supplying an id made ON DUPLICATE KEY UPDATE
-- silently overwrite an unrelated account — and left users_secure attached to
-- the wrong username. `username` has no unique index either, hence the explicit
-- NOT EXISTS guard that keeps this file re-runnable.
--
-- OpenEMR stores uuids as binary(16), hence the hex decode.
--
-- Password for all five accounts is OpenRxTest123 (bcrypt, cost 10). Test-only.
--   admin          approved administrator
--   dr.test        approved physician
--   pending.user   awaiting approval   | these three must NOT be able to log in,
--   rejected.user  registration refused| and the authentication tests assert
--   inactive.user  approved, disabled  | exactly that
INSERT INTO users (uuid, username, fname, lname, title, specialty, active,
                   authorized, main_menu_role, calendar_color,
                   registration_status, can_edit_providers, can_view_charts,
                   can_edit_charges)
SELECT UNHEX(REPLACE('10000000-0000-0000-0000-000000000001', '-', '')),
       'admin', 'Ada', 'Administrator', 'System Administrator', 'Administrative',
       1, 1, 'admin', '#0d6efd', 'approved', 1, 1, 1
FROM (SELECT 1) AS seed
WHERE NOT EXISTS (SELECT 1 FROM users WHERE BINARY username = 'admin');

INSERT INTO users (uuid, username, fname, lname, title, specialty, active,
                   authorized, main_menu_role, calendar_color,
                   registration_status, can_edit_providers, can_view_charts,
                   can_edit_charges)
SELECT UNHEX(REPLACE('10000000-0000-0000-0000-000000000002', '-', '')),
       'dr.test', 'Dana', 'Test', 'MD', 'Family Medicine',
       1, 1, 'physician', '#198754', 'approved', 0, 1, 0
FROM (SELECT 1) AS seed
WHERE NOT EXISTS (SELECT 1 FROM users WHERE BINARY username = 'dr.test');

INSERT INTO users (uuid, username, fname, lname, active, authorized,
                   main_menu_role, registration_status)
SELECT UNHEX(REPLACE('10000000-0000-0000-0000-000000000003', '-', '')),
       'pending.user', 'Pat', 'Pending', 0, 0, 'standard', 'pending'
FROM (SELECT 1) AS seed
WHERE NOT EXISTS (SELECT 1 FROM users WHERE BINARY username = 'pending.user');

INSERT INTO users (uuid, username, fname, lname, active, authorized,
                   main_menu_role, registration_status)
SELECT UNHEX(REPLACE('10000000-0000-0000-0000-000000000004', '-', '')),
       'rejected.user', 'Rita', 'Rejected', 0, 0, 'standard', 'rejected'
FROM (SELECT 1) AS seed
WHERE NOT EXISTS (SELECT 1 FROM users WHERE BINARY username = 'rejected.user');

INSERT INTO users (uuid, username, fname, lname, active, authorized,
                   main_menu_role, registration_status)
SELECT UNHEX(REPLACE('10000000-0000-0000-0000-000000000005', '-', '')),
       'inactive.user', 'Ivan', 'Inactive', 0, 0, 'standard', 'approved'
FROM (SELECT 1) AS seed
WHERE NOT EXISTS (SELECT 1 FROM users WHERE BINARY username = 'inactive.user');

-- users_secure keys on the same id, so resolve it from the username rather than
-- assuming one.
INSERT INTO users_secure (id, username, password)
SELECT id, username,
       '$2b$10$Mm8e/7WUxhNWBXuSb70VF.Rfm3J6RFepf4dXMMiqQkH4PCI5Lc4CS'
FROM users
WHERE BINARY username IN
      ('admin', 'dr.test', 'pending.user', 'rejected.user', 'inactive.user')
ON DUPLICATE KEY UPDATE password = VALUES(password);

-- ---------------------------------------------------------------------------
-- Patients
-- ---------------------------------------------------------------------------
INSERT INTO patient_data (pid, pubpid, fname, lname, mname, DOB, sex,
                          street, city, state, postal_code, phone_home,
                          email, public_id, insurance_type,
                          patient_responsibility_percent, approved_at)
VALUES
    (1, 'RX-TEST-00001', 'Pia',   'Patient',   'Q', '1985-03-14', 'Female',
     '1 Synthetic Way', 'Testville', 'TS', '00001', '555-0100',
     'pia.patient@example.test',   'RX-2608-T0001', 'insured',   20, NOW()),
    (2, 'RX-TEST-00002', 'Patel', 'Sample',    'R', '1972-11-02', 'Male',
     '2 Synthetic Way', 'Testville', 'TS', '00001', '555-0101',
     'patel.sample@example.test',  'RX-2608-T0002', 'self_pay', 100, NOW()),
    (3, 'RX-TEST-00003', 'Robin', 'Placeholder','S', '1994-07-21', 'Other',
     '3 Synthetic Way', 'Testville', 'TS', '00001', '555-0102',
     'robin.placeholder@example.test', 'RX-2608-T0003', 'self_pay', 100, NOW())
ON DUPLICATE KEY UPDATE
    fname = VALUES(fname),
    lname = VALUES(lname),
    public_id = VALUES(public_id);

-- ---------------------------------------------------------------------------
-- A scheduled appointment (provider 2, patient 1)
-- ---------------------------------------------------------------------------
INSERT INTO openemr_postcalendar_events
    (pc_eid, pc_catid, pc_multiple, pc_aid, pc_pid, pc_title,
     pc_eventDate, pc_startTime, pc_duration, pc_apptstatus, pc_time)
VALUES
    (1, 5, 0, 2, 1, 'Synthetic follow-up visit',
     DATE_ADD(CURDATE(), INTERVAL 1 DAY), '09:00:00', 900, '-', NOW())
ON DUPLICATE KEY UPDATE
    pc_pid = VALUES(pc_pid),
    pc_eventDate = VALUES(pc_eventDate);
