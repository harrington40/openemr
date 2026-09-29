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
        DB_HOST = '127.0.0.1'
        DB_PORT = '3306'
        DB_ADMIN_USER = 'root'
        DB_ADMIN_PASSWORD = 'root'
        TEST_DB_NAME = 'openrx_test'
        TEST_DB_USER = 'openrx_test'
        TEST_DB_PASSWORD = 'openrx_test'
        TEST_API_PORT = '3202'

        /*
         * Set TEST_DB_USE_DOCKER=true to have the pipeline start a disposable
         * MariaDB container for the run instead of using a server that is
         * already installed on the agent. Override TEST_DB_PORT when the
         * default collides with an existing database.
         */
        TEST_DB_USE_DOCKER = 'false'
        TEST_DB_CONTAINER = 'openrx-test-db'
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
                        npm run test -- --run
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

                    # App boot has been observed around 50s on a loaded machine,
                    # so allow generous headroom before declaring failure.
                    echo "Waiting for $API_URL/config ..."
                    for i in $(seq 1 150); do
                        if curl -fsS "$API_URL/config" >/dev/null 2>&1; then
                            echo "Backend is up after ${i}s"
                            break
                        fi
                        if [ "$i" -eq 150 ]; then
                            echo "Backend failed to start; last log lines:"
                            tail -40 "$BACKEND_LOG"
                            exit 1
                        fi
                        sleep 1
                    done

                    # Any boot warning here is a schema gap worth failing on.
                    if grep -qiE 'error' "$BACKEND_LOG"; then
                        echo "Backend logged errors during startup:"
                        grep -iE 'error' "$BACKEND_LOG" | head -20
                        exit 1
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
