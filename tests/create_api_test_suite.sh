#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/api-tests" && pwd)"

# This script bootstraps the suite from scratch. It used to overwrite every
# file it knows about, which would silently revert later work in conftest.py,
# pytest.ini and the per-domain tests. Refuse to run on an initialised suite
# unless --force is passed.
if [ -f "$ROOT/conftest.py" ] && [ "${1:-}" != "--force" ]; then
    echo "tests/api-tests is already initialised." >&2
    echo "Pass --force to regenerate and overwrite the existing suite." >&2
    exit 1
fi

mkdir -p "$ROOT"/{auth,patients,appointments,emergency,clinical,labs,billing,inventory,messaging,pharmacy,providers,administration,smart,system,bookings,ccda,documents,encounters,fda,fhir,imaging,inpatient,labreports,license,mailbox,midwife,notifications,nursing,patient-chat,portal,reference,referrals,reports,avatars}

cat > "$ROOT/pytest.ini" <<'PYEOF'
[pytest]
testpaths = .
python_files = test_*.py
python_functions = test_*
addopts = -ra

markers =
    readonly: GET/read-only API tests
    authenticated: tests requiring a valid OpenRx login
    production_write: tests that can modify production data
    destructive: DELETE/destructive tests
    later: tests intentionally disabled until prerequisites are configured
    smoke: small set of tests safe to run against production
PYEOF

cat > "$ROOT/conftest.py" <<'PYEOF'
import os

import pytest
import requests


@pytest.fixture(scope="session")
def base_url():
    return os.getenv(
        "OPENRX_API_URL",
        "https://openrx.transtechologies.com/api",
    ).rstrip("/")


@pytest.fixture(scope="session")
def api_session():
    session = requests.Session()
    session.headers.update({
        "Accept": "application/json",
        "Content-Type": "application/json",
    })

    yield session
    session.close()


@pytest.fixture(scope="session")
def auth_token():
    token = os.getenv("OPENRX_API_TOKEN")

    if not token:
        pytest.skip(
            "OPENRX_API_TOKEN is not configured; authenticated tests are disabled"
        )

    return token


@pytest.fixture(scope="session")
def auth_headers(auth_token):
    return {
        "Authorization": f"Bearer {auth_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def pytest_collection_modifyitems(config, items):
    """
    Safety policy:

    Production write/destructive tests remain skipped unless explicitly
    requested with the appropriate pytest markers.
    """

    run_writes = os.getenv("OPENRX_RUN_WRITES", "").lower() == "true"

    for item in items:
        if "production_write" in item.keywords or "destructive" in item.keywords:
            if not run_writes:
                item.add_marker(
                    pytest.mark.skip(
                        reason="Production write/destructive tests disabled"
                    )
                )
PYEOF

cat > "$ROOT/test_config.py" <<'PYEOF'
import pytest


@pytest.mark.smoke
@pytest.mark.readonly
def test_get_config(api_session, base_url):
    response = api_session.get(
        f"{base_url}/config",
        timeout=15,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["appName"] == "OpenRx"
    assert data["version"] == "1.0.0"
    assert "language" in data
PYEOF

cat > "$ROOT/system/test_system.py" <<'PYEOF'
import pytest


@pytest.mark.smoke
@pytest.mark.readonly
def test_api_config(api_session, base_url):
    response = api_session.get(f"{base_url}/config", timeout=15)
    assert response.status_code == 200


@pytest.mark.readonly
@pytest.mark.later
def test_status(api_session, base_url):
    response = api_session.get(f"{base_url}/status", timeout=15)
    assert response.status_code in (200, 401, 403)


@pytest.mark.readonly
@pytest.mark.later
def test_facilities(api_session, base_url):
    response = api_session.get(f"{base_url}/facilities", timeout=15)
    assert response.status_code in (200, 401, 403)


@pytest.mark.readonly
@pytest.mark.later
def test_devices(api_session, base_url):
    response = api_session.get(f"{base_url}/devices", timeout=15)
    assert response.status_code in (200, 401, 403)
PYEOF

cat > "$ROOT/auth/test_auth.py" <<'PYEOF'
import pytest


@pytest.mark.later
def test_login():
    pytest.skip("Login test requires a dedicated test credential and request contract")


@pytest.mark.later
def test_register():
    pytest.skip("Registration test must use a controlled test account")


@pytest.mark.later
def test_change_password():
    pytest.skip("Password-change test requires a dedicated test account")


@pytest.mark.later
def test_activate():
    pytest.skip("Activation test requires a controlled test account")


@pytest.mark.later
def test_verify_passphrase():
    pytest.skip("Passphrase test requires controlled credentials")
PYEOF

cat > "$ROOT/patients/test_patients.py" <<'PYEOF'
import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_list_patients(api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/patients",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code == 200


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_get_patient(api_session, base_url, auth_headers):
    pytest.skip("Requires a known production patient ID")


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_patient_profile(api_session, base_url, auth_headers):
    pytest.skip("Requires a known production patient ID")


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_patient_validation_preview(api_session, base_url, auth_headers):
    pytest.skip("Requires a known production patient ID")
PYEOF

cat > "$ROOT/patients/test_patient_clinical.py" <<'PYEOF'
import pytest


PATIENT_ENDPOINTS = [
    "allergies",
    "allergies/enriched",
    "appointments",
    "assessments",
    "billing",
    "care-plan",
    "ccda",
    "conditions",
    "discharge-summary",
    "eligibility",
    "encounter-breakdown",
    "encounters",
    "immunizations",
    "insurance",
    "lab/ordered-tests",
    "lab-reports",
    "medications",
    "notes",
    "observations",
    "procedures",
    "results",
    "room",
    "ros",
    "transactions",
    "vitals",
]


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
@pytest.mark.parametrize("endpoint", PATIENT_ENDPOINTS)
def test_patient_read_endpoint(endpoint, api_session, base_url, auth_headers):
    pytest.skip(
        f"Requires a known production patient ID before testing /patients/{{pid}}/{endpoint}"
    )
PYEOF

cat > "$ROOT/appointments/test_appointments.py" <<'PYEOF'
import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_appointments(api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/appointments",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code == 200


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_open_slots(api_session, base_url, auth_headers):
    pytest.skip("Requires provider/date query contract")


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_walk_ins(api_session, base_url, auth_headers):
    pytest.skip("Requires authentication and endpoint contract")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_create_appointment():
    pytest.fail(
        "Disabled: creating appointments against production requires an explicit test-data strategy"
    )


@pytest.mark.authenticated
@pytest.mark.production_write
def test_update_appointment_status():
    pytest.fail(
        "Disabled: changing appointment state in production requires an explicit test-data strategy"
    )


@pytest.mark.authenticated
@pytest.mark.destructive
def test_delete_appointment():
    pytest.fail(
        "Disabled: deleting production appointments is not allowed by default"
    )
PYEOF

cat > "$ROOT/emergency/test_emergency.py" <<'PYEOF'
import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_emergency_board(api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/board",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.production_write
def test_emergency_triage():
    pytest.fail(
        "Disabled: triage creates/changes clinical production data"
    )


@pytest.mark.authenticated
@pytest.mark.production_write
def test_emergency_reassessment():
    pytest.fail(
        "Disabled: reassessment changes clinical production data"
    )
PYEOF

cat > "$ROOT/clinical/test_clinical.py" <<'PYEOF'
import pytest


READ_ONLY_ENDPOINTS = [
    "AllergyIntolerance",
    "Condition",
    "Encounter",
    "Immunization",
    "MedicationRequest",
    "Observation",
    "Patient",
    "procedures",
    "orders",
]


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
@pytest.mark.parametrize("endpoint", READ_ONLY_ENDPOINTS)
def test_clinical_endpoint(endpoint, api_session, base_url, auth_headers):
    pytest.skip(
        f"Requires endpoint-specific query/fixture for /{endpoint}"
    )
PYEOF

cat > "$ROOT/labs/test_labs.py" <<'PYEOF'
import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_lab_catalog(api_session, base_url, auth_headers):
    pytest.skip("Requires authenticated production API")


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_lab_results(api_session, base_url, auth_headers):
    pytest.skip("Requires authenticated production API")


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_lab_reports(api_session, base_url, auth_headers):
    pytest.skip("Requires a known report ID")
PYEOF

cat > "$ROOT/billing/test_billing.py" <<'PYEOF'
import pytest


BILLING_READ_ENDPOINTS = [
    "billing/accounts-receivable",
    "billing/financial-report",
    "billing/holds",
    "billing/integrity/runs",
    "billing/integrity/scan",
    "billing/integrity/settings",
    "billing/patients",
    "billing/price-catalog",
    "billing/settings",
    "billing/stats",
]


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
@pytest.mark.parametrize("endpoint", BILLING_READ_ENDPOINTS)
def test_billing_read_endpoint(endpoint, api_session, base_url, auth_headers):
    pytest.skip(f"Requires authenticated billing API access: /{endpoint}")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_billing_write_operations():
    pytest.fail("Disabled until dedicated billing test data is configured")
PYEOF

cat > "$ROOT/inventory/test_inventory.py" <<'PYEOF'
import pytest


INVENTORY_READ_ENDPOINTS = [
    "inventory",
    "inventory/accounting/summary",
    "inventory/categories",
    "inventory/dashboard",
    "inventory/departments",
    "inventory/expiring",
    "inventory/forecast",
    "inventory/low-stock",
    "inventory/purchase-orders",
    "inventory/reorder-suggestions",
    "inventory/requests",
    "inventory/vendors",
]


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
@pytest.mark.parametrize("endpoint", INVENTORY_READ_ENDPOINTS)
def test_inventory_read_endpoint(endpoint, api_session, base_url, auth_headers):
    pytest.skip(f"Requires authenticated inventory API access: /{endpoint}")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_inventory_write_operations():
    pytest.fail("Disabled until dedicated inventory test data is configured")
PYEOF

cat > "$ROOT/messaging/test_messaging.py" <<'PYEOF'
import pytest


MESSAGING_READ_ENDPOINTS = [
    "messages",
    "chat/patients",
    "chat/users",
    "chat/unread",
    "notifications",
]


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
@pytest.mark.parametrize("endpoint", MESSAGING_READ_ENDPOINTS)
def test_messaging_read_endpoint(endpoint, api_session, base_url, auth_headers):
    pytest.skip(f"Requires authenticated messaging API access: /{endpoint}")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_send_message():
    pytest.fail("Disabled until dedicated test recipient/data is configured")


@pytest.mark.authenticated
@pytest.mark.destructive
def test_delete_message():
    pytest.fail("Disabled: deleting production messages")
PYEOF

cat > "$ROOT/pharmacy/test_pharmacy.py" <<'PYEOF'
import pytest


PHARMACY_READ_ENDPOINTS = [
    "drugs",
    "drug-info",
    "prescriptions",
    "rxnav/search",
    "rxnav/approximate",
]


@pytest.mark.readonly
@pytest.mark.later
@pytest.mark.parametrize("endpoint", PHARMACY_READ_ENDPOINTS)
def test_pharmacy_read_endpoint(endpoint, api_session, base_url):
    pytest.skip(f"Endpoint-specific query required: /{endpoint}")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_create_prescription():
    pytest.fail("Disabled until dedicated clinical test data is configured")
PYEOF

cat > "$ROOT/providers/test_providers.py" <<'PYEOF'
import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_providers(api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/providers",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_available_today(api_session, base_url, auth_headers):
    pytest.skip("Requires authenticated provider API access")


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_provider_dashboard(api_session, base_url, auth_headers):
    pytest.skip("Requires authenticated provider API access")
PYEOF

cat > "$ROOT/administration/test_admin.py" <<'PYEOF'
import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_admin_users(api_session, base_url, auth_headers):
    pytest.skip("Requires administrator credentials")


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_admin_codes(api_session, base_url, auth_headers):
    pytest.skip("Requires administrator credentials")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_admin_write_operations():
    pytest.fail("Disabled until dedicated administrator test account is configured")
PYEOF

cat > "$ROOT/smart/test_smart.py" <<'PYEOF'
import pytest


@pytest.mark.readonly
@pytest.mark.later
def test_smart_configuration(api_session, base_url):
    response = api_session.get(
        f"{base_url}/.well-known/smart-configuration",
        timeout=15,
    )
    assert response.status_code in (200, 404)


@pytest.mark.later
def test_smart_launch():
    pytest.skip("SMART launch requires OAuth/client configuration")


@pytest.mark.later
def test_smart_authorize():
    pytest.skip("SMART authorization requires OAuth/client configuration")
PYEOF

echo "API pytest suite created under:"
echo "$ROOT"
