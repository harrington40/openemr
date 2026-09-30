import os

import pytest
import requests


@pytest.fixture(scope="session")
def base_url():
    """API base URL, including the ``/api`` prefix.

    Defaults to the local backend that ``test-db/run-backend-against-test-db.sh``
    starts. It deliberately does NOT default to production: this suite should
    never be one forgotten environment variable away from exercising real
    patient data. Point ``OPENRX_API_URL`` at production only on purpose.
    """
    return os.getenv(
        "OPENRX_API_URL",
        "http://localhost:3202/api",
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


def env_or_skip(name: str, description: str) -> str:
    """Return ``name`` from the environment, or skip the test.

    Authenticated tests need real identifiers (a patient, an encounter, a
    report) that cannot be invented. Rather than hard-coding production ids,
    the ids are supplied via environment variables and the tests skip when the
    environment has not been seeded.
    """
    value = os.getenv(name)

    if not value:
        pytest.skip(f"{description} not configured ({name})")

    return value


@pytest.fixture(scope="session")
def patient_id():
    return env_or_skip("OPENRX_TEST_PATIENT_ID", "test patient id")


@pytest.fixture(scope="session")
def encounter_id():
    return env_or_skip("OPENRX_TEST_ENCOUNTER_ID", "test encounter id")


@pytest.fixture(scope="session")
def appointment_id():
    return env_or_skip("OPENRX_TEST_APPOINTMENT_ID", "test appointment id")


@pytest.fixture(scope="session")
def document_id():
    return env_or_skip("OPENRX_TEST_DOCUMENT_ID", "test document id")


@pytest.fixture(scope="session")
def lab_report_id():
    return env_or_skip("OPENRX_TEST_LAB_REPORT_ID", "test lab report id")


@pytest.fixture(scope="session")
def provider_id():
    return env_or_skip("OPENRX_TEST_PROVIDER_ID", "test provider id")


@pytest.fixture(scope="session")
def admin_user_id():
    return env_or_skip("OPENRX_TEST_ADMIN_USER_ID", "test administrator id")


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
