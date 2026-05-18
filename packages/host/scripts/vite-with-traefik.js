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
  // Detach vite's stdin from the parent TTY. Vite's `bindCLIShortcuts`
  // opens a readline.createInterface({ input: process.stdin }) without an
  // 'error' handler whenever stdin is a TTY. When the user hits Ctrl-C in
  // a `mise dev` / `mise dev-all` session, the TTY tears down underneath
  // that readline and Node emits an unhandled 'error' event (read EIO),
  // which crashes vite with a noisy stack trace just before shutdown.
  // Setting stdin to 'ignore' makes process.stdin.isTTY false, so the
  // shortcuts feature is skipped — we don't use it from `pnpm start`
  // anyway since stdin is piped through pnpm/run-p wrappers that swallow
  // keypresses before they reach vite.
  // No `shell: true`: with a shell wrapper, `child` would be the intermediate
  // `sh -c` process, and `child.kill(signal)` would only signal the shell —
  // leaving the vite grandchild orphaned and still bound to port 4200 if a
  // parent process manager signals just this wrapper instead of sweeping the
  // whole process group. Spawning npx directly makes `child` the npx process,
  // which forwards signals to its vite child.
  const child = spawn('npx', args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    cwd: path.join(__dirname, '..'),
    env,
  });

  // Forward SIGTERM/SIGINT from the orchestrator to vite and translate the
  // signal-induced exit into a clean 0. Without this, `pnpm start` exits
  // non-zero on Ctrl-C and pnpm prints `[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL]`.
  const forward = (signal) => {
    if (!child.killed) {
      try {
        child.kill(signal);
      } catch (_) {
        /* child already gone */
      }
    }
  };
  process.on('SIGTERM', () => forward('SIGTERM'));
  process.on('SIGINT', () => forward('SIGINT'));

  child.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGINT') {
      process.exit(0);
    }
    if (signal) {
      // vite died from another signal (e.g. SIGKILL, SIGSEGV, SIGABRT) —
      // propagate that as a non-zero exit so pnpm and the orchestrator see
      // the crash instead of treating it as a clean shutdown. 128 + signum
      // is the POSIX convention shells use for signal-induced exits.
      const signum = require('os').constants.signals[signal] || 0;
      process.exit(128 + signum);
    }
    process.exit(code || 0);
  });
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
