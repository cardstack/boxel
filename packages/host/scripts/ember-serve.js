#!/usr/bin/env node

/**
 * Wrapper around `ember serve` that supports dynamic port allocation in branch mode.
 * When BOXEL_BRANCH is set, picks a free port, passes --port to ember serve,
 * then registers with Traefik so that `host.<branch>.lvh.me` routes here.
 * When BOXEL_BRANCH is not set, behaves identically to the old start command.
 */

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const fs = require('fs');

const BOXEL_BRANCH = process.env.BOXEL_BRANCH;

function sanitizeSlug(raw) {
  return raw
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function registerWithTraefik(slug, hostname, port) {
  const dynamicDir = path.resolve(
    __dirname, '..', '..', '..', 'traefik', 'dynamic',
  );
  const configPath = path.join(dynamicDir, `${slug}.yml`);
  const routerKey = `host-${slug}`;

  let yaml;
  try {
    const realmServerDir = path.resolve(__dirname, '..', '..', 'realm-server');
    yaml = require(require.resolve('yaml', { paths: [realmServerDir] }));
  } catch {
    // yaml not resolvable — write minimal YAML by hand
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
    return;
  }

  let config = {};
  try {
    config = yaml.parse(fs.readFileSync(configPath, 'utf-8')) || {};
  } catch {
    // file may not exist yet
  }
  if (!config.http) config.http = {};
  if (!config.http.routers) config.http.routers = {};
  if (!config.http.services) config.http.services = {};

  config.http.routers[routerKey] = {
    rule: `Host(\`${hostname}\`)`,
    service: routerKey,
    entryPoints: ['web'],
  };
  config.http.services[routerKey] = {
    loadBalancer: {
      servers: [{ url: `http://host.docker.internal:${port}` }],
    },
  };

  const tmpPath = configPath + '.tmp';
  fs.writeFileSync(tmpPath, yaml.stringify(config), 'utf-8');
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

if (!BOXEL_BRANCH) {
  // Legacy mode: default ember serve on port 4200
  startEmber(4200);
} else {
  const slug = sanitizeSlug(BOXEL_BRANCH);
  const hostname = `host.${slug}.lvh.me`;

  // Find a free port
  const srv = net.createServer();
  srv.listen(0, () => {
    const port = srv.address().port;
    srv.close(() => {
      console.log(`[branch-mode] Starting ember serve on dynamic port ${port}`);
      console.log(`[branch-mode] Will be accessible at http://${hostname}`);

      startEmber(port);

      try {
        registerWithTraefik(slug, hostname, port);
        console.log(
          `[branch-mode] Registered host at ${hostname} -> localhost:${port}`,
        );
      } catch (e) {
        console.error('[branch-mode] Failed to register with Traefik:', e.message);
      }
    });
  });
}
