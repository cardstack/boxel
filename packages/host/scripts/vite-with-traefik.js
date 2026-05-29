/**
 * Shared launcher for `vite` (dev) and `vite preview` (built) that supports
 * dynamic port allocation in environment mode. When BOXEL_ENVIRONMENT is set,
 * picks a free port, starts vite bound to all interfaces (so the Traefik
 * container can reach it via host.docker.internal), then registers with
 * Traefik so that `host.<slug>.localhost` routes here. When BOXEL_ENVIRONMENT
 * is not set, runs vite on the default port with default host.
 *
 * Local-HTTPS-dev path: when the mkcert leaf is present and vite is set
 * up to terminate TLS (see `vite.config.mjs`'s `devHttpsConfig`), vite
 * binds HTTPS on an internal port and we layer a tiny same-port
 * dispatcher in front. The dispatcher peeks the first byte of each
 * incoming connection: a TLS ClientHello (0x16) gets piped through to
 * vite untouched, anything else gets a 308 redirect to the https://
 * URL. Mirrors the realm-server dispatcher pattern. Dev UX: typing
 * `http://localhost:4200/foo` now lands on `https://localhost:4200/foo`
 * instead of failing with `ERR_CONNECTION_REFUSED`.
 */

require('./wtfnode-on-signal');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

// Embroider writes node_modules/.embroider/content-for.json once at boot
// with the URL-encoded `config/environment.js` ENV blob, then serves it
// to every `index.html` request. Two env-mode vites launched from the
// same packages/host share that file: whichever booted last wins, and
// `host.<slug-1>.localhost` ends up serving `<slug-2>`'s URLs even
// though Traefik is routing to the correct port. Use a small lockfile
// next to the cache to refuse the second startup with a clear message.
// One env per worktree is the supported pattern.
const ENV_MODE_LOCK_PATH = path.resolve(
  __dirname,
  '..',
  'node_modules',
  '.embroider',
  '.env-mode-lock',
);

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but is owned by someone else —
    // still "alive" for our purposes (the embroider cache fight applies
    // regardless of owner).
    return e.code === 'EPERM';
  }
}

function readEnvModeLock() {
  let content;
  try {
    content = fs.readFileSync(ENV_MODE_LOCK_PATH, 'utf-8');
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn(
        `[environment-mode] Could not read ${ENV_MODE_LOCK_PATH}: ${e.message}`,
      );
    }
    return null;
  }
  let [pidStr, lockedSlug] = content.trim().split(/\s+/, 2);
  let pid = Number(pidStr);
  if (!pid || !lockedSlug) return null;
  return { pid, slug: lockedSlug };
}

function refuseIfAnotherSlugLocked(currentSlug) {
  let lock = readEnvModeLock();
  if (!lock) return;
  if (lock.slug === currentSlug) return; // same env, idempotent
  if (!isPidAlive(lock.pid)) return; // stale, will be overwritten below
  console.error(
    '\n[environment-mode] Refusing to start: another env-mode vite is already\n' +
      `running from this worktree's packages/host (PID ${lock.pid},\n` +
      `BOXEL_ENVIRONMENT slug "${lock.slug}"). This worktree's embroider cache\n` +
      `at packages/host/node_modules/.embroider/ is shared across processes,\n` +
      'so a second env launched here would silently make both vites serve\n' +
      'identical HTML for whichever started last (the upstream port routing\n' +
      "is fine — it's the bundled config/environment that gets clobbered).\n" +
      '\n' +
      'Use a separate git worktree per environment; see the "Environment\n' +
      'mode: parallel environments" section of the repo-root README.\n',
  );
  process.exit(1);
}

function writeEnvModeLock(slug) {
  try {
    fs.mkdirSync(path.dirname(ENV_MODE_LOCK_PATH), { recursive: true });
    fs.writeFileSync(ENV_MODE_LOCK_PATH, `${process.pid} ${slug}\n`, 'utf-8');
  } catch (e) {
    console.warn(
      `[environment-mode] Could not write ${ENV_MODE_LOCK_PATH}: ${e.message}`,
    );
  }
}

function removeEnvModeLockIfOwned() {
  let lock = readEnvModeLock();
  if (lock && lock.pid === process.pid) {
    try {
      fs.unlinkSync(ENV_MODE_LOCK_PATH);
    } catch {
      /* already gone */
    }
  }
}

function runVite({ subcommand, port, allHosts, host, extraEnv, nodeMemory }) {
  const args = ['vite'];
  if (subcommand) args.push(subcommand);
  args.push('--port', String(port), '--strictPort');
  if (allHosts) {
    // Bind to all interfaces so Traefik (running in Docker) can reach
    // vite via host.docker.internal:<port>. Vite's default is 127.0.0.1
    // only, which is unreachable from inside the container.
    args.push('--host');
  } else if (host) {
    args.push('--host', host);
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

  // Forward SIGTERM/SIGINT/SIGHUP to the vite child, then exit immediately
  // with code 0. Two reasons we don't wait for the child:
  //
  //   1. The dev orchestrator gives the process group ~2s of SIGTERM grace
  //      before SIGKILL'ing stragglers (see PGROUP_GRACE_SECS in
  //      mise-tasks/lib/dev-common.sh). If we wait longer than that for our
  //      child to exit, the orchestrator SIGKILLs us mid-wait — pnpm then
  //      reports our death as `Command failed with signal "SIGTERM"` (the
  //      original signal it saw us receive) and the wrapper layers above
  //      print `[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL]`. Exiting in the same
  //      tick guarantees pnpm reads waitpid as a clean exit-code-0.
  //   2. `npx` doesn't reliably propagate forwarded signals to the real
  //      vite process, so waiting on `child.on('exit')` can hang forever.
  //      The orchestrator's `sweep_orphaned_services` is the safety net
  //      that catches the abandoned vite grandchild after we've left.
  let exited = false;
  const exitOnce = (code) => {
    if (!exited) {
      exited = true;
      process.exit(code);
    }
  };
  const shutdown = (signal) => {
    if (!child.killed) {
      try {
        child.kill(signal);
      } catch (_) {
        /* child already gone */
      }
    }
    exitOnce(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  child.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGINT' || signal === 'SIGHUP') {
      exitOnce(0);
      return;
    }
    if (signal) {
      // vite died from another signal (e.g. SIGKILL, SIGSEGV, SIGABRT) —
      // propagate that as a non-zero exit so pnpm and the orchestrator see
      // the crash instead of treating it as a clean shutdown. 128 + signum
      // is the POSIX convention shells use for signal-induced exits.
      const signum = require('os').constants.signals[signal] || 0;
      exitOnce(128 + signum);
      return;
    }
    exitOnce(code || 0);
  });
  return child;
}

// Returns true when env-vars.sh has exported the mkcert cert path —
// the same signal vite.config.mjs uses to enable `server.https`.
function isLocalHttpsDevModeEnabled() {
  return (
    !!process.env.REALM_SERVER_TLS_CERT_FILE &&
    !!process.env.REALM_SERVER_TLS_KEY_FILE
  );
}

// Ask the kernel for an unused loopback port. Used to find an internal
// port for vite when the dispatcher owns the public port.
function pickInternalPort() {
  return new Promise((resolve, reject) => {
    let tester = net.createServer();
    tester.once('error', reject);
    tester.listen({ port: 0, host: '127.0.0.1' }, () => {
      let port = tester.address().port;
      tester.close(() => resolve(port));
    });
  });
}

function startSamePortRedirectDispatcher({ publicPort, viteInternalPort }) {
  let server = net.createServer({ pauseOnConnect: true }, (socket) => {
    socket.on('error', () => socket.destroy());
    socket.once('readable', () => {
      let firstByte;
      try {
        firstByte = socket.read(1);
      } catch {
        socket.destroy();
        return;
      }
      if (!firstByte) {
        socket.destroy();
        return;
      }

      if (firstByte[0] === 0x16) {
        // TLS ClientHello — forward raw bytes to vite, which terminates
        // TLS itself with the cert it loaded in vite.config.mjs. Write the
        // peeked byte explicitly on 'connect' rather than relying on
        // socket.unshift()+pipe(): the unshift pattern races the upstream
        // socket's connect handshake (the rest of the ClientHello can arrive
        // and be written before the unshifted byte gets flushed, leaving
        // vite with a corrupt handshake and the client with
        // ERR_CONNECTION_CLOSED).
        let upstream = net.connect(viteInternalPort, '127.0.0.1');
        upstream.on('error', () => socket.destroy());
        upstream.once('connect', () => {
          upstream.write(firstByte);
          socket.pipe(upstream);
          upstream.pipe(socket);
          socket.resume();
        });
        return;
      }

      // Plain HTTP — read enough to extract the request-target, then
      // 308 to the https:// version on the same authority. The
      // request-target lives between the first and second SP on the
      // start-line, e.g. `GET /foo HTTP/1.1\r\n`. The peeked byte
      // never gets pushed back into the buffer; we just prepend it
      // to the buffered chunks here.
      //
      // 308 (vs 301): preserves the request method and body, so a
      // browser POST or fetch() with a body that hits the http://
      // origin gets a clean replay against https:// instead of
      // silently downgrading to GET.
      let chunks = [firstByte];
      let length = firstByte.length;
      let onData = (chunk) => {
        chunks.push(chunk);
        length += chunk.length;
        let buf = Buffer.concat(chunks, length);
        let lineEnd = buf.indexOf('\r\n');
        if (lineEnd === -1 && length < 8192) {
          return; // wait for more
        }
        socket.removeListener('data', onData);
        let startLine =
          lineEnd === -1
            ? buf.toString('utf8')
            : buf.slice(0, lineEnd).toString('utf8');
        let parts = startLine.split(' ');
        let requestTarget = parts[1] || '/';
        if (!requestTarget.startsWith('/')) requestTarget = '/' + requestTarget;
        let body = `The Boxel dev server speaks HTTPS — redirecting to https://localhost:${publicPort}${requestTarget}\n`;
        let response =
          `HTTP/1.1 308 Permanent Redirect\r\n` +
          `Location: https://localhost:${publicPort}${requestTarget}\r\n` +
          `Content-Type: text/plain; charset=utf-8\r\n` +
          `Content-Length: ${Buffer.byteLength(body)}\r\n` +
          `Connection: close\r\n` +
          `\r\n` +
          body;
        socket.end(response);
        // Suppress noise from clients that pipeline more bytes after our 308.
        socket.on('error', () => {});
      };
      socket.on('data', onData);
      socket.resume();
    });
  });
  server.on('error', (err) => {
    console.error(`[vite-dispatcher] error binding port ${publicPort}:`, err);
    process.exit(1);
  });
  server.listen(publicPort, '127.0.0.1', () => {
    console.log(
      `[vite-dispatcher] Listening on http(s)://localhost:${publicPort} → vite at 127.0.0.1:${viteInternalPort}`,
    );
    console.log(
      `[vite-dispatcher] Plain http://localhost:${publicPort}/* requests will 308 to https://`,
    );
  });
  return server;
}

async function runViteBehindRedirectDispatcher({
  subcommand,
  publicPort,
  nodeMemory,
}) {
  // Vite binds the internal port; the dispatcher owns the public one.
  // Force vite onto 127.0.0.1 to match the dispatcher's upstream
  // net.connect target. Without `--host`, vite default-binds to
  // `localhost`, which on macOS / Node 17+ resolves to ::1 first — the
  // dispatcher then can't reach it on 127.0.0.1 and the TLS handshake
  // dies as ERR_CONNECTION_CLOSED in the browser.
  let viteInternalPort = await pickInternalPort();
  startSamePortRedirectDispatcher({ publicPort, viteInternalPort });
  runVite({
    subcommand,
    port: viteInternalPort,
    allHosts: false,
    host: '127.0.0.1',
    nodeMemory,
  });
}

function startWithTraefik({ subcommand, defaultPort, label, nodeMemory }) {
  const BOXEL_ENVIRONMENT = process.env.BOXEL_ENVIRONMENT;

  if (!BOXEL_ENVIRONMENT) {
    // Same-port http→https redirect dispatcher is only useful for `vite`
    // (dev) where humans type `http://localhost:4200` in a browser bar.
    // For `vite preview` (production build, used by CI and serve:dist),
    // skip the dispatcher and let vite bind the public port directly with
    // HTTPS. The dispatcher's byte-peek + cross-process TCP pipe pattern
    // races chrome's TLS handshake under load and produces
    // ERR_CONNECTION_CLOSED in CI prerender probes, while curl over the
    // same port succeeds — symptom of an ALPN/h2 framing issue inside
    // the pipe that we don't need to solve for the preview path.
    if (isLocalHttpsDevModeEnabled() && subcommand !== 'preview') {
      runViteBehindRedirectDispatcher({
        subcommand,
        publicPort: defaultPort,
        nodeMemory,
      }).catch((err) => {
        console.error('[vite-dispatcher] failed to start:', err);
        process.exit(1);
      });
    } else {
      runVite({ subcommand, port: defaultPort, allHosts: false, nodeMemory });
    }
    return;
  }

  const { ensureTraefik } = require('./ensure-traefik');
  const { getEnvSlug, registerWithTraefik } = require('./traefik-helpers');

  const slug = getEnvSlug();
  refuseIfAnotherSlugLocked(slug);

  ensureTraefik();

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

      writeEnvModeLock(slug);
      process.on('exit', removeEnvModeLockIfOwned);
      for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
        process.on(signal, removeEnvModeLockIfOwned);
      }
    });
  });
}

module.exports = { startWithTraefik };
