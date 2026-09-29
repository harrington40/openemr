"""Staff avatars (``avatars.controller.ts``).

Avatars are stored in Backblaze B2; the reads are guarded and the upload/delete
operations need the write opt-in.
"""

import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
def test_own_avatar(api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/avatars/me",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code in (200, 403, 404)


@pytest.mark.authenticated
@pytest.mark.readonly
def test_user_avatar(api_session, base_url, auth_headers, admin_user_id):
    response = api_session.get(
        f"{base_url}/avatars/{admin_user_id}",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code in (200, 403, 404)


@pytest.mark.authenticated
@pytest.mark.production_write
def test_upload_avatar():
    pytest.fail("Disabled: uploading an avatar writes to production storage")


@pytest.mark.authenticated
@pytest.mark.destructive
def test_delete_avatar():
    pytest.fail("Disabled: deleting a production avatar")
