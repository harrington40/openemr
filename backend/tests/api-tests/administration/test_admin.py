import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_admin_users(api_session, base_url, auth_headers):
    pytest.skip("Requires administrator credentials")


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_admin_codes(api_session, base_url, auth_headers):
    pytest.skip("Requires administrator credentials")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_admin_write_operations():
    pytest.fail("Disabled until dedicated administrator test account is configured")
