"""Lab ordering, result entry and verification (``labreports.controller.ts``).

Ordering and result capture write to the chart and stay behind the write
opt-in; the catalog and the per-patient read views are safe to exercise.
"""

import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
def test_lab_catalog(api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/lab/catalog",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.readonly
def test_patient_lab_reports(api_session, base_url, auth_headers, patient_id):
    response = api_session.get(
        f"{base_url}/patients/{patient_id}/lab-reports",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.readonly
def test_patient_ordered_tests(api_session, base_url, auth_headers, patient_id):
    response = api_session.get(
        f"{base_url}/patients/{patient_id}/lab/ordered-tests",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.readonly
def test_lab_report_detail(api_session, base_url, auth_headers, lab_report_id):
    response = api_session.get(
        f"{base_url}/lab/reports/{lab_report_id}",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403, 404)


@pytest.mark.authenticated
@pytest.mark.production_write
def test_create_lab_report():
    pytest.fail("Disabled: ordering a lab test writes clinical production data")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_update_lab_report():
    pytest.fail("Disabled: entering lab results writes clinical production data")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_verify_lab_report():
    pytest.fail("Disabled: verifying a lab report is an irreversible workflow step")
