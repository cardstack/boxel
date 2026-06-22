'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const DEFAULT_CARD_RENDER_TIMEOUT_MS = 30_000;
const DEFAULT_CARD_SIZE_LIMIT_BYTES = 512 * 1024; // 512KB
const DEFAULT_FILE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024; // 5MB

let sqlSchema = fs.readFileSync(getLatestSchemaFile(), 'utf8');

// Classic ember-cli injected APP.version automatically; the Vite/Embroider
// build does not, so we populate it here from package.json + the short git
// SHA (matching ember-cli's `0.0.0+abcdef12` shape) so the submode-switcher
// tooltip and any other consumer keeps working.
function computeAppVersion() {
  let pkgVersion = '0.0.0';
  try {
    pkgVersion = require('../package.json').version || pkgVersion;
  } catch (_) {
    // fall through with default
  }
  let sha = '';
  try {
    sha = execSync('git rev-parse --short=8 HEAD', {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch (_) {
    // git unavailable (e.g. docker build without .git); fall back to pkg only
  }
  return sha ? `${pkgVersion}+${sha}` : pkgVersion;
}
const APP_VERSION = computeAppVersion();

// Environment-mode: when BOXEL_ENVIRONMENT is set, derive default URLs from Traefik hostnames.
// ENV_SLUG is set by mise's env-vars.sh; fall back to computing it for non-mise contexts.
function getEnvSlug() {
  if (process.env.ENV_SLUG) return process.env.ENV_SLUG;
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
    // Local realm-server speaks HTTPS+HTTP/2 in every environment
    // (dev + Host Tests + Live Tests). The dev cert is mandatory (see
    // `infra:ensure-dev-cert`); there is no HTTP fallback. Test mode
    // still uses these defaults — the host's in-memory test-realm
    // registry intercepts `http://test-realm/...` fetches before they
    // hit the wire, while fetches to the realm-server's real wire URL
    // need to go to https to match the actual listener. See the
    // repo-root README "Local HTTPS dev access".
    return {
      realmServerURL: 'https://localhost:4201/',
      realmHost: 'localhost:4201',
      iconsURL: 'http://localhost:4206',
      matrixURL: 'http://localhost:8008',
      baseRealmURL: 'https://localhost:4201/base/',
      catalogRealmURL: 'https://localhost:4201/catalog/',
      skillsRealmURL: 'https://localhost:4201/skills/',
      openRouterRealmURL: 'https://localhost:4201/openrouter/',
      testRealmURL: 'https://localhost:4202/test/',
    };
  }
  let slug = getEnvSlug();
  let realmHost = `realm-server.${slug}.localhost`;
  // Env-mode services sit behind Traefik, which terminates TLS on :443
  // with the mkcert leaf and 308-redirects :80 to https. The host page
  // is loaded over https, so the realm URLs the host bundle fetches
  // must match — http URLs trigger mixed-content blocking, and the
  // CORS preflight refuses to follow Traefik's http→https redirect
  // ("Redirect is not allowed for a preflight request"). Mirrors the
  // standard-mode `https://localhost:4201` defaults above.
  return {
    realmServerURL: `https://${realmHost}/`,
    realmHost,
    iconsURL: `https://icons.${slug}.localhost`,
    matrixURL: `https://matrix.${slug}.localhost`,
    baseRealmURL: `https://${realmHost}/base/`,
    catalogRealmURL: `https://${realmHost}/catalog/`,
    skillsRealmURL: `https://${realmHost}/skills/`,
    openRouterRealmURL: `https://${realmHost}/openrouter/`,
    // mise-tasks/services/test-realms registers the live test realm at
    // `https://realm-test.${slug}.localhost/test/` in env mode (the
    // counterpart to standard mode's `https://localhost:4202/test/`).
    testRealmURL: `https://realm-test.${slug}.localhost/test/`,
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
      version: APP_VERSION,
    },
    'ember-cli-mirage': {
      enabled: false,
    },
    logLevels:
      process.env.LOG_LEVELS || '*=info,matrix=info,realm:events=debug',
    // In environment mode, use computed Traefik hostname (not env var,
    // which may be stale from mise's shell-activation cache in standard
    // mode and would otherwise force an http:// matrix URL onto an
    // https:// host page).
    matrixURL: process.env.BOXEL_ENVIRONMENT
      ? defaults.matrixURL
      : process.env.MATRIX_URL || defaults.matrixURL,
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
    // In environment mode, use computed Traefik hostname (not env var, which
    // may be stale from mise's shell-activation cache in standard mode).
    iconsURL: process.env.BOXEL_ENVIRONMENT
      ? defaults.iconsURL
      : process.env.ICONS_URL || defaults.iconsURL,
    publishedRealmBoxelSpaceDomain:
      process.env.PUBLISHED_REALM_BOXEL_SPACE_DOMAIN || defaults.realmHost,
    publishedRealmBoxelSiteDomain:
      process.env.PUBLISHED_REALM_BOXEL_SITE_DOMAIN || defaults.realmHost,

    // the fields below may be rewritten by the realm server
    hostsOwnAssets: true,
    // CS-10055: realm-server injects per-request when the request is for
    // a realm whose config card has hostRoutingRules; empty otherwise.
    hostRoutingMap: [],
    realmServerURL: process.env.REALM_SERVER_DOMAIN || defaults.realmServerURL,
    resolvedBaseRealmURL:
      process.env.RESOLVED_BASE_REALM_URL || defaults.baseRealmURL,
    resolvedCatalogRealmURL: skipCatalog
      ? undefined
      : process.env.RESOLVED_CATALOG_REALM_URL || defaults.catalogRealmURL,
    resolvedSkillsRealmURL:
      process.env.RESOLVED_SKILLS_REALM_URL || defaults.skillsRealmURL,
    resolvedOpenRouterRealmURL:
      process.env.RESOLVED_OPENROUTER_REALM_URL || defaults.openRouterRealmURL,
    // The live test realm-server's /test/ realm — used by host tests
    // that load source modules from it via
    // `tests/helpers#testModuleRealm`. Derived from BOXEL_ENVIRONMENT via
    // `defaults.testRealmURL` above (localhost:4202 in standard mode,
    // realm-test.<slug>.localhost in env mode). Explicit
    // `REALM_TEST_URL` overrides take precedence for non-CI consumers
    // that want a custom test realm endpoint. The override accepts
    // either a base host URL (which gets `/test/` appended) or a value
    // that already names the `/test` realm — without the latter case
    // a path like `https://my-host/test/` would become
    // `https://my-host/test/test/`.
    resolvedTestRealmURL: (() => {
      if (!process.env.REALM_TEST_URL) return defaults.testRealmURL;
      let normalized = process.env.REALM_TEST_URL.replace(/\/$/, '');
      return normalized.endsWith('/test')
        ? `${normalized}/`
        : `${normalized}/test/`;
    })(),
    featureFlags: {
      // True locally so `pnpm start` shows the Sign in with Google button by
      // default; staging/prod stays false until CS-11645 lands the staging
      // Synapse OIDC config + flips this on via the deployed env var.
      GOOGLE_AUTH_ENABLED: process.env.GOOGLE_AUTH_ENABLED
        ? process.env.GOOGLE_AUTH_ENABLED === 'true'
        : environment === 'development',
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
    ENV.featureFlags = {};

    // Catalog realms are not available in test environment
    ENV.resolvedCatalogRealmURL = undefined;
    ENV.defaultSystemCardId = 'http://test-realm/test/SystemCard/default';
    ENV.defaultFieldSpecId = 'http://test-realm/test/fields/field';
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
    ENV.defaultFieldSpecId = new URL(
      'Spec/fields/field',
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
  // Only timestamped migration files — ignores non-migration entries in the dir
  // such as `package.json` (pins the dir to type:commonjs) and `.eslintrc.js`.
  let lastMigration = migrations
    .filter((f) => /^\d+_/.test(f))
    .sort()
    .pop();
  const schemaDir = path.join(__dirname, 'schema');
  let files = fs.readdirSync(schemaDir);
  let latestSchemaFile = files
    .filter((f) => /^\d+_schema\.sql$/.test(f))
    .sort()
    .pop();
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
