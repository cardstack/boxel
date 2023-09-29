'use strict';

module.exports = function (environment) {
  const ENV = {
    modulePrefix: 'test-app',
    environment,
    rootURL: '/',
    locationType: 'history',
  };
  return ENV;
};
