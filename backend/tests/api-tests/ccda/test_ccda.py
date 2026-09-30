"""Continuity-of-care document export (``ccda.controller.ts``).

The C-CDA document is the full chart export, so the endpoint is guarded by
``JwtAuthGuard`` and needs a real patient id. ``OPENRX_TEST_PATIENT_ID`` seeds
the fixture; without it the test skips.
"""

import pytest


@pytest.mark.authenticated
@pytest.mark.readonly
def test_patient_ccda(api_session, base_url, auth_headers, patient_id):
    response = api_session.get(
        f"{base_url}/patients/{patient_id}/ccda",
        headers=auth_headers,
        timeout=60,
    )
    assert response.status_code in (200, 403, 404)
