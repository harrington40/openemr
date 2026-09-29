#!/usr/bin/env bash
#
# Create (or recreate) the OpenRx test database.
#
# The database is built entirely from repository assets:
#
#   sql/database.sql   upstream OpenEMR schema, 283 tables, no rows
#   patches.sql        OpenRx columns the base schema is missing
#   seed.sql           synthetic staff/patients/appointment data
#
# The backend then provisions its own ~30 tables on boot via
# `CREATE TABLE IF NOT EXISTS`, so nothing about those tables is snapshotted.
#
# No production rows are ever read. The script only *writes* to the test
# database, and it creates a dedicated MySQL user that cannot see any other
# schema — so a misconfigured test run cannot reach production.
#
# Usage:
#   ./setup-test-db.sh                 # create/recreate, then seed
#   ./setup-test-db.sh --keep          # keep existing data, apply patches+seed
#
# Environment overrides:
#   DB_HOST DB_PORT            admin connection host/port (default localhost:3306)
#   DB_ADMIN_USER DB_ADMIN_PASSWORD   credentials allowed to CREATE DATABASE
#                                     and GRANT (default: root)
#   TEST_DB_NAME               default openrx_test
#   TEST_DB_USER               default openrx_test
#   TEST_DB_PASSWORD           default openrx_test
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

KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

log()  { printf '\033[0;36m[test-db]\033[0m %s\n' "$*"; }
ok()   { printf '\033[0;32m       ok\033[0m %s\n' "$*"; }
fail() { printf '\033[0;31m   [fail]\033[0m %s\n' "$*" >&2; exit 1; }

admin_sql() {
    mysql --protocol=TCP -h "$DB_HOST" -P "$DB_PORT" \
          -u "$DB_ADMIN_USER" -p"$DB_ADMIN_PASSWORD" \
          --batch --silent "$@"
}

# Runs SQL as the test user against the test schema. Used to prove the grants
# are sufficient, and for the summary counts.
target_sql() {
    mysql --protocol=TCP -h "$DB_HOST" -P "$DB_PORT" \
          -u "$TEST_DB_USER" -p"$TEST_DB_PASSWORD" \
          "$TEST_DB_NAME" "$@"
}

[[ -f "$REPO_ROOT/sql/database.sql" ]] || fail "sql/database.sql not found"
[[ -f "$SCRIPT_DIR/patches.sql" ]]     || fail "patches.sql not found"
[[ -f "$SCRIPT_DIR/seed.sql" ]]        || fail "seed.sql not found"

# --- 1. Database + restricted user ------------------------------------------
if [[ "$KEEP" -eq 1 ]]; then
    log "Keeping existing database $TEST_DB_NAME"
    admin_sql -e "CREATE DATABASE IF NOT EXISTS \`$TEST_DB_NAME\`
                  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
else
    log "Recreating database $TEST_DB_NAME"
    admin_sql -e "DROP DATABASE IF EXISTS \`$TEST_DB_NAME\`;
                  CREATE DATABASE \`$TEST_DB_NAME\`
                  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
fi
ok "database ready"

log "Ensuring restricted user '$TEST_DB_USER' (scoped to $TEST_DB_NAME only)"
admin_sql -e "CREATE USER IF NOT EXISTS '$TEST_DB_USER'@'%' IDENTIFIED BY '$TEST_DB_PASSWORD';"
admin_sql -e "GRANT ALL PRIVILEGES ON \`$TEST_DB_NAME\`.* TO '$TEST_DB_USER'@'%';"
admin_sql -e "FLUSH PRIVILEGES;"
ok "user ready"

# --- 2. Schema --------------------------------------------------------------
log "Loading upstream schema (sql/database.sql)"
if [[ "$KEEP" -eq 0 ]]; then
    admin_sql "$TEST_DB_NAME" < "$REPO_ROOT/sql/database.sql"
fi
ok "schema loaded"

log "Applying OpenRx schema patches"
admin_sql "$TEST_DB_NAME" < "$SCRIPT_DIR/patches.sql"
ok "patches applied"

# --- 3. Synthetic data ------------------------------------------------------
log "Loading synthetic seed data"
admin_sql "$TEST_DB_NAME" < "$SCRIPT_DIR/seed.sql"
ok "seed loaded"

# --- 3b. Prove the restricted user works and is isolated --------------------
target_sql -e "SELECT 1;" >/dev/null
if target_sql -e "SELECT 1 FROM openemr.patient_data LIMIT 1;" >/dev/null 2>&1; then
    fail "user '$TEST_DB_USER' can read the production schema - fix the grants"
fi
ok "user '$TEST_DB_USER' is scoped to $TEST_DB_NAME and cannot read other schemas"

# --- 4. Summary -------------------------------------------------------------
READY_URL="mysql://$TEST_DB_USER@$DB_HOST:$DB_PORT/$TEST_DB_NAME"
cat <<EOF

  test database : $READY_URL
  tables        : $(admin_sql -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TEST_DB_NAME';")
  patients      : $(target_sql -N -B -e "SELECT COUNT(*) FROM patient_data;" 2>/dev/null || echo 0)
  staff         : $(target_sql -N -B -e "SELECT COUNT(*) FROM users;" 2>/dev/null || echo 0)

  Next:
    cp backend/.env.test.example backend/.env.test
    bash ./test-db/run-backend-against-test-db.sh   # boot locally on :3202

EOF
