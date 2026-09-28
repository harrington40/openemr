pipeline {
    agent any

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
                    echo "Node:"
                    node --version

                    echo "NPM:"
                    npm --version

                    echo "Git:"
                    git --version
                '''
            }
        }

        stage('OpenEMR UI - Install') {
            steps {
                sh '''
                    npm ci
                '''
            }
        }

        stage('OpenEMR UI - Lint') {
            steps {
                sh '''
                    npm run lint:js
                    npm run stylelint
                '''
            }
        }

        stage('OpenEMR UI - Tests') {
            steps {
                sh '''
                    npm run test:js -- --runInBand
                '''
            }
        }

        stage('OpenEMR UI - Build') {
            steps {
                sh '''
                    npm run build
                '''
            }
        }

        stage('Backend - Install') {
            steps {
                dir('backend') {
                    sh '''
                        npm ci
                    '''
                }
            }
        }

        stage('Backend - Lint') {
            steps {
                dir('backend') {
                    sh '''
                        npx eslint "{src,apps,libs,test}/**/*.ts"
                    '''
                }
            }
        }

        stage('Backend - Unit Tests') {
            steps {
                dir('backend') {
                    sh '''
                        npm test -- --runInBand
                    '''
                }
            }
        }

        stage('Backend - Build') {
            steps {
                dir('backend') {
                    sh '''
                        npm run build
                    '''
                }
            }
        }
    }

    post {
        success {
            echo '======================================'
            echo ' OpenEMR DEVELOPER CI PASSED'
            echo '======================================'
        }

        failure {
            echo '======================================'
            echo ' OpenEMR DEVELOPER CI FAILED'
            echo '======================================'
        }

        always {
            echo "Build: ${env.BUILD_NUMBER}"
            echo "Branch: ${env.BRANCH_NAME}"
            echo "Commit: ${env.GIT_COMMIT}"
        }
    }
}
