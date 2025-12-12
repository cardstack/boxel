'use strict';

const fs = require('fs');
const path = require('path');
const DEFAULT_CARD_RENDER_TIMEOUT_MS = 30_000;

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
    logLevels:
      process.env.LOG_LEVELS || '*=info,matrix=info,realm:events=debug',
    matrixURL: process.env.MATRIX_URL || 'http://localhost:8008',
    matrixServerName: process.env.MATRIX_SERVER_NAME || 'localhost',
    autoSaveDelayMs: 500,
    monacoDebounceMs: 500,
    monacoCursorDebounceMs: 200,
    serverEchoDebounceMs: 5000,
    loginMessageTimeoutMs: 1000,
    minSaveTaskDurationMs: 1000,
    aiAssistantToastTimeoutMs: 3000,
    cardRenderTimeout: Number(
      process.env.RENDER_TIMEOUT_MS ?? DEFAULT_CARD_RENDER_TIMEOUT_MS,
    ),
    iconsURL: process.env.ICONS_URL || 'https://boxel-icons.boxel.ai',
    publishedRealmBoxelSpaceDomain:
      process.env.PUBLISHED_REALM_BOXEL_SPACE_DOMAIN || 'localhost:4201',
    publishedRealmBoxelSiteDomain:
      process.env.PUBLISHED_REALM_BOXEL_SITE_DOMAIN || 'localhost:4201',

    // the fields below may be rewritten by the realm server
    hostsOwnAssets: true,
    realmServerURL: process.env.REALM_SERVER_DOMAIN || 'http://localhost:4201/',
    resolvedBaseRealmURL:
      process.env.RESOLVED_BASE_REALM_URL || 'http://localhost:4201/base/',
    resolvedCatalogRealmURL:
      process.env.RESOLVED_CATALOG_REALM_URL ||
      'http://localhost:4201/catalog/',
    resolvedSkillsRealmURL:
      process.env.RESOLVED_SKILLS_REALM_URL || 'http://localhost:4201/skills/',
    featureFlags: {
      SHOW_ASK_AI: process.env.SHOW_ASK_AI === 'true' || false,
    },
  };

  if (environment === 'development') {
    // ENV.APP.LOG_RESOLVER = true;
    // ENV.APP.LOG_ACTIVE_GENERATION = true;
    // ENV.APP.LOG_TRANSITIONS = true;
    // ENV.APP.LOG_TRANSITIONS_INTERNAL = true;
    // ENV.APP.LOG_VIEW_LOOKUPS = true;
    ENV.defaultSystemCardId =
      process.env.DEFAULT_SYSTEM_CARD_ID ??
      'http://localhost:4201/catalog/SystemCard/default';
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
    ENV.realmServerURL = 'http://test-realm';
    ENV.serverEchoDebounceMs = 0;
    ENV.loginMessageTimeoutMs = 0;
    ENV.minSaveTaskDurationMs = 0;
    ENV.aiAssistantToastTimeoutMs = 0;
    ENV.sqlSchema = sqlSchema;
    ENV.featureFlags = {
      SHOW_ASK_AI: true,
    };

    ENV.defaultSystemCardId =
      process.env.DEFAULT_SYSTEM_CARD_ID ??
      'http://test-realm/test/SystemCard/default';
  }

  if (environment === 'staging') {
    ENV.defaultSystemCardId =
      process.env.DEFAULT_SYSTEM_CARD_ID ??
      'https://realms-staging.stack.cards/catalog/SystemCard/default';
  }

  if (environment === 'production') {
    // here you can enable a production-specific feature
    ENV.logLevels = '*=warn';
    ENV.defaultSystemCardId =
      process.env.DEFAULT_SYSTEM_CARD_ID ??
      'https://app.boxel.ai/catalog/SystemCard/default';
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
