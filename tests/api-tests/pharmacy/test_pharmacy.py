import pytest


PHARMACY_READ_ENDPOINTS = [
    "drugs",
    "drug-info",
    "prescriptions",
    "rxnav/search",
    "rxnav/approximate",
]


@pytest.mark.readonly
@pytest.mark.later
@pytest.mark.parametrize("endpoint", PHARMACY_READ_ENDPOINTS)
def test_pharmacy_read_endpoint(endpoint, api_session, base_url):
    pytest.skip(f"Endpoint-specific query required: /{endpoint}")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_create_prescription():
    pytest.fail("Disabled until dedicated clinical test data is configured")
