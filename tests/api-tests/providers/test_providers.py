import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_providers(api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/providers",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_available_today(api_session, base_url, auth_headers):
    pytest.skip("Requires authenticated provider API access")


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_provider_dashboard(api_session, base_url, auth_headers):
    pytest.skip("Requires authenticated provider API access")
