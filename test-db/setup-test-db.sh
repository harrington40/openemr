#!/usr/bin/env bash
#
# Create (or recreate) the OpenRx test database.
#
# The database is built entirely from repository assets:
#
#   sql/database.sql   upstream OpenEMR schema, 283 tables, no rows
#   patches.sql        OpenRx columns/tables the base schema is missing
#   seed.sql           synthetic staff/patients/appointment data
#
# The backend then provisions its own ~30 tables on boot via
# `CREATE TABLE IF NOT EXISTS`, so nothing about those tables is snapshotted.
#
# No production rows are ever read. The script only *writes* to the test
# database, and it creates a dedicated MySQL user that cannot see any other
# schema, so a misconfigured test run cannot reach production.
#
# SQL runs through run-sql.mjs (mysql2 from backend/node_modules) instead of the
# `mysql` client, because a CI agent cannot be assumed to have that client
# installed. Run `npm ci` in backend/ first.
#
# Usage:
#   ./setup-test-db.sh            create/recreate against DB_HOST/DB_PORT
#   ./setup-test-db.sh --keep     keep existing data, re-apply patches + seed
#   ./setup-test-db.sh --docker   start a disposable MariaDB container first
#
# Environment overrides:
#   DB_HOST DB_PORT                   server host/port (default localhost:3306)
#   DB_ADMIN_USER DB_ADMIN_PASSWORD   may CREATE DATABASE and GRANT (root/root)
#   TEST_DB_NAME                      default openrx_test
#   TEST_DB_USER TEST_DB_PASSWORD     default openrx_test / openrx_test
#   TEST_DB_CONTAINER TEST_DB_IMAGE   default openrx-test-db / mariadb:11.8
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_ADMIN_USER="${DB_ADMIN_USER:-root}"
DB_ADMIN_PASSWORD="${DB_ADMIN_PASSWORD:-root}"

TEST_DB_NAME="${TEST_DB_NAME:-openrx_test}"
TEST_DB_USER="${TEST_DB_USER:-openrx_test}"
TEST_DB_PASSWORD="${TEST_DB_PASSWORD:-openrx_test}"

TEST_DB_CONTAINER="${TEST_DB_CONTAINER:-openrx-test-db}"
TEST_DB_IMAGE="${TEST_DB_IMAGE:-mariadb:11.8}"

MODE="fresh"
USE_DOCKER=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --keep)   MODE="keep"; shift ;;
        --docker) USE_DOCKER=1; shift ;;
        -h|--help) sed -n '3,32p' "$0" | sed -E 's/^# ?//'; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

log()  { printf '\033[0;36m[test-db]\033[0m %s\n' "$*"; }
ok()   { printf '\033[0;32m       ok\033[0m %s\n' "$*"; }
fail() { printf '\033[0;31m   [fail]\033[0m %s\n' "$*" >&2; exit 1; }

RUN_SQL="$SCRIPT_DIR/run-sql.mjs"

# run_sql <user> <password> <database|-> [run-sql.mjs arguments...]
run_sql() {
    local user="$1" password="$2" database="$3"
    shift 3

    local args=(--host "$DB_HOST" --port "$DB_PORT" --user "$user" --password "$password")
    [[ "$database" != "-" ]] && args+=(--database "$database")

    node "$RUN_SQL" "${args[@]}" "$@"
}

admin_sql()  { run_sql "$DB_ADMIN_USER" "$DB_ADMIN_PASSWORD" - "$@"; }
target_sql() { run_sql "$TEST_DB_USER" "$TEST_DB_PASSWORD" "$TEST_DB_NAME" "$@"; }

# --- 0. Pre-flight ----------------------------------------------------------
command -v node >/dev/null 2>&1 || fail "node is required to run the tests"

if [[ ! -d "$REPO_ROOT/backend/node_modules/mysql2" ]]; then
    fail "backend/node_modules/mysql2 is missing - run 'npm ci' in backend/ first"
fi

[[ -f "$REPO_ROOT/sql/database.sql" ]] || fail "sql/database.sql not found"
[[ -f "$SCRIPT_DIR/patches.sql" ]]     || fail "patches.sql not found"
[[ -f "$SCRIPT_DIR/seed.sql" ]]        || fail "seed.sql not found"

# --- 0b. Optionally bring up a disposable server ----------------------------
if [[ "$USE_DOCKER" -eq 1 ]]; then
    command -v docker >/dev/null 2>&1 || fail "--docker requested but docker is not installed"

    DB_HOST="127.0.0.1"
    DB_ADMIN_USER="root"

    log "Starting disposable $TEST_DB_IMAGE as '$TEST_DB_CONTAINER' on :$DB_PORT"
    docker rm -f "$TEST_DB_CONTAINER" >/dev/null 2>&1 || true
    docker run -d \
        --name "$TEST_DB_CONTAINER" \
        -e MARIADB_ROOT_PASSWORD="$DB_ADMIN_PASSWORD" \
        -p "$DB_PORT:3306" \
        "$TEST_DB_IMAGE" >/dev/null

    log "Waiting for MariaDB to accept connections"
    ready=0
    for _ in $(seq 1 60); do
        if run_sql "$DB_ADMIN_USER" "$DB_ADMIN_PASSWORD" - \
                --execute "SELECT 1" --quiet >/dev/null 2>&1; then
            ready=1
            break
        fi
        sleep 1
    done

    if [[ "$ready" -ne 1 ]]; then
        # The usual cause is that the container never started (image missing,
        # or the host cannot publish the port). Show it rather than just timing
        # out with no explanation.
        echo "--- docker state ---" >&2
        docker ps -a --filter "name=^/$TEST_DB_CONTAINER\$" >&2 || true
        echo "--- last container logs ---" >&2
        docker logs --tail 30 "$TEST_DB_CONTAINER" >&2 || true
        fail "MariaDB container did not become ready on $DB_HOST:$DB_PORT"
    fi

    ok "container ready on $DB_HOST:$DB_PORT"
fi

# Reachability check, so a bad host/credential gives a clear message rather
# than a raw driver stack trace.
if ! run_sql "$DB_ADMIN_USER" "$DB_ADMIN_PASSWORD" - \
        --execute "SELECT 1" --quiet >/dev/null 2>&1; then
    fail "cannot connect to MariaDB at $DB_HOST:$DB_PORT as '$DB_ADMIN_USER'.
       Set DB_HOST/DB_PORT/DB_ADMIN_USER/DB_ADMIN_PASSWORD, or re-run with --docker."
fi

# --- 1. Database + restricted user ------------------------------------------
if [[ "$MODE" == "keep" ]]; then
    log "Keeping existing database $TEST_DB_NAME"
    admin_sql --quiet --execute \
        "CREATE DATABASE IF NOT EXISTS \`$TEST_DB_NAME\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
else
    log "Recreating database $TEST_DB_NAME"
    admin_sql --quiet --execute \
        "DROP DATABASE IF EXISTS \`$TEST_DB_NAME\`;
         CREATE DATABASE \`$TEST_DB_NAME\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
fi
ok "database ready"

log "Ensuring restricted user '$TEST_DB_USER' (scoped to $TEST_DB_NAME only)"
admin_sql --quiet --execute \
    "CREATE USER IF NOT EXISTS '$TEST_DB_USER'@'%' IDENTIFIED BY '$TEST_DB_PASSWORD';
     GRANT ALL PRIVILEGES ON \`$TEST_DB_NAME\`.* TO '$TEST_DB_USER'@'%';
     FLUSH PRIVILEGES;"
ok "user ready"

# --- 2. Schema --------------------------------------------------------------
if [[ "$MODE" == "fresh" ]]; then
    log "Loading upstream schema (sql/database.sql)"
    admin_sql --database "$TEST_DB_NAME" --file "$REPO_ROOT/sql/database.sql"
    ok "schema loaded"
fi

log "Applying OpenRx schema patches"
admin_sql --database "$TEST_DB_NAME" --file "$SCRIPT_DIR/patches.sql"
ok "patches applied"

# --- 3. Synthetic data ------------------------------------------------------
log "Loading synthetic seed data"
admin_sql --database "$TEST_DB_NAME" --file "$SCRIPT_DIR/seed.sql"
ok "seed loaded"

# --- 4. Prove the restricted user works, and is isolated --------------------
target_sql --execute "SELECT 1" --quiet >/dev/null
if target_sql --execute "SELECT 1 FROM openemr.patient_data LIMIT 1" --quiet >/dev/null 2>&1; then
    fail "user '$TEST_DB_USER' can read the production schema - fix the grants"
fi
ok "user '$TEST_DB_USER' is scoped to $TEST_DB_NAME and cannot read other schemas"

# --- 5. Summary -------------------------------------------------------------
tables=$(admin_sql --print --execute \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TEST_DB_NAME'")
patients=$(target_sql --print --execute "SELECT COUNT(*) FROM patient_data")
staff=$(target_sql --print --execute "SELECT COUNT(*) FROM users")

cat <<EOF

  test database : mysql://$TEST_DB_USER@$DB_HOST:$DB_PORT/$TEST_DB_NAME
  tables        : $tables
  patients      : $patients
  staff         : $staff

  Next:
    cp backend/.env.test.example backend/.env.test
    DB_HOST=$DB_HOST DB_PORT=$DB_PORT bash ./test-db/run-backend-against-test-db.sh

EOF
