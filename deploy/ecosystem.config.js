// PM2 process descriptor for the OpenRx NestJS backend.
//
// Install / refresh:
//   pm2 startOrRestart /home/dev/openrx/ecosystem.config.js && pm2 save
//
// The backend reads its configuration from /home/dev/openrx/backend/.env,
// so `cwd` must point at the backend directory.
module.exports = {
  apps: [
    {
      name: 'openrx-backend',
      cwd: '/home/dev/openrx/backend',
      script: 'dist/main.js',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
      watch: false,
      autorestart: true,
      // An app that dies immediately is treated as unstable, so a boot failure
      // (e.g. dist mid-swap) cannot rack up hundreds of restarts.
      min_uptime: '10s',
      max_restarts: 30,
      restart_delay: 4000,
      max_memory_restart: '512M',
      kill_timeout: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/home/dev/.pm2/logs/openrx-backend-error.log',
      out_file: '/home/dev/.pm2/logs/openrx-backend-out.log',
      merge_logs: true,
    },
  ],
};
