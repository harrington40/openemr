"""Medical imaging studies (``imaging.controller.ts``).

X-rays and scans are stored in Backblaze B2; uploads and deletes stay behind
the write/destructive opt-ins.
"""

import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
def test_patient_images(api_session, base_url, auth_headers, patient_id):
    response = api_session.get(
        f"{base_url}/imaging/patient/{patient_id}",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.production_write
def test_upload_image():
    pytest.fail("Disabled: uploading an image writes to production storage")


@pytest.mark.authenticated
@pytest.mark.destructive
def test_delete_image():
    pytest.fail("Disabled: deleting a production imaging study")
