"""Reporting endpoints (``reports.controller.ts``).

The report handlers take optional date filters, so a ``400`` is a legitimate
answer when a filter is required; the assertion is that the route is reachable
and does not fail server-side.
"""

import pytest


REPORT_ENDPOINTS = [
    "reports/appointments",
    "reports/encounters",
    "reports/patients",
    "reports/financial",
]


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.parametrize("endpoint", REPORT_ENDPOINTS)
def test_report_endpoint(endpoint, api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/{endpoint}",
        headers=auth_headers,
        timeout=30,
    )
    assert response.status_code in (200, 400, 403), (
        f"/{endpoint} returned {response.status_code}\n{response.text[:400]}"
    )
