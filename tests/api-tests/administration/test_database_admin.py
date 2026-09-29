"""Database administration console (``db-admin.controller.ts``).

``POST /db-admin/query`` executes arbitrary SQL. It is guarded, but it is also
the single most dangerous endpoint in the API, so it is only ever verified to
reject anonymous callers — never executed.
"""

import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.parametrize(
    "endpoint",
    ["db-admin/tables", "db-admin/describe/patient_data", "db-admin/browse/patient_data"],
)
def test_database_admin_reads(endpoint, api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/{endpoint}",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403, 404)


@pytest.mark.readonly
def test_database_admin_query_rejects_anonymous(api_session, base_url):
    response = api_session.post(
        f"{base_url}/db-admin/query",
        json={"sql": "SELECT 1"},
        timeout=20,
    )

    assert response.status_code in (401, 403)


@pytest.mark.authenticated
@pytest.mark.destructive
def test_database_admin_query():
    pytest.fail(
        "Disabled: arbitrary SQL against the production database is never run by the suite"
    )
