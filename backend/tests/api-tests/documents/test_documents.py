"""Patient document storage (``documents.controller.ts``).

Uploads stream to Backblaze B2 and are gated by ``JwtAuthGuard``, so the read
endpoints are testable with a token while upload/verify stay behind the write
opt-in.
"""

import pytest


DOCUMENT_READ_ENDPOINTS = [
    "documents",
    "documents/my",
]


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.parametrize("endpoint", DOCUMENT_READ_ENDPOINTS)
def test_document_list_endpoint(endpoint, api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/{endpoint}",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.readonly
def test_document_detail(api_session, base_url, auth_headers, document_id):
    response = api_session.get(
        f"{base_url}/documents/{document_id}",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code in (200, 403, 404)


@pytest.mark.authenticated
@pytest.mark.readonly
def test_document_stream_url(api_session, base_url, auth_headers, document_id):
    response = api_session.get(
        f"{base_url}/documents/{document_id}/stream",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code in (200, 302, 403, 404)


@pytest.mark.authenticated
@pytest.mark.production_write
def test_document_upload():
    pytest.fail("Disabled: uploading a document writes to production storage")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_document_status_update():
    pytest.fail("Disabled: changing a document status mutates production data")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_document_verify_code():
    pytest.fail("Disabled: verifying a document code counts a production attempt")
