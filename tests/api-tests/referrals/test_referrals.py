"""Referral workflow (``referrals.controller.ts``)."""

import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.parametrize("endpoint", ["referrals", "referrals/notifications"])
def test_referral_read_endpoint(endpoint, api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/{endpoint}",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.readonly
def test_smart_referral_suggestions(api_session, base_url, auth_headers, patient_id):
    response = api_session.get(
        f"{base_url}/referrals/smart-suggest/{patient_id}",
        headers=auth_headers,
        timeout=25,
    )
    assert response.status_code in (200, 403, 404)


@pytest.mark.authenticated
@pytest.mark.production_write
def test_create_referral():
    pytest.fail("Disabled: creating a referral writes clinical production data")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_acknowledge_referral():
    pytest.fail("Disabled: acknowledging a referral mutates production data")
