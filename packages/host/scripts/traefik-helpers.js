/**
 * Shared helpers for Traefik registration in environment mode.
 * Both ember-serve.js and serve-dist.js use these.
 */

const path = require('path');
const fs = require('fs');

function getEnvSlug() {
  // Prefer ENV_SLUG from mise's env-vars.sh; fall back to computing it
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

  const entry = [
    'http:',
    '  routers:',
    `    ${routerKey}:`,
    '      rule: "Host(`' + hostname + '`)"',
    `      service: ${routerKey}`,
    '      entryPoints:',
    '        - web',
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
