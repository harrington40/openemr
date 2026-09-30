#!/usr/bin/env bash
#
# Boot the backend against the test database.
#
# This is the same thing Jenkins does before running the e2e and API tests: the
# backend is started from a build output with the DB_* environment pointed at
# the test schema, so nothing it does can reach production data.
#
# Usage:
#   ./run-backend-against-test-db.sh            # build if needed, run in foreground
#   ./run-backend-against-test-db.sh --build    # force a rebuild first
#
# Environment overrides: DB_HOST DB_PORT TEST_DB_NAME TEST_DB_USER
#                        TEST_DB_PASSWORD PORT
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # backend/test-db
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"                  # backend

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
TEST_DB_NAME="${TEST_DB_NAME:-openrx_test}"
TEST_DB_USER="${TEST_DB_USER:-openrx_test}"
TEST_DB_PASSWORD="${TEST_DB_PASSWORD:-openrx_test}"
PORT="${PORT:-3202}"

cd "$BACKEND_DIR"

if [[ "${1:-}" == "--build" || ! -f dist/main.js ]]; then
    echo "[test-db] building backend"
    npm run build
fi

cat <<EOF
[test-db] starting backend against $TEST_DB_NAME on http://localhost:$PORT/api
[test-db]   DB_HOST=$DB_HOST DB_PORT=$DB_PORT DB_USERNAME=$TEST_DB_USER
EOF

# process.env wins over .env (dotenv does not override), so these overrides are
# enough even though backend/.env points at the production database.
#
# DB_LOGGING is left off: TypeORM parameter logging writes patient names, dates
# of birth and phone numbers into plaintext logs.
exec env \
    PORT="$PORT" \
    DB_HOST="$DB_HOST" \
    DB_PORT="$DB_PORT" \
    DB_USERNAME="$TEST_DB_USER" \
    DB_PASSWORD="$TEST_DB_PASSWORD" \
    DB_DATABASE="$TEST_DB_NAME" \
    DB_LOGGING=false \
    node "$BACKEND_DIR/dist/main.js"
