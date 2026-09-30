"""FHIR R4 resources (``fhir.controller.ts``).

The FHIR facade exposes each supported resource under ``/fhir/<Resource>``. Only
``Patient`` has a documented single-instance route, so the rest are checked as
collections.
"""

import pytest


FHIR_COLLECTIONS = [
    "fhir/AllergyIntolerance",
    "fhir/Condition",
    "fhir/Encounter",
    "fhir/Immunization",
    "fhir/MedicationRequest",
    "fhir/Observation",
    "fhir/Patient",
]


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.parametrize("endpoint", FHIR_COLLECTIONS)
def test_fhir_collection(endpoint, api_session, base_url, auth_headers):
    response = api_session.get(
        f"{base_url}/{endpoint}",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.readonly
def test_fhir_patient_read(api_session, base_url, auth_headers, patient_id):
    response = api_session.get(
        f"{base_url}/fhir/Patient/{patient_id}",
        headers=auth_headers,
        timeout=20,
    )
    assert response.status_code in (200, 403, 404)
