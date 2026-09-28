import pytest


BILLING_READ_ENDPOINTS = [
    "billing/accounts-receivable",
    "billing/financial-report",
    "billing/holds",
    "billing/integrity/runs",
    "billing/integrity/scan",
    "billing/integrity/settings",
    "billing/patients",
    "billing/price-catalog",
    "billing/settings",
    "billing/stats",
]


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
@pytest.mark.parametrize("endpoint", BILLING_READ_ENDPOINTS)
def test_billing_read_endpoint(endpoint, api_session, base_url, auth_headers):
    pytest.skip(f"Requires authenticated billing API access: /{endpoint}")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_billing_write_operations():
    pytest.fail("Disabled until dedicated billing test data is configured")
