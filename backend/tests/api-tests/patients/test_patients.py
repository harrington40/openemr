import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_list_patients(api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/patients",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code == 200


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_get_patient(api_session, base_url, auth_headers):
    pytest.skip("Requires a known production patient ID")


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_patient_profile(api_session, base_url, auth_headers):
    pytest.skip("Requires a known production patient ID")


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_patient_validation_preview(api_session, base_url, auth_headers):
    pytest.skip("Requires a known production patient ID")
