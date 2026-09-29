"""Clinical mailbox and archiving (``mailbox.controller.ts``).

Archiving moves messages into B2 storage and is scheduled, so the writes are
gated; the summary/policy reads are safe.
"""

import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.parametrize(
    "endpoint",
    ["mailbox", "mailbox/stats", "mailbox/policy", "mailbox/archives"],
)
def test_mailbox_read_endpoint(endpoint, api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/{endpoint}",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.production_write
def test_mailbox_policy_update():
    pytest.fail("Disabled: changing the retention policy affects production mail")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_mailbox_archive_run():
    pytest.fail("Disabled: archiving moves production messages to storage")


@pytest.mark.authenticated
@pytest.mark.destructive
def test_mailbox_archive_delete():
    pytest.fail("Disabled: deleting a production archive")
