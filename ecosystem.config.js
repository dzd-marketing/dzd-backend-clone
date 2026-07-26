module.exports = {
  apps: [{
    name: 'service-import-api',
    script: 'service-import-api.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: 'logs/service-import-error.log',
    out_file: 'logs/service-import-out.log',
    log_file: 'logs/service-import-combined.log',
    time: true
  }]
};
