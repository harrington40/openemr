# Test database

A throwaway database for CI and local integration testing, built from
repository assets. Tests never read production rows.

```bash
bash ./test-db/setup-test-db.sh                    # create / recreate + seed
bash ./test-db/run-backend-against-test-db.sh      # boot backend on :3202

bash ./test-db/setup-test-db.sh --docker           # no MariaDB installed? use a
                                                   # disposable container instead
```

Requires **Node** and a `npm ci` in `backend/` — SQL is executed by
`run-sql.mjs` using the backend's own `mysql2` dependency, so no `mysql` client
has to be installed on the machine or the CI agent. With `--docker` the only
other requirement is a working Docker daemon.

The scripts are called through `bash` on purpose. This repository has
`core.fileMode=false` (it is developed on a Windows mount), so Git does not
record the executable bit and a fresh checkout will hand you a *non-executable*
script. Calling `bash <script>` avoids relying on the mode bit.

## Should we snapshot the production database?

**No — not the rows.** This is a medical records system, so a copy of the
production tables is a copy of real patient data (names, dates of birth, phone
numbers, diagnoses) sitting in a test environment, in CI artifacts, and in
whatever backups that environment has. That is a compliance problem first and a
technical one second, and it is unnecessary here because the database is tiny
(~11 MB) and the application provisions most of its own schema.

**Do use the schema, not the data.** `sql/database.sql` is already in this
repository and is the authoritative upstream OpenEMR schema: 283 tables, no
rows, and it loads in ~8 seconds. `test-db/seed.sql` then adds a handful of
*synthetic* staff and patients.

So the recommended shape is:

| Source | What comes from it |
| --- | --- |
| `sql/database.sql` | The 283 upstream tables (schema only, no rows) |
| `test-db/patches.sql` | Columns and tables the repository is missing (see below) |
| `test-db/seed.sql` | Synthetic staff, patients, one appointment |
| The backend itself | Its ~30 own tables, created via `CREATE TABLE IF NOT EXISTS` on boot |

If you ever genuinely need production-*shaped* data rather than production
data, take **schema only** (`mysqldump --no-data openemr`) and generate rows —
never copy row data "temporarily".

## This surfaced three real bugs

Building a database from the repository alone does not currently reproduce
production, which means a fresh production deployment would also be broken.
`patches.sql` records and fixes each gap:

1. **Hand-added columns.** `users.registration_status`, `users.can_view_charts`,
   `users.can_edit_providers`, `users.calendar_color`, `patient_data.public_id`,
   `patient_data.approved_at`, `patient_data.chart_shared` and
   `procedure_order.specimen_id` exist in production but are declared nowhere in
   the repository and are not created at runtime. Login reads
   `users.registration_status`, and the patient portal keys off
   `patient_data.public_id`.
2. **Four tables with no `CREATE TABLE` anywhere.**
   `licenses`, `avatars`, `imaging` and `documents_secure` back TypeORM entities,
   but `synchronize` is off and no service creates them, so a fresh database
   makes `/license/status`, `/documents` and `/imaging` return 500. Their
   production DDL is reproduced in `patches.sql`.
3. **Wrong ordering in `InventoryService`.** It ensures the `approved_by_*`
   columns on `inventory_requests` (≈lines 520–530) *before* creating the table
   (≈line 595). On a fresh database the `ALTER`s fail, the table is then created
   without those columns, and queries selecting them break.

The right long-term fix for all three is to move this DDL into the services'
existing `ensureSchema()` methods (or into real migrations) so a fresh deployment
cannot miss it. `patches.sql` is the explicit, versioned record until then.

## How it stays safe

* The schema is built from `sql/database.sql` — production is never contacted.
* Provisioning creates a dedicated MySQL user (`openrx_test`) granted on
  `openrx_test.*` only. `setup-test-db.sh` verifies at the end that this user
  **cannot** read another schema and fails the build if it can.
* `tests/api-tests/conftest.py` no longer defaults to the production URL; it
  defaults to `http://localhost:3202/api`, which is the local test backend.
* Tests that write are still skipped unless `OPENRX_RUN_WRITES=true`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` | MariaDB to provision on |
| `DB_SOCKET` | *(unset)* | Connect over this unix socket instead of TCP |
| `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD` | `root` / `root` | Used to create the schema and grants |
| `TEST_DB_NAME` | `openrx_test` | Test schema |
| `TEST_DB_USER` / `TEST_DB_PASSWORD` | `openrx_test` / `openrx_test` | Restricted runtime user |
| `TEST_DB_CONTAINER` / `TEST_DB_IMAGE` | `openrx-test-db` / `mariadb:11.8` | Container name and image for `--docker` |
| `PORT` | `3202` | Backend port for local runs |

For this development machine the containerised MariaDB listens on **8320**:

```bash
DB_HOST=127.0.0.1 DB_PORT=8320 DB_ADMIN_USER=root DB_ADMIN_PASSWORD=root \
    bash ./test-db/setup-test-db.sh
```

### Which database should Jenkins use?

The pipeline defaults to `tcp 127.0.0.1:3306` as `root`, which is not true
everywhere. Run this **on the Jenkins agent** to find out which case applies:

```bash
ss -ltnp 2>/dev/null | grep -E ':3306|:3307' || echo 'no sql server listening'
ls -l /run/mysqld/mysqld.sock 2>/dev/null || echo 'no local socket'
docker --version  2>/dev/null || echo 'no docker'
python3 --version 2>/dev/null || echo 'no python3'
```

| What the agent shows | Set in the Jenkins job |
| --- | --- |
| Nothing listening, but `docker` works | `TEST_DB_USE_DOCKER=true` — the pipeline starts its own MariaDB |
| Nothing listening and no `docker` | Install MariaDB on the agent (`apt-get install -y mariadb-server`) |
| Listening on 3306 and root works over TCP | `DB_HOST` / `DB_PORT` / `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD` |
| Listening, but TCP says `Access denied` for root | `DB_SOCKET=/run/mysqld/mysqld.sock` (root is socket-auth only) |

Set these in **Job → Configure → Environment variables**. The pipeline reads any
value that is already set and only falls back to its own default, so no
Jenkinsfile edit is needed.

The provisioning step prints the raw driver error (`ECONNREFUSED` versus
`Access denied`) so the build log tells you which row of that table you are in.

## Seeded credentials (test-only)

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `OpenRxTest123` | administrator |
| `dr.test` | `OpenRxTest123` | physician |

Seeded patient ids: `1`, `2`, `3`. Appointment id: `1`.

## What Jenkins runs

The pipeline builds the test schema, then runs the e2e and API suites against
it (`Backend - Provision Test Database`, `Backend - E2E Tests (test DB)`,
`Backend - API Tests (test DB)`).

Agent prerequisites: **Node** (the pipeline already installs it) plus a MariaDB
reachable at `DB_HOST:DB_PORT`, and `python3` + `pip` for the API suite. No
`mysql` client is needed. If the agent has no MariaDB, set
`TEST_DB_USE_DOCKER=true` in the job and the pipeline will start a disposable
`mariadb:11.8` container and remove it in `post { always }`.

> The `--docker` path could not be exercised in the development sandbox: its
> Docker daemon cannot program NAT rules (`Unable to enable DNAT rule`), and
> `--network host` collides with the database already on port 3306. On a normal
> Linux host port publishing works, but treat that path as untested.

Verified locally end to end: backend boots against the fresh schema with no
warnings, and the API suite reports **426 passed, 138 skipped, 0 failed**.

## Adding data for more tests

Extend `seed.sql`. Keep it synthetic, and prefer fixed primary keys with
`ON DUPLICATE KEY UPDATE` so the file stays re-runnable. If a test needs a new
identifier, add an `OPENRX_TEST_*` environment variable and read it through the
fixtures in `tests/api-tests/conftest.py` rather than hard-coding an id.
