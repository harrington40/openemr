"""Licensing endpoints (``license.controller.ts``).

``GET /license/status`` and ``POST /license/verify-passphrase`` are public — the
app calls them before anybody has logged in. The status check is a genuine,
always-runnable assertion; the passphrase check only ever *verifies*, so sending
a wrong passphrase mutates nothing.
"""

import pytest


@pytest.mark.smoke
@pytest.mark.readonly
def test_license_status(api_session, base_url):
    response = api_session.get(f"{base_url}/license/status", timeout=15)

    assert response.status_code == 200

    status = response.json()
    assert isinstance(status["valid"], bool)

    # A database with no activated key answers {"valid": false}; the tier is
    # only reported once a licence exists, so assert it conditionally.
    if status["valid"]:
        assert "tier" in status


@pytest.mark.readonly
def test_verify_passphrase_rejects_wrong_value(api_session, base_url):
    response = api_session.post(
        f"{base_url}/license/verify-passphrase",
        json={"passphrase": "definitely-not-the-generator-passphrase"},
        timeout=15,
    )

    assert response.status_code in (200, 201)
    assert response.json() == {"valid": False}


@pytest.mark.authenticated
@pytest.mark.production_write
def test_activate_license():
    pytest.fail("Disabled: activating a license key consumes it")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_generate_license_keys():
    pytest.fail("Disabled: generating license keys writes production rows")


@pytest.mark.authenticated
@pytest.mark.destructive
def test_revoke_license():
    pytest.fail("Disabled: revoking a license mutates production rows")
