<?php
/**
 * OpenEMR New UI — OAuth2 Client Registration (PHP CLI)
 *
 * Registers the React SPA as an OAuth2 client for PKCE authentication.
 * Run from the OpenEMR root directory.
 *
 * USAGE:
 *   php interface/new/setup-oauth-client.php [site_id]
 *
 * EXAMPLES:
 *   php interface/new/setup-oauth-client.php          # uses 'default'
 *   php interface/new/setup-oauth-client.php site_1   # custom site
 *
 * PREREQUISITES:
 *   1. OpenEMR must be installed and configured
 *   2. OAuth2 keys must be generated (Admin → System → OAuth2 Keys)
 *   3. Run from the openemr root directory
 */

declare(strict_types=1);

$siteId = $argv[1] ?? 'default';
$baseDir = __DIR__ . '/../..';

// Bootstrap OpenEMR
chdir($baseDir);
require_once $baseDir . '/vendor/autoload.php';

use OpenEMR\Common\Auth\OpenIDConnect\Repositories\ClientRepository;
use OpenEMR\Common\Utils\RandomGenUtils;

// Configuration
$clientId = 'openemr-react-client';
$clientName = 'OpenEMR React SPA';
$redirectUris = [
    'http://localhost:5173/app/callback',
    'http://localhost:5173/callback',
];
$logoutRedirectUris = [
    'http://localhost:5173/app/login',
];
$grantTypes = ['authorization_code', 'refresh_token'];
$scopes = 'openid email profile api:oemr api:fhir api:patient api:allergy api:medication api:appointment api:encounter';

echo "=== OpenEMR OAuth2 Client Registration ===\n\n";
echo "Site ID:     {$siteId}\n";
echo "Client ID:   {$clientId}\n";
echo "Client Name: {$clientName}\n\n";

// Check if client already exists
$repo = new ClientRepository();
$existingClient = null;
try {
    $existingClient = $repo->getClientEntity($clientId);
} catch (\Throwable $e) {
    // Client doesn't exist yet — that's fine
}

if ($existingClient !== null) {
    echo "[!] Client '{$clientId}' already exists. Skipping.\n";
    echo "    You can manage it at: /interface/smart/admin-client.php\n";
    exit(0);
}

try {
    $repo->insertNewClient(
        $clientId,
        [
            'client_secret' => '',  // empty = public/PKCE
            'client_role' => 'user',
            'client_name' => $clientName,
            'redirect_uri' => implode('|', $redirectUris),
            'grant_types' => implode('|', $grantTypes),
            'scope' => $scopes,
            'logout_redirect_uris' => implode('|', $logoutRedirectUris),
            'is_confidential' => '0',
            'is_enabled' => '1',
            'skip_ehr_launch_authorization_flow' => '0',
            'dsi_type' => 'none',
            'contacts' => 'admin@example.com',
        ],
        $siteId
    );
    echo "[✓] Client registered successfully!\n\n";
    echo "  Client ID:     {$clientId}\n";
    echo "  Grant Types:   authorization_code, refresh_token\n";
    echo "  Redirect URIs:\n";
    foreach ($redirectUris as $uri) {
        echo "    - {$uri}\n";
    }
    echo "  Scopes:        {$scopes}\n";
    echo "  Auth Type:     PKCE (public client, no secret)\n\n";
    echo "  Manage at:     /interface/smart/admin-client.php\n";
} catch (\Throwable $e) {
    echo "[✗] Failed to register client: " . $e->getMessage() . "\n";
    echo "\nAlternative: Run the SQL script instead:\n";
    echo "  mysql -u root -p openemr < interface/new/setup-oauth-client.sql\n";
    exit(1);
}
