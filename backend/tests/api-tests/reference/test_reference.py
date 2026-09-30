"""Reference/lookup data (``reference.controller.ts``).

Note that ``GET /patients/:pid/medications`` and ``GET /patients/:pid/allergies``
are declared by both ``ReferenceController`` and ``ClinicalController`` — see
``KNOWN_DUPLICATE_ROUTES`` in ``test_api_surface.py``.
"""

import pytest


REFERENCE_READ_ENDPOINTS = [
    "insurance-companies",
    "procedures",
    "drugs",
]


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.parametrize("endpoint", REFERENCE_READ_ENDPOINTS)
def test_reference_read_endpoint(endpoint, api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/{endpoint}",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.parametrize(
    "suffix",
    ["insurance", "medications", "allergies"],
)
def test_patient_reference_read(suffix, api_session, base_url, auth_headers, patient_id):
    response = api_session.get(
        f"{base_url}/patients/{patient_id}/{suffix}",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)
