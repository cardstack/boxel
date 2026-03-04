/**
 * Wrapper around `serve` that supports dynamic port allocation in environment mode.
 * When BOXEL_ENVIRONMENT is set, picks a free port, starts `serve`, then registers
 * with Traefik so that `host.<branch>.localhost` routes to this instance.
 * When BOXEL_ENVIRONMENT is not set, behaves identically to the old serve:dist command.
 */

const { spawn } = require('child_process');
const path = require('path');

const BOXEL_ENVIRONMENT = process.env.BOXEL_ENVIRONMENT;

function runServe(port) {
  const child = spawn(
    'npx',
    [
      'serve',
      '--config',
      '../tests/serve.json',
      '--single',
      '--cors',
      '--no-request-logging',
      '--no-etag',
      '--listen',
      String(port),
      'dist',
    ],
    { stdio: 'inherit', cwd: path.join(__dirname, '..'), shell: true },
  );
  child.on('exit', (code) => process.exit(code || 0));
  return child;
}

function sanitizeSlug(raw) {
  return raw
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function registerWithTraefik(slug, hostname, port) {
  const fs = require('fs');
  const dynamicDir = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'traefik',
    'dynamic',
  );
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

if (!BOXEL_ENVIRONMENT) {
  // Legacy mode: hardcoded port 4200
  runServe(4200);
} else {
  // Environment mode: dynamic port + Traefik registration
  const { ensureTraefik } = require('./ensure-traefik');
  ensureTraefik();

  const net = require('net');

  const slug = sanitizeSlug(BOXEL_ENVIRONMENT);
  const hostname = `host.${slug}.localhost`;

  // Find a free port
  const srv = net.createServer();
  srv.listen(0, () => {
    const port = srv.address().port;
    srv.close(() => {
      console.log(
        `[environment-mode] Starting host app on dynamic port ${port}`,
      );
      console.log(
        `[environment-mode] Will be accessible at http://${hostname}`,
      );

      runServe(port);

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
