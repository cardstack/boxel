/* eslint-env node */
'use strict';

// Without this, CORS errors show when using other ports in development, especially Matrix tests (4205)

module.exports = {
  name: 'development-cors-middleware',

  serverMiddleware({ app }) {
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, OPTIONS',
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Boxel-Building-Index, X-Boxel-Cache',
      );
      next();
    });
  },
};
