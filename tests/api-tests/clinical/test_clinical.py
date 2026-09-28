import pytest


READ_ONLY_ENDPOINTS = [
    "AllergyIntolerance",
    "Condition",
    "Encounter",
    "Immunization",
    "MedicationRequest",
    "Observation",
    "Patient",
    "procedures",
    "orders",
]


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
@pytest.mark.parametrize("endpoint", READ_ONLY_ENDPOINTS)
def test_clinical_endpoint(endpoint, api_session, base_url, auth_headers):
    pytest.skip(
        f"Requires endpoint-specific query/fixture for /{endpoint}"
    )
