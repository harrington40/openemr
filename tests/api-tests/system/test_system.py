import pytest


@pytest.mark.smoke
@pytest.mark.readonly
def test_api_config(api_session, base_url):
    response = api_session.get(f"{base_url}/config", timeout=15)
    assert response.status_code == 200


@pytest.mark.readonly
@pytest.mark.later
def test_status(api_session, base_url):
    response = api_session.get(f"{base_url}/license/status", timeout=15)
    assert response.status_code in (200, 401, 403)


@pytest.mark.readonly
@pytest.mark.later
def test_facilities(api_session, base_url):
    response = api_session.get(f"{base_url}/facilities", timeout=15)
    assert response.status_code in (200, 401, 403)


@pytest.mark.readonly
@pytest.mark.later
def test_devices(api_session, base_url):
    response = api_session.get(f"{base_url}/fda/devices", timeout=15)
    assert response.status_code in (200, 401, 403)
