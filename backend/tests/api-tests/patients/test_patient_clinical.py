import pytest


PATIENT_ENDPOINTS = [
    "allergies",
    "allergies/enriched",
    "appointments",
    "assessments",
    "billing",
    "care-plan",
    "ccda",
    "conditions",
    "discharge-summary",
    "eligibility",
    "encounter-breakdown",
    "encounters",
    "immunizations",
    "insurance",
    "lab/ordered-tests",
    "lab-reports",
    "medications",
    "notes",
    "observations",
    "procedures",
    "results",
    "room",
    "ros",
    "transactions",
    "vitals",
]


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
@pytest.mark.parametrize("endpoint", PATIENT_ENDPOINTS)
def test_patient_read_endpoint(endpoint, api_session, base_url, auth_headers):
    pytest.skip(
        f"Requires a known production patient ID before testing /patients/{{pid}}/{endpoint}"
    )
