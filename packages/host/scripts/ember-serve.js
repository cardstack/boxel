/**
 * Wrapper around `ember serve` that supports dynamic port allocation in environment mode.
 * When BOXEL_ENVIRONMENT is set, picks a free port, passes --port to ember serve,
 * then registers with Traefik so that `host.<branch>.localhost` routes here.
 * When BOXEL_ENVIRONMENT is not set, behaves identically to the old start command.
 */

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const fs = require('fs');

const BOXEL_ENVIRONMENT = process.env.BOXEL_ENVIRONMENT;

function sanitizeSlug(raw) {
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

function startEmber(port) {
  const args = ['serve', '--port', String(port)];
  const child = spawn('ember', args, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    shell: true,
    env: {
      ...process.env,
      NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=8192',
    },
  });
  child.on('exit', (code) => process.exit(code || 0));
  return child;
}

if (!BOXEL_ENVIRONMENT) {
  // Legacy mode: default ember serve on port 4200
  startEmber(4200);
} else {
  const { ensureTraefik } = require('./ensure-traefik');
  ensureTraefik();

  const slug = sanitizeSlug(BOXEL_ENVIRONMENT);
  const hostname = `host.${slug}.localhost`;

  // Point the client at the per-environment Synapse via Traefik
  if (!process.env.MATRIX_URL) {
    process.env.MATRIX_URL = `http://matrix.${slug}.localhost`;
  }

  // Find a free port
  const srv = net.createServer();
  srv.listen(0, () => {
    const port = srv.address().port;
    srv.close(() => {
      console.log(
        `[environment-mode] Starting ember serve on dynamic port ${port}`,
      );
      console.log(
        `[environment-mode] Will be accessible at http://${hostname}`,
      );

      startEmber(port);

      try {
        registerWithTraefik(slug, hostname, port);
        console.log(
          `[environment-mode] Registered host at ${hostname} -> localhost:${port}`,
        );
      } catch (e) {
        console.error(
          '[environment-mode] Failed to register with Traefik:',
          e.message,
        );
      }
    });
  });
}
