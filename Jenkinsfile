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
         * Tests NEVER run against the production schema. `backend/test-db/setup-test-db.sh`
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
        // Optional path to the private key the tunnel should use. Leave empty to
        // use the Jenkins user's default identities.
        TEST_DB_SSH_KEY = "${env.TEST_DB_SSH_KEY ?: ''}"

        /*
         * Backend deployment (see the 'Backend - Deploy' stage).
         *
         * DEPLOY_BACKEND is deliberately off: this job runs on a 35-minute
         * cron, so a default of true would push every commit straight to
         * production. Set it to 'true' for a build you intend to release.
         *
         * DEPLOY_SSH_KEY points at a key owned by the `dev` account on this
         * Jenkins host. The pipeline runs as root, which can read it; move the
         * key into /root/.ssh and repoint this if you prefer.
         */
        DEPLOY_BACKEND = "${env.DEPLOY_BACKEND ?: 'false'}"
        DEPLOY_SERVER = "${env.DEPLOY_SERVER ?: 'dev@94.250.201.58'}"
        DEPLOY_REMOTE_DIR = "${env.DEPLOY_REMOTE_DIR ?: '/home/dev/openrx'}"
        DEPLOY_KEEP = "${env.DEPLOY_KEEP ?: '3'}"
        DEPLOY_SSH_KEY = "${env.DEPLOY_SSH_KEY ?: '/home/dev/.ssh/openrx-deploy'}"
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
         * OPENEMR BACKEND
         * ==========================================
         * This pipeline concerns backend/ only: that is the application which is
         * built, deployed, run and tested here. The React SPA in interface/new
         * (which builds into the repository-root public/dist) is deliberately
         * excluded — build and ship it separately, as
         * deploy/deploy-local.sh --frontend does.
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
         * SQL is executed with Node via backend/test-db/run-sql.mjs and the backend's
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

                    # Optional explicit identity file, for when the Jenkins user's
                    # default keys are not the ones authorised on the DB host:
                    # TEST_DB_SSH_KEY=/root/.ssh/openrx-test-db
                    TUNNEL_KEY_OPT=""
                    if [ -n "${TEST_DB_SSH_KEY:-}" ]; then
                        TUNNEL_KEY_OPT="-i $TEST_DB_SSH_KEY"
                    fi

                    echo "Forwarding 127.0.0.1:$TEST_DB_TUNNEL_PORT to $TEST_DB_SSH_TUNNEL (its own 127.0.0.1:3306)"

                    # Backgrounded rather than using `ssh -f` so the PID is known
                    # and post { always } can close it deterministically.
                    # ExitOnForwardFailure makes ssh fail loudly instead of
                    # silently continuing without the forward. Everything is on
                    # one line: these blocks run under /bin/sh (dash), and a
                    # backslash-continuation inside a Groovy triple-quoted string
                    # is not reliable.
                    setsid nohup ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new $TUNNEL_KEY_OPT -L "$TEST_DB_TUNNEL_PORT:127.0.0.1:3306" "$TEST_DB_SSH_TUNNEL" > "$TUNNEL_LOG" 2>&1 &
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
                        bash ./backend/test-db/setup-test-db.sh --docker
                    elif [ "${TEST_DB_MANAGED:-false}" = "true" ]; then
                        bash ./backend/test-db/setup-test-db.sh --managed
                    else
                        bash ./backend/test-db/setup-test-db.sh
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
                        # Exported rather than prefixed onto one continued command:
                        # a backslash-continuation inside a Groovy triple-quoted
                        # string depends on Groovy's own escape handling, and the
                        # failure mode when that goes wrong is silent — the
                        # assignments become no-ops and the command runs with the
                        # wrong environment.
                        export DB_HOST="$DB_HOST"
                        export DB_PORT="$DB_PORT"
                        export DB_USERNAME="$TEST_DB_USER"
                        export DB_PASSWORD="$TEST_DB_PASSWORD"
                        export DB_DATABASE="$TEST_DB_NAME"
                        export DB_LOGGING=false

                        # --forceExit: the MySQL pool and the socket.io gateway keep
                        # the event loop alive, so Jest never exits on its own.
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
                    python3 -m venv --help >/dev/null 2>&1 || {
                        echo "[api-tests] 'python3 -m venv' is unavailable - install python3-venv on the agent"
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
                        # Exported rather than prefixed with continuations. If the
                        # continuation did not collapse, the app would start with
                        # its own defaults instead - and would then be pointed at
                        # a different database than the one just provisioned.
                        export PORT="$TEST_API_PORT"
                        export DB_HOST="$DB_HOST"
                        export DB_PORT="$DB_PORT"
                        export DB_USERNAME="$TEST_DB_USER"
                        export DB_PASSWORD="$TEST_DB_PASSWORD"
                        export DB_DATABASE="$TEST_DB_NAME"
                        export DB_LOGGING=false
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
                    cd backend/tests/api-tests

                    # Drop any report left in the workspace. A stale file that
                    # survives (or is checked out from an earlier commit) would
                    # otherwise be archived as this run's result, which is
                    # exactly how an old 106-test report kept reappearing.
                    rm -f pytest-results.xml

                    # A throwaway virtualenv, not the system Python: Ubuntu 24.04
                    # ships /usr/lib/python3.12/EXTERNALLY-MANAGED, so a plain
                    # `pip install` is refused outright.
                    API_VENV="$WORKSPACE/.test-db-venv"
                    python3 -m venv "$API_VENV"
                    "$API_VENV/bin/python" -m pip install --quiet --upgrade pip
                    "$API_VENV/bin/python" -m pip install --quiet -r requirements.txt

                    # Exported, not prefixed with continuations — see the e2e stage.
                    export OPENRX_API_URL="$API_URL"
                    export OPENRX_API_TOKEN="$TOKEN"
                    export OPENRX_TEST_PATIENT_ID=1
                    export OPENRX_TEST_APPOINTMENT_ID=1
                    export OPENRX_TEST_PROVIDER_ID=2
                    export OPENRX_TEST_ADMIN_USER_ID=1

                    "$API_VENV/bin/python" -m pytest -v --junitxml=pytest-results.xml
                '''
            }
        }

        /*
         * ==========================================
         * DEPLOY THE BACKEND APPLICATION
         * ==========================================
         * Ships the dist/ this build already produced, through the same
         * server-side deploy.sh the manual flow uses, so the backup, the
         * atomic swap and the pm2 restart behave identically.
         *
         * Opt in with DEPLOY_BACKEND=true — this job runs on a 35-minute cron,
         * so deploying implicitly would push every commit straight to
         * production. It is also the last stage on purpose: any failure above
         * it skips the deploy.
         */
        stage('Backend - Deploy') {
            when { expression { return env.DEPLOY_BACKEND == 'true' } }
            steps {
                sh '''
                    set -e

                    TARBALL="$WORKSPACE/openrx-backend-dist.tar.gz"

                    # deploy.sh refuses a tarball without a top-level dist/, so
                    # verify the build output before packaging.
                    test -f backend/dist/main.js || {
                        echo "[deploy] backend/dist/main.js is missing - the build did not run"
                        exit 1
                    }

                    rm -f "$TARBALL"
                    tar -czf "$TARBALL" -C backend dist
                    echo "[deploy] packaged $(du -h "$TARBALL" | cut -f1)"

                    # Word-split deliberately: SSH_OPTS is a list of arguments.
                    SSH_OPTS="-i $DEPLOY_SSH_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

                    echo "[deploy] uploading to $DEPLOY_SERVER:$DEPLOY_REMOTE_DIR/incoming"
                    ssh $SSH_OPTS "$DEPLOY_SERVER" "mkdir -p $DEPLOY_REMOTE_DIR/incoming"
                    scp -q $SSH_OPTS "$TARBALL" "$DEPLOY_SERVER:$DEPLOY_REMOTE_DIR/incoming/"

                    echo "[deploy] running the remote deploy"
                    ssh $SSH_OPTS "$DEPLOY_SERVER" "cd $DEPLOY_REMOTE_DIR && ./deploy.sh --backend incoming/openrx-backend-dist.tar.gz --keep $DEPLOY_KEEP"

                    echo "[deploy] backend deployed"
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
                artifacts: 'backend-test-server.log, backend/tests/api-tests/pytest-results.xml',
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
