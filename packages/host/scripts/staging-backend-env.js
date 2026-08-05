const fs = require('fs');
const os = require('os');
const path = require('path');

const stagingEnvPath = path.join(__dirname, '..', 'config', 'staging.env');

function parseEnvFile(source) {
  let values = {};
  for (let rawLine of source.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    let separator = line.indexOf('=');
    if (separator === -1) {
      throw new Error(`Invalid staging env line: ${rawLine}`);
    }
    let key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    values[key] = value;
  }
  return values;
}

function applyStagingBackendEnv() {
  let values = parseEnvFile(fs.readFileSync(stagingEnvPath, 'utf8'));
  let requestedHostPort = process.env.HOST_PORT;

  // This is deliberately host-only standard mode. BOXEL_ENVIRONMENT opts into
  // the local Traefik/service stack and therefore Docker; it must not leak in
  // from an activated mise shell when this command promises staging services.
  delete process.env.BOXEL_ENVIRONMENT;
  delete process.env.ENV_SLUG;

  for (let [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
  if (requestedHostPort) {
    process.env.HOST_PORT = requestedHostPort;
  }

  // Vite's classic-Ember compatibility layer reads its config meta from the
  // shared node_modules/.embroider/content-for.json. A host test build can
  // rewrite that file with local-service URLs while this staging-backed dev
  // server is still running. Mark this process so vite.config.mjs can replace
  // the app config meta on every HTML response instead of trusting that shared
  // build artifact. Tests keep their own test environment config.
  process.env.BOXEL_STAGING_BACKEND = 'true';

  let certDirectory = path.join(
    os.homedir(),
    '.local',
    'share',
    'boxel',
    'dev-certs',
  );
  let defaultCertFile = path.join(certDirectory, 'localhost.pem');
  let defaultKeyFile = path.join(certDirectory, 'localhost-key.pem');
  if (
    !process.env.REALM_SERVER_TLS_CERT_FILE &&
    fs.existsSync(defaultCertFile)
  ) {
    process.env.REALM_SERVER_TLS_CERT_FILE = defaultCertFile;
  }
  if (!process.env.REALM_SERVER_TLS_KEY_FILE && fs.existsSync(defaultKeyFile)) {
    process.env.REALM_SERVER_TLS_KEY_FILE = defaultKeyFile;
  }
  if (
    !process.env.REALM_SERVER_TLS_CERT_FILE ||
    !process.env.REALM_SERVER_TLS_KEY_FILE
  ) {
    throw new Error(
      'The Boxel localhost TLS certificate is missing. Run `mise run infra:ensure-dev-cert` once.',
    );
  }

  // The iframe renderer uses the same Vite process through a second loopback
  // origin. The mkcert localhost leaf includes 127.0.0.1, so this remains
  // process-isolated from the host origin without a second server or Docker.
  let hostPort = process.env.HOST_PORT || '4200';
  process.env.REALM_SANDBOX_IFRAME_ORIGIN = `https://127.0.0.1:${hostPort}`;

  console.log(`[staging-backend] Local host UI: https://localhost:${hostPort}`);
  console.log(
    `[staging-backend] Realm API: ${process.env.REALM_SERVER_DOMAIN}`,
  );
  console.log(`[staging-backend] Matrix: ${process.env.MATRIX_URL}`);
  console.log(
    `[staging-backend] Iframe renderer: ${process.env.REALM_SANDBOX_IFRAME_ORIGIN}`,
  );
  console.log(
    `[staging-backend] TLS certificate: ${process.env.REALM_SERVER_TLS_CERT_FILE}`,
  );
  console.log('[staging-backend] Docker/local service stack is not used');
}

module.exports = { applyStagingBackendEnv, parseEnvFile };
