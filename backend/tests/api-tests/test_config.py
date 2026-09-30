import pytest


@pytest.mark.smoke
@pytest.mark.readonly
def test_get_config(api_session, base_url):
    response = api_session.get(
        f"{base_url}/config",
        timeout=15,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["appName"] == "OpenRx"
    assert data["version"] == "1.0.0"
    assert "language" in data
