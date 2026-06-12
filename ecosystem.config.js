module.exports = {
  apps: [
    {
      name: 'pedidopro',
      script: 'backend/dist/server.js',
      instances: 1,
      watch: false,
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
