'use strict';

const fs = require('fs');
const path = require('path');

let sqlSchema = fs.readFileSync(getLatestSchemaFile(), 'utf8');

module.exports = function (environment) {
  const ENV = {
    modulePrefix: '@cardstack/host',
    environment,
    rootURL: '/',
    locationType: 'history',
    EmberENV: {
      EXTEND_PROTOTYPES: false,
      FEATURES: {
        // Here you can enable experimental features on an ember canary build
        // e.g. EMBER_NATIVE_DECORATOR_SUPPORT: true
      },
    },

    APP: {
      // Here you can pass flags/options to your application instance
      // when it is created
    },
    'ember-cli-mirage': {
      enabled: false,
    },
    logLevels: process.env.LOG_LEVELS || '*=info,current-run=error,matrix=info',
    matrixURL: process.env.MATRIX_URL || 'http://localhost:8008',
    matrixServerName: process.env.MATRIX_SERVER_NAME || 'localhost',
    autoSaveDelayMs: 500,
    monacoDebounceMs: 500,
    monacoCursorDebounceMs: 200,
    serverEchoDebounceMs: 5000,
    loginMessageTimeoutMs: 1000,
    minSaveTaskDurationMs: 1000,
    iconsURL: process.env.ICONS_URL || 'https://boxel-icons.boxel.ai',

    // the fields below may be rewritten by the realm server
    hostsOwnAssets: true,
    resolvedBaseRealmURL:
      process.env.RESOLVED_BASE_REALM_URL || 'http://localhost:4201/base/',
    featureFlags: {},
  };

  if (environment === 'development') {
    // ENV.APP.LOG_RESOLVER = true;
    // ENV.APP.LOG_ACTIVE_GENERATION = true;
    // ENV.APP.LOG_TRANSITIONS = true;
    // ENV.APP.LOG_TRANSITIONS_INTERNAL = true;
    // ENV.APP.LOG_VIEW_LOOKUPS = true;
  }

  if (environment === 'test') {
    // Testem prefers this...
    ENV.locationType = 'none';

    // keep test console output quieter
    ENV.APP.LOG_ACTIVE_GENERATION = false;
    ENV.APP.LOG_VIEW_LOOKUPS = false;

    ENV.APP.rootElement = '#ember-testing';
    ENV.APP.autoboot = false;
    ENV.autoSaveDelayMs = 0;
    ENV.monacoDebounceMs = 0;
    ENV.monacoCursorDebounceMs = 0;
    ENV.serverEchoDebounceMs = 0;
    ENV.loginMessageTimeoutMs = 0;
    ENV.minSaveTaskDurationMs = 0;
    ENV.sqlSchema = sqlSchema;
    ENV.featureFlags = {};
  }

  if (environment === 'production') {
    // here you can enable a production-specific feature
    ENV.logLevels = '*=warn,current-run=error';
  }

  return ENV;
};

function getLatestSchemaFile() {
  const migrationsDir = path.resolve(
    path.join(__dirname, '..', '..', 'postgres', 'migrations'),
  );
  let migrations = fs.readdirSync(migrationsDir);
  let lastMigration = migrations
    .filter((f) => f !== '.eslintrc.js')
    .sort()
    .pop();
  const schemaDir = path.join(__dirname, 'schema');
  let files = fs.readdirSync(schemaDir);
  let latestSchemaFile = files.sort().pop();
  if (
    lastMigration.replace(/_.*/, '') !== latestSchemaFile.replace(/_.*/, '') &&
    ['development', 'test'].includes(process.env.EMBER_ENV)
  ) {
    throw new Error(
      `The sqlite schema file is out of date--please regenerate the sqlite schema file using \`pnpm make-schema\` in the postgres package`,
    );
  }
  return path.join(schemaDir, latestSchemaFile);
}
