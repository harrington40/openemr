import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.later
def test_emergency_board(api_session, base_url, auth_headers):
    # The controller is mounted at /emergency, so the board lives at
    # /emergency/board — this previously requested /board and 404'd.
    response = api_session.get(
        f"{base_url}/emergency/board",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.production_write
def test_emergency_triage():
    pytest.fail(
        "Disabled: triage creates/changes clinical production data"
    )


@pytest.mark.authenticated
@pytest.mark.production_write
def test_emergency_reassessment():
    pytest.fail(
        "Disabled: reassessment changes clinical production data"
    )
