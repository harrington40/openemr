# OpenRx API tests (pytest)

Black-box tests that drive the running NestJS backend over HTTP. They cover
every route the API exposes without needing the backend's source tree.

## Running

```bash
cd backend/tests/api-tests
python -m pip install -r requirements.txt

# Whole suite against the default (production) URL
pytest -v

# Against a local backend
OPENRX_API_URL=http://localhost:3002/api pytest -v

# Only the whole-API contract tests
pytest -m surface

# Skip the contract tests for a fast run
pytest -m "not surface"
```

CI runs this folder as the `api-tests` job in
`.github/workflows/backend-ci.yml`.

## Layout

| Path | Purpose |
| --- | --- |
| `api_routes.py` | **Generated** inventory of every backend route (see below) |
| `generate_api_routes.py` | Regenerates `api_routes.py` from the controllers |
| `test_api_surface.py` | Whole-API contract tests driven by the inventory |
| `<domain>/test_*.py` | Per-domain tests (patients, billing, fda, …) |

`api_routes.py` is generated from `backend/src/**/*.controller.ts`, so a new
controller route cannot escape the contract tests. After changing a controller:

```bash
python generate_api_routes.py
```

## What the contract tests check

`test_api_surface.py` walks every route and asserts, **without authenticating**:

* a guarded route rejects an anonymous caller with `401`/`403` (the guard runs
  before the handler, so no data is touched even for write methods);
* a public read route answers and never returns a `5xx`;
* the set of public read/write endpoints matches a reviewed snapshot, so adding
  a new unauthenticated endpoint fails the build until it is acknowledged.

## Environment variables

| Variable | Effect |
| --- | --- |
| `OPENRX_API_URL` | API base URL, including the `/api` prefix. Defaults to the local test backend (`http://localhost:3202/api`) — never production. |
| `OPENRX_API_TOKEN` | Staff JWT. Without it, every `@authenticated` test skips. The tests in `auth/` log in themselves and need no token. |
| `OPENRX_TEST_USER` / `OPENRX_TEST_PASSWORD` | Credentials the authentication tests log in with. Default to the seeded `admin` / `OpenRxTest123`. |
| `OPENRX_RUN_WRITES` | Set to `true` to stop skipping `production_write`/`destructive` tests. Leave unset unless you are pointed at a throwaway environment. |
| `OPENRX_TEST_PATIENT_ID` | Patient id for patient-scoped tests. |
| `OPENRX_TEST_ENCOUNTER_ID` | Encounter id for encounter tests. |
| `OPENRX_TEST_APPOINTMENT_ID` | Appointment id. |
| `OPENRX_TEST_DOCUMENT_ID` | Document id. |
| `OPENRX_TEST_LAB_REPORT_ID` | Lab report id. |
| `OPENRX_TEST_PROVIDER_ID` | Provider id. |
| `OPENRX_TEST_ADMIN_USER_ID` | Administrator id. |

Tests that need a value which is not configured **skip** rather than fail, so the
suite is green out of the box and becomes deeper as the environment is seeded.

## Write safety

Nothing in this suite creates, modifies or deletes production data by default:

* the contract tests only send requests that a guard rejects;
* tests marked `production_write` or `destructive` are skipped by
  `conftest.py` unless `OPENRX_RUN_WRITES=true`;
* the remaining write tests call `pytest.fail(...)` so they cannot quietly do
  something destructive once writes are enabled — they have to be rewritten
  against real test data first.

## Markers

`readonly`, `authenticated`, `production_write`, `destructive`, `later`,
`smoke`, `surface` — see `pytest.ini`.

## Bootstrap note

`tests/create_api_test_suite.sh` created this folder originally. It now refuses
to run against an initialised suite; pass `--force` if you really mean to
regenerate and overwrite the files it manages.
