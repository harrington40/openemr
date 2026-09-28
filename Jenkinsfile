pipeline {
    agent any

    environment {
        CI = 'true'
        NODE_VERSION = '24'
    }

    options {
        timestamps()
        disableConcurrentBuilds()
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
                    echo "===== Environment ====="
                    node --version
                    npm --version
                    git --version
                    echo "Branch: ${BRANCH_NAME}"
                    echo "Commit: ${GIT_COMMIT}"
                '''
            }
        }

        stage('New UI - Install') {
            steps {
                dir('interface/new') {
                    sh 'npm ci'
                }
            }
        }

        stage('New UI - Test') {
            steps {
                dir('interface/new') {
                    sh 'npm run test -- --run'
                }
            }
        }

        stage('New UI - Build') {
            steps {
                dir('interface/new') {
                    sh 'npm run build'
                }
            }
        }

        stage('Backend - Install') {
            steps {
                dir('backend') {
                    sh 'npm ci'
                }
            }
        }

        stage('Backend - Lint') {
            steps {
                dir('backend') {
                    sh 'npx eslint "{src,apps,libs,test}/**/*.ts"'
                }
            }
        }

        stage('Backend - Unit Tests') {
            steps {
                dir('backend') {
                    sh 'npm test -- --runInBand'
                }
            }
        }

        stage('Backend - Build') {
            steps {
                dir('backend') {
                    sh 'npm run build'
                }
            }
        }
    }

    post {
        success {
            echo '======================================'
            echo ' OPENEMR DEVELOPER CI PASSED'
            echo '======================================'
        }

        failure {
            echo '======================================'
            echo ' OPENEMR DEVELOPER CI FAILED'
            echo '======================================'
        }

        always {
            echo '======================================'
            echo "Build: ${BUILD_NUMBER}"
            echo "Branch: ${BRANCH_NAME}"
            echo "Commit: ${GIT_COMMIT}"
            echo '======================================'
        }
    }
}
