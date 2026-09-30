import pytest


@pytest.mark.readonly
@pytest.mark.later
def test_smart_configuration(api_session, base_url):
    response = api_session.get(
        f"{base_url}/.well-known/smart-configuration",
        timeout=15,
    )
    assert response.status_code in (200, 404)


@pytest.mark.later
def test_smart_launch():
    pytest.skip("SMART launch requires OAuth/client configuration")


@pytest.mark.later
def test_smart_authorize():
    pytest.skip("SMART authorization requires OAuth/client configuration")
