-- ============================================================================
-- OpenEMR New UI — OAuth2 Client Registration (SQL)
-- ============================================================================
-- Run this SQL against your OpenEMR database to register the React SPA
-- as an OAuth2/OIDC client for PKCE-based authentication.
--
-- USAGE:
--   mysql -u root -p openemr < interface/new/setup-oauth-client.sql
--
-- PREREQUISITES:
--   1. OpenEMR must have OAuth2 keys generated (Admin -> System -> OAuth2 Keys)
--   2. Replace {site_id} with your actual site ID (e.g., 'default', 'site_1')
-- ============================================================================

SET @client_id := 'openemr-react-client';
SET @site_id := 'default';  -- ← CHANGE THIS to your site ID

-- Remove existing client with same ID (idempotent)
DELETE FROM `oauth_clients` WHERE `client_id` = @client_id;

INSERT INTO `oauth_clients` (
    `client_id`, `client_secret`, `client_role`, `client_name`,
    `registration_token`, `registration_uri_path`, `register_date`, `revoke_date`,
    `contacts`, `redirect_uri`, `grant_types`, `scope`, `user_id`, `site_id`,
    `is_confidential`, `logout_redirect_uris`, `is_enabled`,
    `skip_ehr_launch_authorization_flow`, `dsi_type`
) VALUES (
    @client_id,                     -- client_id
    '',                             -- client_secret (empty = public/PKCE client)
    'user',                         -- client_role
    'OpenEMR React SPA',            -- client_name
    '',                             -- registration_token
    '',                             -- registration_uri_path
    NOW(),                          -- register_date
    NULL,                           -- revoke_date
    'admin@example.com',            -- contacts
    CONCAT_WS('|',                  -- redirect_uri (pipe-separated)
        'http://localhost:5173/app/callback',
        'http://localhost:5173/callback'
    ),
    'authorization_code|refresh_token',  -- grant_types
    'openid email profile api:oemr api:fhir api:patient api:allergy api:medication api:appointment api:encounter',  -- scope
    NULL,                           -- user_id
    @site_id,                       -- site_id
    0,                              -- is_confidential (0 = public/PKCE)
    CONCAT_WS('|',                  -- logout_redirect_uris
        'http://localhost:5173/app/login'
    ),
    1,                              -- is_enabled (1 = enabled)
    0,                              -- skip_ehr_launch_authorization_flow
    0                               -- dsi_type (0 = none)
);

-- ============================================================================
-- Verify: SELECT client_id, client_name, is_enabled FROM oauth_clients WHERE client_id = 'openemr-react-client';
-- ============================================================================
