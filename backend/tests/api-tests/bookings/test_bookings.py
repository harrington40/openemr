"""Booking-request endpoints (``bookings.controller.ts``).

``POST /booking/request`` backs the shareable public booking link, so it is the
one write endpoint in this module that is intentionally unauthenticated. It is
never exercised here — creating requests needs dedicated test data.
"""

import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
def test_booking_requests(api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/bookings/requests",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.production_write
def test_approve_booking_request():
    pytest.fail(
        "Disabled: approving a booking request changes production scheduling"
    )


@pytest.mark.authenticated
@pytest.mark.production_write
def test_decline_booking_request():
    pytest.fail(
        "Disabled: declining a booking request changes production scheduling"
    )
