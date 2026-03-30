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

if (!BOXEL_ENVIRONMENT) {
  // Standard mode: hardcoded port 4200
  runServe(4200);
} else {
  const { ensureTraefik } = require('./ensure-traefik');
  const { getEnvSlug, registerWithTraefik } = require('./traefik-helpers');

  ensureTraefik();

  const net = require('net');

  const slug = getEnvSlug();
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
