/**
 * Wrapper around `vite` (dev server) that supports dynamic port allocation in
 * environment mode. When BOXEL_ENVIRONMENT is set, picks a free port, passes
 * --port to vite, then registers with Traefik so that `host.<branch>.localhost`
 * routes here. When BOXEL_ENVIRONMENT is not set, serves on port 4200 to match
 * the readiness URL the dev-all mise task polls.
 */

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const BOXEL_ENVIRONMENT = process.env.BOXEL_ENVIRONMENT;

function startVite(port) {
  const child = spawn(
    'npx',
    ['vite', '--port', String(port), '--strictPort'],
    { stdio: 'inherit', cwd: path.join(__dirname, '..'), shell: true },
  );
  child.on('exit', (code) => process.exit(code || 0));
  return child;
}

if (!BOXEL_ENVIRONMENT) {
  startVite(4200);
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

      startVite(port);

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
