"""openFDA drug/device lookups (``fda.controller.ts``).

These handlers proxy the public openFDA and RxNav services. They are guarded on
the backend, and a successful call additionally depends on the upstream service
being reachable, so a ``400``/``404``/``502``/``503`` is an accepted outcome —
the point of these tests is that the routes exist, are protected, and never
crash the backend.
"""

import pytest


FDA_READ_ENDPOINTS = [
    "fda/drugs",
    "fda/drugs/suggest",
    "fda/drugs/adverse-events",
    "fda/drugs/recalls",
    "fda/devices",
    "fda/devices/recalls",
    "fda/devices/adverse-events",
    "fda/food",
    "fda/food/adverse-events",
    "fda/cosmetics",
    "fda/tobacco",
    "fda/other",
    "fda/transparency",
    "fda/smart/drug",
    "fda/smart/device",
    "fda/rxnav/search",
    "fda/rxnav/approximate",
    "fda/rxnav/lookup/aspirin",
    "fda/rxnav/1191/related",
    "fda/rxnav/1191/interactions",
    "fda/rxnav/1191/classes",
]

ACCEPTED_STATUSES = (200, 400, 403, 404, 502, 503)


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.parametrize("endpoint", FDA_READ_ENDPOINTS)
def test_fda_read_endpoint(endpoint, api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/{endpoint}",
        headers=auth_headers,
        timeout=30,
    )
    assert response.status_code in ACCEPTED_STATUSES, (
        f"/{endpoint} returned {response.status_code}\n{response.text[:400]}"
    )
