'use strict';

module.exports = function (environment) {
  let ENV = {
    modulePrefix: '@cardstack/host',
    environment,
    rootURL: '/',
    locationType: 'history',
    EmberENV: {
      FEATURES: {
        // Here you can enable experimental features on an ember canary build
        // e.g. EMBER_NATIVE_DECORATOR_SUPPORT: true
      },
      EXTEND_PROTOTYPES: {
        // Prevent Ember Data from overriding Date.parse.
        Date: false,
      },
    },

    APP: {
      // Here you can pass flags/options to your application instance
      // when it is created
    },
    'ember-cli-mirage': {
      enabled: false,
    },
    // This should be provided as an *unresolved* URL
    ownRealmURL: process.env.OWN_REALM_URL || 'http://localhost:4200/',
    servedByRealm: false,
    localRealmEnabled:
      environment === 'test'
        ? true
        : process.env.LOCAL_REALM_ENABLED === 'true',
    resolvedBaseRealmURL:
      process.env.RESOLVED_BASE_REALM_URL || 'http://localhost:4201/base/',
  };

  if (environment === 'development') {
    // ENV.APP.LOG_RESOLVER = true;
    // ENV.APP.LOG_ACTIVE_GENERATION = true;
    // ENV.APP.LOG_TRANSITIONS = true;
    // ENV.APP.LOG_TRANSITIONS_INTERNAL = true;
    // ENV.APP.LOG_VIEW_LOOKUPS = true;
    ENV.logLevel = 'debug';
    ENV.currentRunLogLevel = 'error';
  }

  if (environment === 'test') {
    // Testem prefers this...
    ENV.locationType = 'none';

    // keep test console output quieter
    ENV.APP.LOG_ACTIVE_GENERATION = false;
    ENV.APP.LOG_VIEW_LOOKUPS = false;

    ENV.APP.rootElement = '#ember-testing';
    ENV.APP.autoboot = false;
  }

  if (environment === 'production') {
    // here you can enable a production-specific feature
    ENV.logLevel = 'warn';
    ENV.currentRunLogLevel = 'info';
  }

  return ENV;
};
