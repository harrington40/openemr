"""Patient chat, staff chat and chat sharing (``patient-chat.controller.ts``).

The patient-facing routes are public and identify the patient with pid + date of
birth, so they are only checked for reachability here — reading a real thread
needs a real pid. The staff routes are guarded and may be exercised with a
token.
"""

import pytest


@pytest.mark.readonly
def test_patient_thread_route_is_reachable(api_session, base_url):
    response = api_session.get(f"{base_url}/patient-chat/1", timeout=20)

    assert response.status_code < 500


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.parametrize(
    "endpoint",
    ["chat/unread", "chat/patients", "chat/users"],
)
def test_staff_chat_read_endpoint(endpoint, api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/{endpoint}",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.readonly
def test_patient_chat_thread(api_session, base_url, auth_headers, patient_id):
    response = api_session.get(
        f"{base_url}/chat/thread/{patient_id}",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403, 404)


@pytest.mark.authenticated
@pytest.mark.readonly
def test_patient_chat_access(api_session, base_url, auth_headers, patient_id):
    response = api_session.get(
        f"{base_url}/chat/access/{patient_id}",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403, 404)


@pytest.mark.production_write
def test_send_patient_message():
    pytest.fail("Disabled: sending a patient message creates production data")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_send_staff_message():
    pytest.fail("Disabled: sending a staff message creates production data")


@pytest.mark.authenticated
@pytest.mark.destructive
def test_revoke_chat_share():
    pytest.fail("Disabled: revoking a chat share mutates production access")
