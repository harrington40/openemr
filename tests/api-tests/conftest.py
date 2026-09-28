import os

import pytest
import requests


@pytest.fixture(scope="session")
def base_url():
    return os.getenv(
        "OPENRX_API_URL",
        "https://openrx.transtechologies.com/api",
    ).rstrip("/")


@pytest.fixture(scope="session")
def api_session():
    session = requests.Session()
    session.headers.update({
        "Accept": "application/json",
        "Content-Type": "application/json",
    })

    yield session
    session.close()


@pytest.fixture(scope="session")
def auth_token():
    token = os.getenv("OPENRX_API_TOKEN")

    if not token:
        pytest.skip(
            "OPENRX_API_TOKEN is not configured; authenticated tests are disabled"
        )

    return token


@pytest.fixture(scope="session")
def auth_headers(auth_token):
    return {
        "Authorization": f"Bearer {auth_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def pytest_collection_modifyitems(config, items):
    """
    Safety policy:

    Production write/destructive tests remain skipped unless explicitly
    requested with the appropriate pytest markers.
    """

    run_writes = os.getenv("OPENRX_RUN_WRITES", "").lower() == "true"

    for item in items:
        if "production_write" in item.keywords or "destructive" in item.keywords:
            if not run_writes:
                item.add_marker(
                    pytest.mark.skip(
                        reason="Production write/destructive tests disabled"
                    )
                )
