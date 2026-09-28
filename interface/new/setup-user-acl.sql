-- ============================================================================
-- OpenEMR Admin User Setup — password, group, and ACL configuration
-- ============================================================================
-- Run this AFTER setup-oauth-client.sql and setup-globals.php
-- Usage: mysql -u openemr -popenemr openemr < interface/new/setup-user-acl.sql
-- ============================================================================

-- 1. Add password to users_secure (OpenEMR reads password from here, not users)
DELETE FROM users_secure WHERE username = 'admin';
INSERT INTO users_secure (id, username, password, last_update, last_password_update)
VALUES (1, 'admin', '$2y$10$MJc9gfDVy2/K17QGr6vpre2FuS1fU9AJ/iKqY8YZKq10R/pVpjQI6', NOW(), NOW());

-- 2. Add user to groups table
DELETE FROM groups WHERE user = 'admin';
INSERT INTO groups (id, name, user) VALUES (1, 'admin', 'admin');

-- 3. Check if gacl_aro_groups has default entries
INSERT IGNORE INTO gacl_aro_groups (id, parent_id, lft, rgt, name, value)
SELECT 1, 0, 0, 9999, 'Admin Group', 'Admin Group'
WHERE NOT EXISTS (SELECT 1 FROM gacl_aro_groups WHERE id = 1);

-- 4. Create ARO entry for the admin user (if not exists)
INSERT IGNORE INTO gacl_aro (id, section_value, value, order_value, name, hidden)
SELECT 1, 'users', 'admin', 0, 'Admin', 0
WHERE NOT EXISTS (SELECT 1 FROM gacl_aro WHERE value = 'admin' AND section_value = 'users');

-- 5. Map user to group
INSERT IGNORE INTO gacl_groups_aro_map (group_id, aro_id)
SELECT 1, 1
WHERE NOT EXISTS (SELECT 1 FROM gacl_groups_aro_map WHERE group_id = 1 AND aro_id = 1);

SELECT 'Admin user setup complete' AS status;
