"""Notification summary and drug-info requests (``notifications.controller.ts``)."""

import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.parametrize("endpoint", ["notifications/summary", "notifications/drug-info"])
def test_notifications_read_endpoint(endpoint, api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/{endpoint}",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.production_write
def test_create_drug_info_request():
    pytest.fail("Disabled: raises a production drug-info request")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_acknowledge_drug_info_request():
    pytest.fail("Disabled: acknowledges a production request")
