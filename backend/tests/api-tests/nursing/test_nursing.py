"""Nursing notes and room assignment (``nursing.controller.ts``).

``PATCH /patients/:pid/room`` is how a patient is admitted to a bed, which is
part of the handover state, so it is gated.
"""

import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
def test_patient_nursing_notes(api_session, base_url, auth_headers, patient_id):
    response = api_session.get(
        f"{base_url}/patients/{patient_id}/notes",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.readonly
def test_patient_room(api_session, base_url, auth_headers, patient_id):
    response = api_session.get(
        f"{base_url}/patients/{patient_id}/room",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.readonly
def test_nurse_dashboard(api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/nurse/dashboard",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.production_write
def test_create_nursing_note():
    pytest.fail("Disabled: writing a nursing note mutates the production chart")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_assign_patient_room():
    pytest.fail("Disabled: assigning a room changes the production ward state")
