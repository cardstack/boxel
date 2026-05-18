/**
 * Shared helpers for Traefik registration in environment mode.
 * Used by scripts/vite-with-traefik.js (which both vite-serve.js and
 * serve-dist.js delegate to).
 */

const path = require('path');
const fs = require('fs');

function getEnvSlug() {
  // Prefer ENV_SLUG from mise's env-vars.sh (canonical: scripts/env-slug.sh);
  // fall back to computing it for non-mise contexts.
  if (process.env.ENV_SLUG) return process.env.ENV_SLUG;
  const raw = process.env.BOXEL_ENVIRONMENT || '';
  return raw
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
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
}

module.exports = { getEnvSlug, getTraefikDynamicDir, registerWithTraefik };
