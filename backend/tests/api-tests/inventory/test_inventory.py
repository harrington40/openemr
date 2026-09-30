import pytest


INVENTORY_READ_ENDPOINTS = [
    "inventory",
    "inventory/accounting/summary",
    "inventory/categories",
    "inventory/dashboard",
    "inventory/departments",
    "inventory/expiring",
    "inventory/forecast",
    "inventory/low-stock",
    "inventory/purchase-orders",
    "inventory/reorder-suggestions",
    "inventory/requests",
    "inventory/vendors",
]


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
@pytest.mark.parametrize("endpoint", INVENTORY_READ_ENDPOINTS)
def test_inventory_read_endpoint(endpoint, api_session, base_url, auth_headers):
    pytest.skip(f"Requires authenticated inventory API access: /{endpoint}")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_inventory_write_operations():
    pytest.fail("Disabled until dedicated inventory test data is configured")
