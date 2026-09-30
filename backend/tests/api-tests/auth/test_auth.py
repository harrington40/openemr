"""Authentication (``auth.controller.ts``).

These tests obtain their own token instead of relying on ``OPENRX_API_TOKEN``,
so the login flow is exercised even when no token is supplied — previously
every case in this file was an unconditional ``pytest.skip``.

Everything here is read-only. ``login()`` only SELECTs from ``users`` and
``users_secure``; it never increments the failure counters that exist on
``users_secure``, so none of these cases can lock an account or mutate data.

Credentials default to the accounts created by ``test-db/seed.sql`` and can be
overridden with ``OPENRX_TEST_USER`` / ``OPENRX_TEST_PASSWORD``.
"""

import base64
import json
import os
import time

import pytest


def credentials():
    """Username/password of the seeded, approved administrator."""
    return (
        os.getenv("OPENRX_TEST_USER", "admin"),
        os.getenv("OPENRX_TEST_PASSWORD", "OpenRxTest123"),
    )


def login(api_session, base_url, username, password):
    return api_session.post(
        f"{base_url}/auth/login",
        json={"username": username, "password": password},
        timeout=20,
    )


def decode_jwt_payload(token):
    """Decode a JWT payload without verifying it (the server verifies)."""
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


@pytest.mark.smoke
@pytest.mark.readonly
def test_login_returns_a_token_that_a_protected_route_accepts(api_session, base_url):
    username, password = credentials()

    response = login(api_session, base_url, username, password)
    assert response.status_code in (200, 201), response.text

    token = response.json()["token"]
    assert token, "login succeeded but returned an empty token"

    # Issuing a token is not enough — it has to be accepted.
    protected = api_session.get(
        f"{base_url}/patients",
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    assert protected.status_code != 401, "a freshly issued token was rejected"
    assert protected.status_code in (200, 403)


@pytest.mark.readonly
def test_token_carries_the_account_and_an_expiry(api_session, base_url):
    username, password = credentials()

    response = login(api_session, base_url, username, password)
    assert response.status_code in (200, 201), response.text

    payload = decode_jwt_payload(response.json()["token"])

    assert payload["username"] == username
    assert payload["sub"], "token has no subject"
    assert isinstance(payload["role"], str) and payload["role"]
    assert payload["exp"] > time.time(), "token is already expired"


@pytest.mark.readonly
def test_login_rejects_a_wrong_password(api_session, base_url):
    username, _ = credentials()

    response = login(api_session, base_url, username, "definitely-not-the-password")

    assert response.status_code == 401


@pytest.mark.readonly
def test_login_rejects_an_unknown_user(api_session, base_url):
    _, password = credentials()

    response = login(api_session, base_url, "no-such-user-xyz", password)

    assert response.status_code == 401


@pytest.mark.readonly
def test_login_requires_username_and_password(api_session, base_url):
    for body in ({}, {"username": "admin"}, {"password": "secret123"}):
        response = api_session.post(f"{base_url}/auth/login", json=body, timeout=20)
        assert response.status_code in (400, 401), (body, response.status_code)


@pytest.mark.readonly
@pytest.mark.parametrize("username", ["pending.user", "rejected.user", "inactive.user"])
def test_accounts_that_are_not_usable_cannot_obtain_a_token(
    username, api_session, base_url
):
    """Pending, rejected and deactivated accounts must all be refused."""
    _, password = credentials()

    response = login(api_session, base_url, username, password)

    assert response.status_code == 401
    assert "token" not in response.text


@pytest.mark.readonly
def test_refusal_message_reveals_whether_an_account_exists(api_session, base_url):
    """Documents a username-enumeration signal.

    The pending/rejected/inactive checks run *before* the password is verified,
    so the response body tells an anonymous caller whether a username exists,
    even when the password supplied is wrong. Asserted deliberately: changing
    this behaviour should be a decision, not an accident.
    """
    _, password = credentials()

    unknown = login(api_session, base_url, "no-such-user-xyz", password).json()["message"]
    pending = login(api_session, base_url, "pending.user", password).json()["message"]

    assert unknown == "Invalid credentials"
    assert pending != unknown


@pytest.mark.readonly
def test_protected_route_rejects_missing_or_malformed_tokens(api_session, base_url):
    headers_to_try = [
        {},
        {"Authorization": "Bearer not-a-jwt"},
        {"Authorization": "Bearer "},
        {"Authorization": "Basic YWRtaW46YWRtaW4="},
    ]

    for headers in headers_to_try:
        response = api_session.get(f"{base_url}/patients", headers=headers, timeout=20)
        assert response.status_code in (401, 403), (headers, response.status_code)


@pytest.mark.readonly
def test_tampered_token_is_rejected(api_session, base_url):
    username, password = credentials()
    token = login(api_session, base_url, username, password).json()["token"]

    header, payload, _signature = token.split(".")
    forged = f"{header}.{payload}.not-the-real-signature"

    response = api_session.get(
        f"{base_url}/patients",
        headers={"Authorization": f"Bearer {forged}"},
        timeout=20,
    )

    assert response.status_code in (401, 403)


@pytest.mark.readonly
def test_registration_requires_username_password_and_names(api_session, base_url):
    bodies = [
        {},
        {"username": "someone"},
        {"username": "someone", "password": "secret123"},
    ]

    for body in bodies:
        response = api_session.post(f"{base_url}/auth/register", json=body, timeout=20)
        assert response.status_code == 400, (body, response.status_code)


@pytest.mark.readonly
def test_registration_rejects_a_short_password(api_session, base_url):
    response = api_session.post(
        f"{base_url}/auth/register",
        json={
            "username": "someone_short_password",
            "password": "12345",
            "fname": "A",
            "lname": "B",
        },
        timeout=20,
    )

    assert response.status_code == 400


@pytest.mark.readonly
def test_registration_rejects_a_username_that_is_taken(api_session, base_url):
    """The uniqueness check runs before the INSERT, so nothing is created."""
    username, _ = credentials()

    response = api_session.post(
        f"{base_url}/auth/register",
        json={
            "username": username,
            "password": "secret123",
            "fname": "A",
            "lname": "B",
        },
        timeout=20,
    )

    assert response.status_code == 400
    assert "taken" in response.json()["message"].lower()


@pytest.mark.production_write
def test_registration_creates_a_pending_account():
    pytest.fail(
        "Disabled: creating staff accounts needs opt-in (OPENRX_RUN_WRITES=true). "
        "The pending/rejected/deactivated refusal paths are covered read-only by "
        "the accounts seeded in test-db/seed.sql."
    )

