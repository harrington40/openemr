"""Inpatient ward overview (``inpatient.controller.ts``)."""

import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
def test_inpatient_overview(api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/inpatient/overview",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)
