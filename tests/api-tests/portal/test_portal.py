"""Patient portal entry points (``patients/portal.controller.ts``).

Registration and login are public by design (a patient has no staff login yet)
and are never exercised without dedicated test data — a wrong-credential probe
would consume the login-attempt budget that protects a real account.
"""

import pytest


def test_portal_records_requires_a_portal_session(api_session, base_url):
    """``/portal/records`` is reachable but must demand a patient token."""
    response = api_session.get(f"{base_url}/portal/records", timeout=20)

    assert response.status_code in (401, 403)


@pytest.mark.production_write
def test_portal_register():
    pytest.fail("Disabled: portal registration creates a production patient record")


@pytest.mark.production_write
def test_portal_login():
    pytest.fail(
        "Disabled: a login probe would burn the patient's failed-attempt budget"
    )


@pytest.mark.production_write
def test_portal_change_password():
    pytest.fail("Disabled: changing a portal password mutates production credentials")
