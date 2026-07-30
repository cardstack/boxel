'use strict';

// Consumed by the compat test pipeline (see ember-cli-build.js); the addon
// itself has no runtime environment config.
module.exports = function (environment) {
  const ENV = {
    modulePrefix: 'boxel-ui-tests',
    environment,
    rootURL: '/',
    locationType: 'history',
    APP: {},
  };
  if (environment === 'test') {
    ENV.locationType = 'none';
    ENV.APP.LOG_ACTIVE_GENERATION = false;
    ENV.APP.LOG_VIEW_LOOKUPS = false;
    ENV.APP.rootElement = '#ember-testing';
    ENV.APP.autoboot = false;
  }
  return ENV;
};
