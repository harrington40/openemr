"""Whole-surface contract tests for the OpenRx backend API.

The route inventory lives in ``api_routes.py`` and is generated straight from
the NestJS controllers, so this module exercises *every* endpoint the backend
declares rather than a hand-maintained subset::

    python generate_api_routes.py

Three guarantees are checked without authenticating:

* a guarded route must reject an anonymous caller with ``401``/``403`` — the
  guard runs before the handler, so this is safe to run anywhere, including
  against production;
* a public read route must answer without a server error (no ``5xx``);
* the set of unauthenticated read/write endpoints matches a reviewed snapshot,
  so adding a new public endpoint fails the build until it is acknowledged.

Writes are never sent. Endpoints that require an authenticated session or
dedicated test data are covered by the per-domain modules instead.

Deselect this suite when a fast run is needed::

    pytest -m "not surface"
"""

from __future__ import annotations

import re

import pytest

from api_routes import API_ROUTES

#: Route parameters replaced with a benign value before the request is sent.
PATH_PARAMETERS = {
    "code": "1",
    "drugName": "aspirin",
    "eid": "1",
    "id": "1",
    "orderId": "1",
    "paymentId": "1",
    "pid": "1",
    "role": "admin",
    "rxcui": "1191",
    "table": "patient_data",
    "token": "00000000-0000-0000-0000-000000000000",
    "type": "procedure",
    "userId": "1",
}

_PARAMETER_RE = re.compile(r":([A-Za-z_][A-Za-z0-9_]*)")

GET_ROUTES = [route for route in API_ROUTES if route.method == "GET"]
WRITE_ROUTES = [route for route in API_ROUTES if route.method != "GET"]
PUBLIC_READ_ROUTES = [route for route in GET_ROUTES if not route.auth_required]
PUBLIC_WRITE_ROUTES = [route for route in WRITE_ROUTES if not route.auth_required]
PROTECTED_ROUTES = [route for route in API_ROUTES if route.auth_required]

#: Unauthenticated endpoints that have been reviewed and are intentional.
#: A change here means a public endpoint was added or removed — review the
#: authorization on the controller before updating this set.
EXPECTED_PUBLIC_READ_ROUTES = {
    "GET /",
    "GET /.well-known/smart-configuration",
    "GET /config",
    "GET /license/status",
    "GET /patient-chat/:pid",
    "GET /portal/records",
    "GET /smart/launch",
    "GET /vendor/portal/:token",
}

#: Unauthenticated write endpoints that have been reviewed and are intentional.
EXPECTED_PUBLIC_WRITE_ROUTES = {
    "POST /auth/login",
    "POST /auth/register",
    "POST /booking/request",
    "POST /license/activate",
    "POST /license/verify-passphrase",
    "POST /patient-chat",
    "POST /portal/change-password",
    "POST /portal/login",
    "POST /portal/register",
    "POST /vendor/portal/:token/orders/:id/acknowledge",
}


#: Route collisions that exist in the controllers today. Both
#: ``ClinicalController`` and ``ReferenceController`` declare these two GETs;
#: Nest keeps the first registration and the other handler is unreachable dead
#: code. Delete one declaration (they return the same patient data), then empty
#: this set — new collisions are *not* allowed and fail the suite.
KNOWN_DUPLICATE_ROUTES = {
    "GET /patients/:pid/allergies",
    "GET /patients/:pid/medications",
}


def route_id(route) -> str:
    """Pytest parameter id, e.g. ``GET /patients/:pid``."""
    return f"{route.method} {route.path}"


def build_url(base_url: str, route) -> str:
    """Expand ``:parameters`` in ``route`` into concrete values."""
    path = _PARAMETER_RE.sub(
        lambda match: PATH_PARAMETERS.get(match.group(1), "1"),
        route.path,
    )
    return f"{base_url}{path}"


@pytest.mark.readonly
@pytest.mark.surface
def test_route_inventory_is_well_formed():
    assert len(API_ROUTES) > 100, "route inventory looks incomplete"

    for route in API_ROUTES:
        assert route.method in {"GET", "POST", "PUT", "PATCH", "DELETE"}, route
        assert route.path.startswith("/"), route
        assert route.path == "/" or not route.path.endswith("/"), route


@pytest.mark.readonly
@pytest.mark.surface
def test_route_inventory_has_no_duplicates():
    keys = [route_id(route) for route in API_ROUTES]
    duplicates = {key for key in keys if keys.count(key) > 1}
    unexpected = duplicates - KNOWN_DUPLICATE_ROUTES

    assert not unexpected, (
        "Two controllers declare the same route; only the first registration is "
        f"reachable: {sorted(unexpected)}"
    )
    # Surface any allowlisted collision that has since been cleaned up.
    assert duplicates == KNOWN_DUPLICATE_ROUTES, (
        "KNOWN_DUPLICATE_ROUTES is stale; a listed collision no longer exists. "
        "Remove it from the set."
    )


@pytest.mark.readonly
@pytest.mark.surface
def test_public_read_surface_is_reviewed():
    actual = {route_id(route) for route in PUBLIC_READ_ROUTES}
    assert actual == EXPECTED_PUBLIC_READ_ROUTES, (
        "The set of unauthenticated read endpoints changed. Review the new "
        "endpoint for authorization, then update EXPECTED_PUBLIC_READ_ROUTES."
    )


@pytest.mark.readonly
@pytest.mark.surface
def test_public_write_surface_is_reviewed():
    actual = {route_id(route) for route in PUBLIC_WRITE_ROUTES}
    assert actual == EXPECTED_PUBLIC_WRITE_ROUTES, (
        "The set of unauthenticated write endpoints changed. Review the new "
        "endpoint for authorization, then update EXPECTED_PUBLIC_WRITE_ROUTES."
    )


@pytest.mark.readonly
@pytest.mark.surface
@pytest.mark.parametrize("route", PUBLIC_READ_ROUTES, ids=route_id)
def test_public_read_route_answers(route, api_session, base_url):
    """Public reads must answer and must never surface a server error."""
    response = api_session.get(build_url(base_url, route), timeout=20)

    assert response.status_code < 500, (
        f"{route_id(route)} returned {response.status_code}\n"
        f"{response.text[:400]}"
    )


@pytest.mark.readonly
@pytest.mark.surface
@pytest.mark.parametrize("route", PROTECTED_ROUTES, ids=route_id)
def test_protected_route_rejects_anonymous(route, api_session, base_url):
    """Guarded endpoints must reject an anonymous caller.

    The guard runs before the handler, so no data is created, changed or
    deleted even for the mutating methods.
    """
    response = api_session.request(
        route.method,
        build_url(base_url, route),
        timeout=20,
    )

    assert response.status_code in (401, 403), (
        f"{route_id(route)} should be protected but returned "
        f"{response.status_code} to an anonymous caller\n{response.text[:400]}"
    )
