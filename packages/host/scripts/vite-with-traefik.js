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

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

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
  const child = spawn('npx', args, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    shell: true,
    env,
  });
  child.on('exit', (code) => process.exit(code || 0));
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
