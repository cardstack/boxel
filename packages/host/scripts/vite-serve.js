/**
 * Wrapper around `vite` (dev server) that supports dynamic port allocation in
 * environment mode. When BOXEL_ENVIRONMENT is set, picks a free port, starts
 * vite bound to all interfaces (so the Traefik container can reach it via
 * host.docker.internal), then registers with Traefik so that
 * `host.<slug>.localhost` routes here.
 *
 * When BOXEL_ENVIRONMENT is not set, runs vite on port 4200 with default host.
 *
 * Mirrors scripts/serve-dist.js, which does the same thing for `vite preview`.
 */

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const BOXEL_ENVIRONMENT = process.env.BOXEL_ENVIRONMENT;

function runVite({ port, allHosts, extraEnv }) {
  const args = ['vite', '--port', String(port), '--strictPort'];
  if (allHosts) {
    // Bind to all interfaces so Traefik (running in Docker) can reach the
    // dev server via host.docker.internal:<port>. Vite's default is to bind
    // to 127.0.0.1 only, which is unreachable from inside the container.
    args.push('--host');
  }
  const child = spawn('npx', args, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    shell: true,
    env: {
      ...process.env,
      NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=8192',
      ...(extraEnv || {}),
    },
  });
  child.on('exit', (code) => process.exit(code || 0));
  return child;
}

if (!BOXEL_ENVIRONMENT) {
  runVite({ port: 4200, allHosts: false });
} else {
  const { ensureTraefik } = require('./ensure-traefik');
  const { getEnvSlug, registerWithTraefik } = require('./traefik-helpers');

  ensureTraefik();

  const slug = getEnvSlug();
  const hostname = `host.${slug}.localhost`;

  // Point the client at the per-environment Synapse via Traefik
  if (!process.env.MATRIX_URL) {
    process.env.MATRIX_URL = `http://matrix.${slug}.localhost`;
  }

  const srv = net.createServer();
  srv.listen(0, () => {
    const port = srv.address().port;
    srv.close(() => {
      console.log(
        `[environment-mode] Starting vite dev server on dynamic port ${port}`,
      );
      console.log(
        `[environment-mode] Will be accessible at http://${hostname}`,
      );

      runVite({
        port,
        allHosts: true,
        extraEnv: {
          // Read by vite.config.mjs to populate server.allowedHosts and
          // server.hmr.host so requests routed through Traefik aren't
          // rejected and HMR client knows the public origin.
          BOXEL_HOST_HOSTNAME: hostname,
        },
      });

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
