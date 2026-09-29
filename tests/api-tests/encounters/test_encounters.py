"""Clinical encounters (``encounters.controller.ts``).

Every route is patient-scoped and guarded, so the tests need both a token and a
seeded patient/encounter. ``OPENRX_TEST_PATIENT_ID`` and
``OPENRX_TEST_ENCOUNTER_ID`` provide them.
"""

import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
def test_patient_encounters(api_session, base_url, auth_headers, patient_id):
    response = api_session.get(
        f"{base_url}/patients/{patient_id}/encounters",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code in (200, 403)


@pytest.mark.authenticated
@pytest.mark.readonly
def test_encounter_detail(
    api_session, base_url, auth_headers, patient_id, encounter_id
):
    response = api_session.get(
        f"{base_url}/patients/{patient_id}/encounters/{encounter_id}",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code in (200, 403, 404)


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.parametrize(
    "suffix",
    ["vitals", "soap", "notes"],
)
def test_encounter_sub_resource(
    suffix, api_session, base_url, auth_headers, patient_id, encounter_id
):
    response = api_session.get(
        f"{base_url}/patients/{patient_id}/encounters/{encounter_id}/{suffix}",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code in (200, 403, 404)


@pytest.mark.authenticated
@pytest.mark.readonly
@pytest.mark.parametrize(
    "suffix",
    ["ros", "care-plan"],
)
def test_patient_encounter_collection(
    suffix, api_session, base_url, auth_headers, patient_id
):
    response = api_session.get(
        f"{base_url}/patients/{patient_id}/{suffix}",
        headers=auth_headers,
        timeout=15,
    )
    assert response.status_code in (200, 403, 404)


@pytest.mark.authenticated
@pytest.mark.production_write
def test_create_encounter():
    pytest.fail("Disabled: creating an encounter writes clinical production data")


@pytest.mark.authenticated
@pytest.mark.production_write
def test_update_encounter():
    pytest.fail("Disabled: updating an encounter writes clinical production data")
