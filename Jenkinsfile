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
