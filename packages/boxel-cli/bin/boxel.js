#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

// Auto-trust the user's mkcert dev CA before any TLS handshake fires.
// Local `mise run dev-all` serves the realm-server over HTTPS with an
// mkcert-issued cert. Node's TLS layer doesn't consult the system
// keychain (where `mise run infra:trust-dev-cert` installs mkcert's
// CA) — it has its own bundled CA list and an env-var escape hatch
// (`NODE_EXTRA_CA_CERTS`). Setting that var inside an already-running
// node process is too late (Node reads it once at startup), so we
// re-exec with it set. Production realm-servers use real CA-signed
// certs and are unaffected by this — adding the user's mkcert CA
// doesn't change trust for anything else.
function maybeReExecWithMkcertCA() {
  if (process.env.NODE_EXTRA_CA_CERTS) return;
  let mkcertCA = mkcertRootCAPath();
  if (!mkcertCA || !fs.existsSync(mkcertCA)) return;

  let env = Object.assign({}, process.env, { NODE_EXTRA_CA_CERTS: mkcertCA });
  let { spawnSync } = require('child_process');
  let result = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: env,
  });
  process.exit(result.status == null ? 0 : result.status);
}

function mkcertRootCAPath() {
  let home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return undefined;
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'mkcert', 'rootCA.pem');
  }
  if (process.platform === 'linux') {
    // mkcert's CAROOT on linux. Respect XDG_DATA_HOME, fall back to
    // ~/.local/share/mkcert.
    let xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    return path.join(xdg, 'mkcert', 'rootCA.pem');
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'mkcert', 'rootCA.pem');
  }
  return undefined;
}

maybeReExecWithMkcertCA();

// Use the built dist version if available, otherwise fall back to ts-node
const distEntry = path.resolve(__dirname, '..', 'dist', 'index.js');

if (fs.existsSync(distEntry)) {
  require(distEntry);
} else {
  // Development fallback: run from TypeScript source via ts-node
  require('ts-node').register({ transpileOnly: true });
  require('../src/index.ts');
}
