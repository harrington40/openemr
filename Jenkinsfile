pipeline {
    agent any

    /*
     * Run automatically approximately every 35 minutes.
     * Jenkins hashes the starting minute so jobs are distributed.
     */
    triggers {
        cron('H/35 * * * *')
    }

    environment {
        NODE_VERSION = '24'

        /*
         * Test database connection.
         *
         * Tests NEVER run against the production schema. `test-db/setup-test-db.sh`
         * builds a throwaway schema from repository assets (sql/database.sql +
         * patches + synthetic seed) and grants a dedicated user access to that
         * schema only, so a misconfigured build cannot read patient data.
         *
         * Override these in the Jenkins job (or with credentials bindings) when
         * the MariaDB instance is not on localhost.
         */
        // Each value keeps an existing value if one is already set, so these
        // can be overridden from the Jenkins job configuration
        // (Configure > Environment variables) without editing this file.
        // Declarative `environment` otherwise overwrites job-level variables.
        DB_HOST = "${env.DB_HOST ?: '127.0.0.1'}"
        DB_PORT = "${env.DB_PORT ?: '3306'}"
        DB_SOCKET = "${env.DB_SOCKET ?: ''}"
        DB_ADMIN_USER = "${env.DB_ADMIN_USER ?: 'root'}"
        DB_ADMIN_PASSWORD = "${env.DB_ADMIN_PASSWORD ?: 'root'}"
        TEST_DB_NAME = "${env.TEST_DB_NAME ?: 'openrx_test'}"
        TEST_DB_USER = "${env.TEST_DB_USER ?: 'openrx_test'}"
        TEST_DB_PASSWORD = "${env.TEST_DB_PASSWORD ?: 'openrx_test'}"
        TEST_API_PORT = "${env.TEST_API_PORT ?: '3202'}"
        // Set TEST_DB_USE_DOCKER=true when the agent has no MariaDB: the
        // pipeline then starts and provisions a disposable container.
        TEST_DB_USE_DOCKER = "${env.TEST_DB_USE_DOCKER ?: 'false'}"
        TEST_DB_CONTAINER = "${env.TEST_DB_CONTAINER ?: 'openrx-test-db'}"
        // Set TEST_DB_MANAGED=true when the test schema and its user already
        // exist (created once by an administrator). The pipeline then needs no
        // administrative database credentials at all: TEST_DB_USER alone must
        // hold ALL PRIVILEGES on TEST_DB_NAME.
        TEST_DB_MANAGED = "${env.TEST_DB_MANAGED ?: 'false'}"

        // Set TEST_DB_SSH_TUNNEL=dev@host when the database lives on another
        // machine and only listens on its loopback interface — which is how the
        // production MariaDB is configured, so it is unreachable directly. The
        // pipeline then forwards a local port to it and DB_HOST stays
        // 127.0.0.1. Leave empty to skip the tunnel entirely.
        TEST_DB_SSH_TUNNEL = "${env.TEST_DB_SSH_TUNNEL ?: ''}"
        TEST_DB_TUNNEL_PORT = "${env.TEST_DB_TUNNEL_PORT ?: '13306'}"
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Environment') {
            steps {
                sh '''
                    set -e

                    echo "======================================"
                    echo " Jenkins Environment"
                    echo "======================================"

                    echo "Node:"
                    node --version

                    echo "NPM:"
                    npm --version

                    echo "Git:"
                    git --version

                    echo "Branch:"
                    git branch --show-current || true

                    echo "Commit:"
                    git rev-parse HEAD

                    echo "Expected Node version:"
                    echo "${NODE_VERSION}"

                    echo "======================================"
                '''
            }
        }

        /*
         * ==========================================
         * OPENEMR NEW UI
         * ==========================================
         */

        stage('New UI - Install') {
            steps {
                dir('interface/new') {
                    sh '''
                        set -e

                        echo "Installing New UI dependencies..."
                        npm ci

                        echo "Checking Node type definitions..."
                        npm ls @types/node --depth=0 || true
                    '''
                }
            }
        }

        stage('New UI - Test') {
            steps {
                dir('interface/new') {
                    sh '''
                        set -e

                        echo "Running New UI tests..."
                        echo "[new-ui] node $(node --version), npm $(npm --version)"

                        # No pipeline here on purpose. Jenkins runs these blocks
                        # with /bin/sh, which is dash on Ubuntu, and dash has no
                        # `set -o pipefail` (it aborts with "Illegal option").
                        # Without pipefail a pipe would report tee's exit status
                        # and hide a failing vitest run, so the output goes to a
                        # file and the status is captured directly instead.
                        #
                        # --no-file-parallelism: vitest otherwise runs every test
                        # file in parallel, and the jsdom workers made this the
                        # heaviest step in the pipeline (42s wall / 237s CPU).
                        # On the agent it was killed mid-run with no summary
                        # line, which is the signature of the kernel OOM killer
                        # rather than a failing test. Serialising the files costs
                        # wall-clock time (about 2m50s here) but uses far less
                        # memory.
                        status=0
                        npm run test -- --run --no-file-parallelism > "$WORKSPACE/new-ui-test.log" 2>&1 || status=$?

                        cat "$WORKSPACE/new-ui-test.log"

                        if [ "$status" -ne 0 ]; then
                            echo "[new-ui] vitest exited with code $status"
                            echo "[new-ui] 137 = killed (usually OOM), 134 = crashed, 1 = failing tests"
                            exit "$status"
                        fi
                    '''
                }
            }
        }

        stage('New UI - Build') {
            steps {
                dir('interface/new') {
                    sh '''
                        set -e

                        echo "Building OpenEMR New UI..."
                        npm run build
                    '''
                }
            }
        }

        /*
         * ==========================================
         * OPENEMR BACKEND
         * ==========================================
         */

        stage('Backend - Install') {
            steps {
                dir('backend') {
                    sh '''
                        set -e

                        echo "Installing backend dependencies..."
                        npm ci
                    '''
                }
            }
        }

        stage('Backend - Lint') {
            steps {
                dir('backend') {
                    sh '''
                        set -e

                        echo "Running backend ESLint..."
                        npx eslint "{src,apps,libs,test}/**/*.ts"
                    '''
                }
            }
        }

        stage('Backend - Unit Tests') {
            steps {
                dir('backend') {
                    sh '''
                        set -e

                        echo "Running backend unit tests..."
                        npm test -- --runInBand
                    '''
                }
            }
        }

        stage('Backend - Build') {
            steps {
                dir('backend') {
                    sh '''
                        set -e

                        echo "Building backend..."
                        npm run build
                    '''
                }
            }
        }

        /*
         * ==========================================
         * INTEGRATION TESTS AGAINST THE TEST DATABASE
         * ==========================================
         * These run against a throwaway schema built from repository assets,
         * never against production.
         *
         * SQL is executed with Node via test-db/run-sql.mjs and the backend's
         * own mysql2 dependency, so the agent does NOT need a `mysql` client.
         * Pre-requisites: Node (already installed by the earlier stages), a
         * MariaDB reachable at DB_HOST:DB_PORT, and python3 + pip for the API
         * suite. Set TEST_DB_USE_DOCKER=true to start a disposable container
         * instead of relying on an installed server.
         */

        stage('Backend - Open Test DB Tunnel') {
            // Only runs when TEST_DB_SSH_TUNNEL is set, so it is inert for a
            // local or containerised database.
            when { expression { return env.TEST_DB_SSH_TUNNEL?.trim() } }
            steps {
                sh '''
                    set -e

                    TUNNEL_LOG="$WORKSPACE/test-db-tunnel.log"
                    TUNNEL_PID_FILE="$WORKSPACE/test-db-tunnel.pid"

                    echo "Forwarding 127.0.0.1:$TEST_DB_TUNNEL_PORT to $TEST_DB_SSH_TUNNEL (its own 127.0.0.1:3306)"

                    # Backgrounded rather than using `ssh -f` so the PID is known
                    # and post { always } can close it deterministically.
                    # ExitOnForwardFailure makes ssh fail loudly instead of
                    # silently continuing without the forward. Everything is on
                    # one line: these blocks run under /bin/sh (dash), and a
                    # backslash-continuation inside a Groovy triple-quoted string
                    # is not reliable.
                    setsid nohup ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new -L "$TEST_DB_TUNNEL_PORT:127.0.0.1:3306" "$TEST_DB_SSH_TUNNEL" > "$TUNNEL_LOG" 2>&1 &
                    echo $! > "$TUNNEL_PID_FILE"

                    TUNNEL_PID="$(cat "$TUNNEL_PID_FILE")"
                    sleep 3

                    # No /dev/tcp or nc here: /dev/tcp is a bash feature and dash
                    # does not have it. ExitOnForwardFailure means a failed
                    # forward kills ssh, so checking that it is still running is
                    # enough, and the ssh error is printed when it is not.
                    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
                        echo "ssh exited before the tunnel was established:"
                        cat "$TUNNEL_LOG"
                        echo "(the Jenkins user needs an SSH key accepted by $TEST_DB_SSH_TUNNEL)"
                        exit 1
                    fi

                    echo "tunnel established (pid $TUNNEL_PID)"
                '''
            }
        }

        stage('Backend - Provision Test Database') {
            steps {
                sh '''
                    set -e

                    echo "Rebuilding the $TEST_DB_NAME schema from repository assets"

                    # Invoked through `bash` on purpose: this repository has
                    # core.fileMode=false, so the executable bit is unreliable
                    # in checkouts.
                    if [ "${TEST_DB_USE_DOCKER:-false}" = "true" ]; then
                        bash ./test-db/setup-test-db.sh --docker
                    elif [ "${TEST_DB_MANAGED:-false}" = "true" ]; then
                        bash ./test-db/setup-test-db.sh --managed
                    else
                        bash ./test-db/setup-test-db.sh
                    fi
                '''
            }
        }

        stage('Backend - E2E Tests (test DB)') {
            steps {
                dir('backend') {
                    sh '''
                        set -e

                        echo "Running e2e tests against $TEST_DB_NAME"

                        # The e2e spec boots AppModule in-process, so it needs the
                        # DB_* environment rather than a running server.
                        #
                        # --forceExit: the MySQL pool and the socket.io gateway keep
                        # the event loop alive, so Jest never exits on its own.
                        DB_HOST="$DB_HOST" \\
                        DB_PORT="$DB_PORT" \\
                        DB_USERNAME="$TEST_DB_USER" \\
                        DB_PASSWORD="$TEST_DB_PASSWORD" \\
                        DB_DATABASE="$TEST_DB_NAME" \\
                        DB_LOGGING=false \\
                        npm run test:e2e -- --forceExit
                    '''
                }
            }
        }

        stage('Backend - API Tests (test DB)') {
            steps {
                sh '''
                    set -e

                    # Fail with a clear message rather than a cryptic error later:
                    # this stage needs python3 (with pip) and curl on the agent.
                    for tool in python3 curl; do
                        command -v "$tool" >/dev/null 2>&1 || {
                            echo "[api-tests] '$tool' is required on the Jenkins agent"
                            exit 1
                        }
                    done
                    python3 -m pip --version >/dev/null 2>&1 || {
                        echo "[api-tests] 'python3 -m pip' is unavailable - install python3-pip on the agent"
                        exit 1
                    }

                    BACKEND_LOG="$WORKSPACE/backend-test-server.log"
                    BACKEND_PID=""

                    cleanup() {
                        if [ -n "$BACKEND_PID" ]; then
                            kill "$BACKEND_PID" 2>/dev/null || true
                            wait "$BACKEND_PID" 2>/dev/null || true
                        fi
                    }
                    trap cleanup EXIT

                    echo "Booting the backend against $TEST_DB_NAME on :$TEST_API_PORT"
                    (
                        cd backend
                        PORT="$TEST_API_PORT" \\
                        DB_HOST="$DB_HOST" \\
                        DB_PORT="$DB_PORT" \\
                        DB_USERNAME="$TEST_DB_USER" \\
                        DB_PASSWORD="$TEST_DB_PASSWORD" \\
                        DB_DATABASE="$TEST_DB_NAME" \\
                        DB_LOGGING=false \\
                        nohup node dist/main.js > "$BACKEND_LOG" 2>&1 &
                        echo $! > "$WORKSPACE/backend-test-server.pid"
                    )
                    BACKEND_PID="$(cat "$WORKSPACE/backend-test-server.pid")"

                    API_URL="http://localhost:$TEST_API_PORT/api"

                    # A remote database makes startup slower: every service's
                    # ensure-schema pass is a chain of network round trips, and
                    # booting against a database at the end of an SSH tunnel was
                    # measured at ~80s.
                    echo "Waiting for $API_URL/config ..."
                    for i in $(seq 1 300); do
                        if curl -fsS "$API_URL/config" >/dev/null 2>&1; then
                            echo "Backend is up after ${i}s"
                            break
                        fi
                        if [ "$i" -eq 300 ]; then
                            echo "Backend failed to start; last log lines:"
                            tail -40 "$BACKEND_LOG"
                            exit 1
                        fi
                        sleep 1
                    done

                    # Report startup errors, but do NOT fail on them. The health
                    # probe above is the real gate. Background services (SMTP,
                    # B2 storage, openFDA/RxNav, schedulers) legitimately log
                    # ERROR lines on a machine where those are not configured,
                    # and failing on any match turned that into a red build for
                    # reasons unrelated to the tests.
                    if grep -qiE 'error' "$BACKEND_LOG"; then
                        echo "--- backend logged the following during startup (informational) ---"
                        grep -iE 'error' "$BACKEND_LOG" | head -20
                        echo "--- continuing: /config answered $API_URL, so the app is serving ---"
                    fi

                    echo "Obtaining a test token as the seeded administrator"
                    TOKEN="$(python3 -c "
import json, urllib.request
req = urllib.request.Request(
    '$API_URL/auth/login',
    data=json.dumps({'username': 'admin', 'password': 'OpenRxTest123'}).encode(),
    headers={'Content-Type': 'application/json'},
)
print(json.load(urllib.request.urlopen(req, timeout=20))['token'])
")"

                    if [ -z "$TOKEN" ]; then
                        echo "[api-tests] login returned no token."
                        echo "[api-tests] Every authenticated test would be SKIPPED and the"
                        echo "[api-tests] build would still look green, so stop here instead."
                        exit 1
                    fi
                    echo "[api-tests] obtained a token (${#TOKEN} characters)"

                    echo "Running pytest against $API_URL"
                    cd tests/api-tests
                    python3 -m pip install --quiet -r requirements.txt
                    OPENRX_API_URL="$API_URL" \\
                    OPENRX_API_TOKEN="$TOKEN" \\
                    OPENRX_TEST_PATIENT_ID=1 \\
                    OPENRX_TEST_APPOINTMENT_ID=1 \\
                    OPENRX_TEST_PROVIDER_ID=2 \\
                    OPENRX_TEST_ADMIN_USER_ID=1 \\
                    python3 -m pytest -v --junitxml=pytest-results.xml
                '''
            }
        }
    }

    post {

        success {
            echo '======================================'
            echo ' OPENEMR DEVELOPER CI PASSED'
            echo '======================================'
            echo "Build: ${env.BUILD_NUMBER}"
            echo "Commit: ${env.GIT_COMMIT ?: 'unknown'}"
        }

        failure {
            echo '======================================'
            echo ' OPENEMR DEVELOPER CI FAILED'
            echo '======================================'
            echo "Build: ${env.BUILD_NUMBER}"
            echo "Commit: ${env.GIT_COMMIT ?: 'unknown'}"
        }

        always {
            // Keep the backend log and the pytest report around: without them a
            // failed build says only that some step returned non-zero.
            archiveArtifacts(
                artifacts: 'new-ui-test.log, backend-test-server.log, tests/api-tests/pytest-results.xml',
                allowEmptyArchive: true,
                fingerprint: false,
            )

            // Close the SSH tunnel, if the tunnel stage opened one.
            sh '''
                if [ -f "$WORKSPACE/test-db-tunnel.pid" ]; then
                    kill "$(cat "$WORKSPACE/test-db-tunnel.pid")" 2>/dev/null || true
                    rm -f "$WORKSPACE/test-db-tunnel.pid"
                    echo "test db tunnel closed"
                fi
            '''

            // Remove the disposable test database container, if one was used.
            // Guarded so it is harmless when docker is absent or the container
            // was never created.
            sh '''
                if [ "${TEST_DB_USE_DOCKER:-false}" = "true" ] && command -v docker >/dev/null 2>&1; then
                    docker rm -f "${TEST_DB_CONTAINER:-openrx-test-db}" >/dev/null 2>&1 || true
                fi
            '''

            echo '======================================'
            echo ' Jenkins Build Information'
            echo '======================================'
            echo "Build: ${env.BUILD_NUMBER}"
            echo "Job: ${env.JOB_NAME}"
            echo "Branch: ${env.BRANCH_NAME ?: 'developer'}"
            echo "Commit: ${env.GIT_COMMIT ?: 'unknown'}"
            echo "Build URL: ${env.BUILD_URL ?: 'unknown'}"
            echo '======================================'
        }
    }
}
