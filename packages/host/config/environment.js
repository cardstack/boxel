'use strict';

const fs = require('fs');
const path = require('path');
const DEFAULT_CARD_RENDER_TIMEOUT_MS = 30_000;
const DEFAULT_CARD_SIZE_LIMIT_BYTES = 512 * 1024; // 512KB
const DEFAULT_FILE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024; // 5MB

let sqlSchema = fs.readFileSync(getLatestSchemaFile(), 'utf8');

// Environment-mode: when BOXEL_ENVIRONMENT is set, derive default URLs from Traefik hostnames
function environmentSlug() {
  let raw = process.env.BOXEL_ENVIRONMENT || '';
  return raw
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function environmentDefaults() {
  if (!process.env.BOXEL_ENVIRONMENT) {
    return {
      realmServerURL: 'http://localhost:4201/',
      realmHost: 'localhost:4201',
      iconsURL: 'http://localhost:4206',
      baseRealmURL: 'http://localhost:4201/base/',
      catalogRealmURL: 'http://localhost:4201/catalog/',
      skillsRealmURL: 'http://localhost:4201/skills/',
    };
  }
  let slug = environmentSlug();
  let realmHost = `realm-server.${slug}.localhost`;
  return {
    realmServerURL: `http://${realmHost}/`,
    realmHost,
    iconsURL: `http://icons.${slug}.localhost`,
    baseRealmURL: `http://${realmHost}/base/`,
    catalogRealmURL: `http://${realmHost}/catalog/`,
    skillsRealmURL: `http://${realmHost}/skills/`,
  };
}

module.exports = function (environment) {
  let defaults = environmentDefaults();
  let skipCatalog = process.env.SKIP_CATALOG === 'true';

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
    cardRenderTimeout: Number(
      process.env.RENDER_TIMEOUT_MS ?? DEFAULT_CARD_RENDER_TIMEOUT_MS,
    ),
    cardSizeLimitBytes: Number(
      process.env.CARD_SIZE_LIMIT_BYTES ?? DEFAULT_CARD_SIZE_LIMIT_BYTES,
    ),
    fileSizeLimitBytes: Number(
      process.env.FILE_SIZE_LIMIT_BYTES ?? DEFAULT_FILE_SIZE_LIMIT_BYTES,
    ),
    iconsURL: process.env.ICONS_URL || defaults.iconsURL,
    publishedRealmBoxelSpaceDomain:
      process.env.PUBLISHED_REALM_BOXEL_SPACE_DOMAIN || defaults.realmHost,
    publishedRealmBoxelSiteDomain:
      process.env.PUBLISHED_REALM_BOXEL_SITE_DOMAIN || defaults.realmHost,

    // the fields below may be rewritten by the realm server
    hostsOwnAssets: true,
    realmServerURL: process.env.REALM_SERVER_DOMAIN || defaults.realmServerURL,
    resolvedBaseRealmURL:
      process.env.RESOLVED_BASE_REALM_URL || defaults.baseRealmURL,
    resolvedCatalogRealmURL: skipCatalog
      ? undefined
      : process.env.RESOLVED_CATALOG_REALM_URL || defaults.catalogRealmURL,
    resolvedSkillsRealmURL:
      process.env.RESOLVED_SKILLS_REALM_URL || defaults.skillsRealmURL,
    featureFlags: {
      SHOW_ASK_AI: process.env.SHOW_ASK_AI === 'true' || false,
    },
  };

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
    ENV.sqlSchema = sqlSchema;
    ENV.featureFlags = {
      SHOW_ASK_AI: true,
    };

    // Catalog realm is not available in test environment
    ENV.resolvedCatalogRealmURL = undefined;
    ENV.defaultSystemCardId = 'http://test-realm/test/SystemCard/default';
  }

  if (environment === 'production') {
    // here you can enable a production-specific feature
    ENV.logLevels = '*=warn';
  }

  if (ENV.resolvedCatalogRealmURL) {
    ENV.defaultSystemCardId = new URL(
      'SystemCard/default',
      withTrailingSlash(ENV.resolvedCatalogRealmURL),
    ).href;
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

function withTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}
