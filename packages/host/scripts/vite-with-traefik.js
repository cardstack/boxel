/**
 * Shared launcher for `vite` (dev) and `vite preview` (built) that supports
 * dynamic port allocation in environment mode. When BOXEL_ENVIRONMENT is set,
 * picks a free port, starts vite bound to all interfaces (so the Traefik
 * container can reach it via host.docker.internal), then registers with
 * Traefik so that `host.<slug>.localhost` routes here. When BOXEL_ENVIRONMENT
 * is not set, runs vite on the default port with default host.
 */

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

function runVite({ subcommand, port, allHosts, extraEnv, nodeMemory }) {
  const args = ['vite'];
  if (subcommand) args.push(subcommand);
  args.push('--port', String(port), '--strictPort');
  if (allHosts) {
    // Bind to all interfaces so Traefik (running in Docker) can reach
    // vite via host.docker.internal:<port>. Vite's default is 127.0.0.1
    // only, which is unreachable from inside the container.
    args.push('--host');
  }
  const env = { ...process.env, ...(extraEnv || {}) };
  if (nodeMemory) {
    env.NODE_OPTIONS = process.env.NODE_OPTIONS || '--max-old-space-size=8192';
  }
  const child = spawn('npx', args, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    shell: true,
    env,
  });
  child.on('exit', (code) => process.exit(code || 0));
  return child;
}

function startWithTraefik({ subcommand, defaultPort, label, nodeMemory }) {
  const BOXEL_ENVIRONMENT = process.env.BOXEL_ENVIRONMENT;

  if (!BOXEL_ENVIRONMENT) {
    runVite({ subcommand, port: defaultPort, allHosts: false, nodeMemory });
    return;
  }

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
        `[environment-mode] Starting ${label} on dynamic port ${port}`,
      );
      console.log(
        `[environment-mode] Will be accessible at http://${hostname}`,
      );

      runVite({
        subcommand,
        port,
        allHosts: true,
        extraEnv: {
          // Read by vite.config.mjs to populate server.allowedHosts /
          // preview.allowedHosts (and server.hmr.host for dev) so requests
          // routed through Traefik aren't rejected by Vite's host check.
          BOXEL_HOST_HOSTNAME: hostname,
        },
        nodeMemory,
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

module.exports = { startWithTraefik };
