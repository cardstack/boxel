/**
 * Shared helpers for Traefik registration in environment mode.
 * Used by scripts/vite-with-traefik.js (which both vite-serve.js and
 * serve-dist.js delegate to).
 */

const path = require('path');
const fs = require('fs');
const { sanitizeSlug } = require('../../../scripts/env-slug.js');

function getEnvSlug() {
  // Prefer ENV_SLUG from mise's env-vars.sh (already pre-sanitized by
  // scripts/env-slug.sh); fall back to sanitizing BOXEL_ENVIRONMENT
  // directly for non-mise contexts.
  if (process.env.ENV_SLUG) return process.env.ENV_SLUG;
  return sanitizeSlug(process.env.BOXEL_ENVIRONMENT);
}

function getTraefikDynamicDir() {
  try {
    const { execSync } = require('child_process');
    const mounted = execSync(
      `docker inspect boxel-traefik --format '{{range .Mounts}}{{if eq .Destination "/etc/traefik/dynamic"}}{{.Source}}{{end}}{{end}}'`,
      { encoding: 'utf-8' },
    ).trim();
    if (mounted) return mounted;
  } catch {
    // fall through
  }
  return path.resolve(__dirname, '..', '..', '..', 'traefik', 'dynamic');
}

function registerWithTraefik(slug, hostname, port) {
  const dynamicDir = getTraefikDynamicDir();
  const configPath = path.join(dynamicDir, `${slug}-host.yml`);
  const routerKey = `host-${slug}`;

  // Two routers: `websecure` terminates TLS at Traefik using the mkcert
  // leaf in traefik/dynamic/tls.yml; the sibling `-http` router on :80
  // 308-redirects to https so stale http:// links still work. Both
  // point at the same upstream — vite serves plain HTTP on the dynamic
  // internal port; Traefik is the only place TLS is terminated locally.
  const entry = [
    'http:',
    '  routers:',
    `    ${routerKey}:`,
    '      rule: "Host(`' + hostname + '`)"',
    `      service: ${routerKey}`,
    '      entryPoints:',
    '        - websecure',
    '      tls: {}',
    `    ${routerKey}-http:`,
    '      rule: "Host(`' + hostname + '`)"',
    '      entryPoints:',
    '        - web',
    '      middlewares:',
    `        - ${routerKey}-https-redirect`,
    `      service: ${routerKey}`,
    '  middlewares:',
    `    ${routerKey}-https-redirect:`,
    '      redirectScheme:',
    '        scheme: https',
    '        permanent: true',
    '  services:',
    `    ${routerKey}:`,
    '      loadBalancer:',
    '        servers:',
    `          - url: "http://host.docker.internal:${port}"`,
    '',
  ].join('\n');
  const tmpPath = configPath + '.tmp';
  fs.writeFileSync(tmpPath, entry, 'utf-8');
  fs.renameSync(tmpPath, configPath);
  kickTraefikIfNeeded();
}

// Bounce Traefik on macOS after a config write — see the matching
// helper in packages/realm-server/lib/dev-service-registry.ts for the
// rationale (Docker Desktop's bind mounts don't propagate inotify,
// and Traefik v3 file provider has no polling option).
function kickTraefikIfNeeded() {
  if (process.platform !== 'darwin') return;
  const { spawn } = require('child_process');
  const child = spawn('docker', ['restart', 'boxel-traefik'], {
    stdio: 'ignore',
    detached: true,
  });
  child.on('error', () => {
    // Docker not running, container missing, etc. — readiness probes
    // through Traefik will surface the underlying problem.
  });
  child.unref();
}

module.exports = { getEnvSlug, getTraefikDynamicDir, registerWithTraefik };
