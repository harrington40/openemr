"""Midwifery assessments and eligibility (``midwife.controller.ts``)."""

import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
def test_patient_assessments(api_session, base_url, auth_headers, patient_id):
    response = api_session.get(
        f"{base_url}/midwife/patients/{patient_id}/assessments",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.readonly
def test_patient_maternity_eligibility(
    api_session, base_url, auth_headers, patient_id
):
    response = api_session.get(
        f"{base_url}/midwife/patients/{patient_id}/eligibility",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.production_write
def test_create_assessment():
    pytest.fail("Disabled: recording an assessment writes clinical production data")


@pytest.mark.authenticated
@pytest.mark.destructive
def test_delete_assessment():
    pytest.fail("Disabled: deleting a production assessment")
