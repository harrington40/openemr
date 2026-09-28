import pytest


MESSAGING_READ_ENDPOINTS = [
    "messages",
    "chat/patients",
    "chat/users",
    "chat/unread",
    "notifications",
]


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
@pytest.mark.parametrize("endpoint", MESSAGING_READ_ENDPOINTS)
def test_messaging_read_endpoint(endpoint, api_session, base_url, auth_headers):
    pytest.skip(f"Requires authenticated messaging API access: /{endpoint}")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_send_message():
    pytest.fail("Disabled until dedicated test recipient/data is configured")


@pytest.mark.authenticated
@pytest.mark.destructive
def test_delete_message():
    pytest.fail("Disabled: deleting production messages")
