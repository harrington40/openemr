import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_lab_catalog(api_session, base_url, auth_headers):
    pytest.skip("Requires authenticated production API")


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_lab_results(api_session, base_url, auth_headers):
    pytest.skip("Requires authenticated production API")


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_lab_reports(api_session, base_url, auth_headers):
    pytest.skip("Requires a known report ID")
