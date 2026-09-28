<?php
/**
 * Populate required OpenEMR globals for basic operation.
 *
 * Usage: php interface/new/setup-globals.php
 */

require_once __DIR__ . '/../../vendor/autoload.php';

// Connect to database
$dbHost = 'localhost';
$dbPort = '3306';
$dbLogin = 'openemr';
$dbPass = 'openemr';
$dbName = 'openemr';

try {
    $pdo = new PDO("mysql:host=$dbHost;port=$dbPort;dbname=$dbName;charset=utf8mb4", $dbLogin, $dbPass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // List of essential globals for basic OAuth2 and login operation
    $essentialGlobals = [
        ['gbl_auto_save_demographics', '1'],
        ['gbl_portal_onsite_two', '1'],
        ['rest_api', '1'],
        ['rest_fhir_api', '1'],
        ['rest_portal_api', '1'],
        ['site_addr_oath', 'localhost:8082'],
        ['oauth_scopes', 'openid email profile api:oemr api:fhir api:patient api:allergy api:medication api:appointment api:encounter api:practitioner api:procedure api:drug api:insurance'],
        ['rest_system_scopes_api', '0'],
        ['gbl_auto_push_ccd', '0'],
        ['gbl_upload_maxsize', '0'],
        ['gbl_timezone', 'US/Eastern'],
        ['language_default', '1'],
        ['language_menu_hide', '1'],
        ['default_encounter_type', '5'],
        ['default_facility', '0'],
        ['default_date_format', '0'],
        ['default_time_format', '0'],
        ['default_currency', 'USD'],
        ['default_weight_unit', '3'],
        ['default_height_unit', '3'],
        ['default_temperature_unit', '1'],
        ['default_thermometer', '1'],
        ['default_eye_colors', 'system'],
        ['default_ethnicity', 'system'],
        ['default_race', 'system'],
        ['default_sexual_orientation', 'system'],
        ['default_gender_identity', 'system'],
        ['default_allow_ins_comminication', '0'],
        ['default_ins_coverage_type', '1'],
        ['default_ippf_specific_forms', '0'],
        ['default_claim_renewal_time', '0'],
        ['default_auto_courtesy_letter', '0'],
        ['default_auto_collection_letter', '0'],
        ['default_erase_downloaded', '0'],
        ['default_x12_eligibility_req', '0'],
        ['default_x12_eligibility_timer', '0'],
        ['gbl_use_charges_panel', '0'],
        ['gbl_flat_copay', '0'],
        ['gbl_pat_ledger', '0'],
        ['gbl_payment_gateway', '0'],
        ['gbl_demo_gateway', '1'],
        ['gbl_stripe_id', ''],
        ['gbl_stripe_secret_key', ''],
        ['gbl_stripe_publish_key', ''],
        ['gbl_square_app_id', ''],
        ['gbl_square_location_id', ''],
        ['gbl_square_access_token', ''],
        ['gbl_stripe_payment_method', ''],
        ['gbl_square_payment_method', ''],
        ['gbl_authorizenet_api_login_id', ''],
        ['gbl_authorizenet_transaction_key', ''],
    ];

    $count = 0;
    foreach ($essentialGlobals as [$name, $value]) {
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM globals WHERE gl_name = ?");
        $stmt->execute([$name]);
        if ($stmt->fetchColumn() == 0) {
            $insert = $pdo->prepare("INSERT INTO globals (gl_name, gl_index, gl_value) VALUES (?, 0, ?)");
            $insert->execute([$name, $value]);
            $count++;
        }
    }

    echo "[✓] Inserted {$count} new globals.\n";

    $total = $pdo->query("SELECT COUNT(*) FROM globals")->fetchColumn();
    echo "Total globals: {$total}\n";
} catch (Exception $e) {
    echo "[✗] Error: " . $e->getMessage() . "\n";
    exit(1);
}
