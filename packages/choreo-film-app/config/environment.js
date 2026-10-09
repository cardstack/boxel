'use strict';

module.exports = function (environment) {
  const ENV = {
    modulePrefix: 'choreo-film-app',
    environment,
    // Nothing is addressed from the root: the app is served from wherever
    // its index.html is, and the films find their media through
    // app/lib/assets.ts.
    rootURL: '/',
    // One film per document, chosen by the page that mounts it, so the app
    // never reads or writes its URL.
    locationType: 'none',
    EmberENV: {
      EXTEND_PROTOTYPES: false,
      FEATURES: {},
    },
    APP: {},
  };

  if (environment === 'test') {
    ENV.APP.LOG_ACTIVE_GENERATION = false;
    ENV.APP.LOG_VIEW_LOOKUPS = false;
    ENV.APP.rootElement = '#ember-testing';
    ENV.APP.autoboot = false;
  }

  return ENV;
};
