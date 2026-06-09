import { module, test } from 'qunit';
import { basename } from 'path';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import http from 'http';
import https from 'https';
import http2 from 'http2';
import type { AddressInfo } from 'net';
import Koa from 'koa';
import { logger } from '@cardstack/runtime-common';

import { createListener, type RealmHttpServer } from '../server';

// Coverage for the realm-server's HTTP/2 listener. Exercises every branch a
// peer can land in: standard-mode TLS h2 via the same-port dispatcher, TLS
// HTTP/1.1 via ALPN fallback, plain-HTTP 308 redirect, env-mode (Traefik in
// front) h2, and the fail-loud paths — a configured-but-unusable cert, or a
// cert-less env mode — which must crash startup rather than silently serve
// HTTP/1.1 (HTTP/2 is a system invariant). Spawns minimal Koa apps with raw
// http/https clients rather than supertest so we control the negotiation
// explicitly.
//
// The test bootstrap clears REALM_SERVER_TLS_CERT_FILE/_KEY_FILE globally;
// this suite sets them (and BOXEL_ENVIRONMENT) per-test and restores them,
// using a module-scoped self-signed cert generated into a tmp dir.

let tmpCertDir: string;
let certFile: string;
let keyFile: string;

function makeCert(dir: string): { cert: string; key: string } {
  let cert = join(dir, 'cert.pem');
  let key = join(dir, 'key.pem');
  // openssl is universally available on the GH-hosted Ubuntu CI image
  // and on every dev box (mkcert depends on it, dev-cert task uses it).
  // The cert covers localhost + 127.0.0.1 + ::1 so the test client can
  // reach it via any local loopback address.
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-keyout',
    key,
    '-out',
    cert,
    '-days',
    '1',
    '-nodes',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1',
  ]);
  return { cert, key };
}

function makeApp(): Koa {
  let app = new Koa();
  app.use(async (ctx) => {
    ctx.status = 200;
    ctx.set('content-type', 'text/plain');
    ctx.body = `ok via ${ctx.req.httpVersion}`;
  });
  return app;
}

async function startListener(opts: {
  cert?: string | null;
  key?: string | null;
  boxelEnvironment?: string | null;
}): Promise<{
  port: number;
  server: RealmHttpServer;
  isHttp2: boolean;
  close: () => Promise<void>;
}> {
  let priorCert = process.env.REALM_SERVER_TLS_CERT_FILE;
  let priorKey = process.env.REALM_SERVER_TLS_KEY_FILE;
  let priorBoxelEnv = process.env.BOXEL_ENVIRONMENT;
  if (opts.cert == null) {
    delete process.env.REALM_SERVER_TLS_CERT_FILE;
  } else {
    process.env.REALM_SERVER_TLS_CERT_FILE = opts.cert;
  }
  if (opts.key == null) {
    delete process.env.REALM_SERVER_TLS_KEY_FILE;
  } else {
    process.env.REALM_SERVER_TLS_KEY_FILE = opts.key;
  }
  // Default BOXEL_ENVIRONMENT to unset so the standard-mode dispatcher tests
  // aren't perturbed by a parent shell that exported it; the env-mode test
  // opts in explicitly.
  if (opts.boxelEnvironment == null) {
    delete process.env.BOXEL_ENVIRONMENT;
  } else {
    process.env.BOXEL_ENVIRONMENT = opts.boxelEnvironment;
  }
  let { server, proto } = createListener(logger('test:dispatcher'), makeApp());
  let isHttp2 = proto === 'https/h2';
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let port = (server.address() as AddressInfo).port;
  let close = async () => {
    // Restore env vars before we tear the server down so a later test
    // can't observe leftover state from this one.
    if (priorCert !== undefined) {
      process.env.REALM_SERVER_TLS_CERT_FILE = priorCert;
    } else {
      delete process.env.REALM_SERVER_TLS_CERT_FILE;
    }
    if (priorKey !== undefined) {
      process.env.REALM_SERVER_TLS_KEY_FILE = priorKey;
    } else {
      delete process.env.REALM_SERVER_TLS_KEY_FILE;
    }
    if (priorBoxelEnv !== undefined) {
      process.env.BOXEL_ENVIRONMENT = priorBoxelEnv;
    } else {
      delete process.env.BOXEL_ENVIRONMENT;
    }
    let force = (server as { closeAllConnections?: () => void })
      .closeAllConnections;
    if (typeof force === 'function') {
      force.call(server);
    }
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  };
  return { port, server, isHttp2, close };
}

function h1Request(opts: {
  host: string;
  port: number;
  path: string;
  scheme: 'http' | 'https';
  headers?: Record<string, string>;
  followRedirect?: boolean;
}): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    let client = opts.scheme === 'https' ? https : http;
    let req = (client as typeof https).request(
      {
        host: opts.host,
        port: opts.port,
        path: opts.path,
        method: 'GET',
        rejectUnauthorized: false,
        headers: opts.headers,
      },
      (res) => {
        let chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function h2Request(opts: {
  port: number;
  path: string;
  method?: 'GET' | 'HEAD';
  timeoutMs?: number;
}): Promise<{
  status: number;
  body: string;
  protocol: string;
  responseHeaders: Record<string, string>;
}> {
  return new Promise((resolve, reject) => {
    let client = http2.connect(`https://127.0.0.1:${opts.port}`, {
      rejectUnauthorized: false,
    });
    client.on('error', reject);
    let req = client.request({
      ':method': opts.method ?? 'GET',
      ':path': opts.path,
    });
    if (opts.timeoutMs) {
      req.setTimeout(opts.timeoutMs, () => {
        req.close();
        client.close();
        reject(new Error(`h2 request timed out after ${opts.timeoutMs}ms`));
      });
    }
    let status = 0;
    let responseHeaders: Record<string, string> = {};
    let chunks: Buffer[] = [];
    req.on('response', (headers) => {
      status = Number(headers[':status'] ?? 0);
      for (let [k, v] of Object.entries(headers)) {
        if (k.startsWith(':')) continue;
        responseHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
      }
    });
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      let body = Buffer.concat(chunks).toString('utf8');
      client.close();
      resolve({ status, body, protocol: 'h2', responseHeaders });
    });
    req.on('error', reject);
    req.end();
  });
}

// Run `fn` with the given env overrides applied (a key absent from
// `overrides` means "unset for the duration"), restoring the prior values
// afterward — so a synchronously-throwing createListener can't leak
// TLS/env-mode state into later tests.
function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => T,
): T {
  let keys = [
    'REALM_SERVER_TLS_CERT_FILE',
    'REALM_SERVER_TLS_KEY_FILE',
    'BOXEL_ENVIRONMENT',
  ];
  let prior: Record<string, string | undefined> = {};
  for (let k of keys) {
    prior[k] = process.env[k];
  }
  try {
    for (let k of keys) {
      let v = overrides[k];
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    return fn();
  } finally {
    for (let k of keys) {
      if (prior[k] !== undefined) {
        process.env[k] = prior[k];
      } else {
        delete process.env[k];
      }
    }
  }
}

module(basename(__filename), function (hooks) {
  hooks.before(function () {
    tmpCertDir = mkdtempSync(join(tmpdir(), 'realm-listener-test-'));
    let pair = makeCert(tmpCertDir);
    certFile = pair.cert;
    keyFile = pair.key;
  });

  hooks.after(function () {
    rmSync(tmpCertDir, { recursive: true, force: true });
  });

  test('TLS h2 path returns 200', async function (assert) {
    let { port, isHttp2, close } = await startListener({
      cert: certFile,
      key: keyFile,
    });
    try {
      assert.true(isHttp2, 'listener advertises h2 mode');
      let res = await h2Request({ port, path: '/_alive' });
      assert.strictEqual(res.status, 200, 'h2 GET returns 200');
      assert.true(
        res.body.includes('ok via 2.0'),
        `body indicates HTTP/2 — got "${res.body}"`,
      );
    } finally {
      await close();
    }
  });

  test('TLS h2 HEAD returns 200 without hanging', async function (assert) {
    // Regression: Node's http2 compat layer marks Http2Stream.writable=false
    // for HEAD-method server streams. Koa.respond() then short-circuits on
    // `!ctx.writable` without sending any headers and the client hangs
    // until its timeout. `patchKoaResponseForH2Head()` (applied inside
    // `createListener` when an h2 listener is constructed) restores normal
    // HEAD semantics. Without the patch, this test would time out below.
    let { port, isHttp2, close } = await startListener({
      cert: certFile,
      key: keyFile,
    });
    try {
      assert.true(isHttp2, 'listener advertises h2 mode');
      let res = await h2Request({
        port,
        path: '/_alive',
        method: 'HEAD',
        timeoutMs: 2000,
      });
      assert.strictEqual(res.status, 200, 'h2 HEAD returns 200');
      assert.strictEqual(res.body, '', 'h2 HEAD body is empty');
      assert.strictEqual(
        res.responseHeaders['content-length'],
        String(Buffer.byteLength('ok via 2.0')),
        'h2 HEAD reports the GET body length via content-length',
      );
    } finally {
      await close();
    }
  });

  test('TLS HTTP/1.1 ALPN fallback returns 200', async function (assert) {
    let { port, close } = await startListener({
      cert: certFile,
      key: keyFile,
    });
    try {
      let res = await h1Request({
        host: '127.0.0.1',
        port,
        path: '/_alive',
        scheme: 'https',
      });
      assert.strictEqual(res.status, 200, 'https/1.1 GET returns 200');
      assert.true(
        res.body.includes('ok via 1.1'),
        `body indicates HTTP/1.1 — got "${res.body}"`,
      );
    } finally {
      await close();
    }
  });

  test('plain HTTP request gets 308 redirect to https', async function (assert) {
    let { port, close } = await startListener({
      cert: certFile,
      key: keyFile,
    });
    try {
      let res = await h1Request({
        host: '127.0.0.1',
        port,
        path: '/_alive',
        scheme: 'http',
      });
      assert.strictEqual(res.status, 308, 'plain http GET returns 308');
      let location =
        typeof res.headers.location === 'string' ? res.headers.location : '';
      assert.true(
        location.startsWith('https://'),
        `Location is https:// — got "${location}"`,
      );
      assert.true(
        location.endsWith('/_alive'),
        `Location preserves /_alive — got "${location}"`,
      );
    } finally {
      await close();
    }
  });

  test('plain HTTP without Host header still produces a valid https Location', async function (assert) {
    let { port, close } = await startListener({
      cert: certFile,
      key: keyFile,
    });
    try {
      // node's http.request always sets Host; drop down to a raw socket
      // for the no-Host case to exercise the socket.localAddress
      // fallback in redirectToHttps.
      let net = await import('net');
      let response = await new Promise<string>((resolve, reject) => {
        let socket = net.connect(port, '127.0.0.1');
        let chunks: Buffer[] = [];
        socket.on('error', reject);
        socket.on('data', (c) => chunks.push(c));
        socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        socket.write('GET /_alive HTTP/1.0\r\n\r\n');
      });
      let locMatch = response.match(/^Location:\s*(.+)\r$/im);
      let location = locMatch?.[1] ?? '';
      let statusLine = response.split('\n')[0]?.trim() ?? '';
      assert.true(
        /^HTTP\/1\.[01] 308\b/.test(statusLine),
        `got 308 — first line was "${statusLine}"`,
      );
      assert.true(
        location.startsWith('https://127.0.0.1:'),
        `Location uses https + bound host — got "${location}"`,
      );
      assert.true(
        location.endsWith('/_alive'),
        `Location preserves /_alive — got "${location}"`,
      );
    } finally {
      await close();
    }
  });

  test('malformed cert fails startup loudly instead of downgrading', function (assert) {
    // HTTP/2 is a system invariant: a configured-but-unusable cert must
    // crash boot, not silently fall back to HTTP/1.1 and mask the
    // misconfiguration.
    let badCert = join(tmpCertDir, 'bad-cert.pem');
    let badKey = join(tmpCertDir, 'bad-key.pem');
    writeFileSync(badCert, 'not a real cert');
    writeFileSync(badKey, 'not a real key');
    assert.throws(
      () =>
        withEnv(
          {
            REALM_SERVER_TLS_CERT_FILE: badCert,
            REALM_SERVER_TLS_KEY_FILE: badKey,
          },
          () => createListener(logger('test:dispatcher'), makeApp()),
        ),
      /Unable to construct HTTPS\/h2 server/,
      'malformed cert throws rather than serving plain HTTP/1.1',
    );
  });

  test('env mode (BOXEL_ENVIRONMENT) serves h2 directly', async function (assert) {
    // Env mode keeps HTTP/2: Traefik terminates the browser's TLS and
    // re-originates an h2/TLS connection to this backend. The listener is a
    // bare h2 secure server — no first-byte dispatcher and no 308 redirect,
    // since Traefik is the only client and always connects over TLS.
    let { port, isHttp2, close } = await startListener({
      cert: certFile,
      key: keyFile,
      boxelEnvironment: 'cs-test-env',
    });
    try {
      assert.true(isHttp2, 'env mode advertises h2 (no downgrade to HTTP/1.1)');
      let res = await h2Request({ port, path: '/_alive' });
      assert.strictEqual(res.status, 200, 'env-mode h2 GET returns 200');
      assert.true(
        res.body.includes('ok via 2.0'),
        `body indicates HTTP/2 — got "${res.body}"`,
      );
    } finally {
      await close();
    }
  });

  test('env mode h2 server force-closes connections on shutdown', async function (assert) {
    // The env-mode listener is a bare Http2SecureServer, which — unlike
    // http.Server — has no native closeAllConnections(). main.ts force-
    // closes through that method on shutdown; without a mirror, a
    // persistent h2 session (Traefik's backend connection, an open tab)
    // wedges server.close() until the peer disconnects. Assert the mirror
    // exists and actually tears a live session down.
    let { port, server, close } = await startListener({
      cert: certFile,
      key: keyFile,
      boxelEnvironment: 'cs-test-env',
    });
    let forceClose = (server as { closeAllConnections?: () => void })
      .closeAllConnections;
    assert.strictEqual(
      typeof forceClose,
      'function',
      'env-mode h2 server mirrors http.Server.closeAllConnections',
    );
    let client = http2.connect(`https://127.0.0.1:${port}`, {
      rejectUnauthorized: false,
    });
    client.on('error', () => {});
    // Complete a request so the session is established and kept alive.
    await new Promise<void>((resolve, reject) => {
      let req = client.request({ ':method': 'GET', ':path': '/_alive' });
      req.on('error', reject);
      req.resume();
      req.on('end', () => resolve());
      req.end();
    });
    try {
      let sessionClosed = new Promise<string>((resolve) =>
        client.once('close', () => resolve('closed')),
      );
      let timedOut = new Promise<string>((resolve) =>
        setTimeout(() => resolve('timeout'), 3000),
      );
      forceClose!.call(server);
      assert.strictEqual(
        await Promise.race([sessionClosed, timedOut]),
        'closed',
        'closeAllConnections() tears down the live h2 session (no shutdown hang)',
      );
    } finally {
      client.close();
      await close();
    }
  });

  test('env mode without a TLS cert fails startup loudly', function (assert) {
    // In env mode the dev cert is mandatory: a missing cert must crash boot,
    // not serve plain HTTP/1.1 (which Traefik, expecting h2, would turn into
    // all-502s).
    assert.throws(
      () =>
        withEnv({ BOXEL_ENVIRONMENT: 'cs-test-env' }, () =>
          createListener(logger('test:dispatcher'), makeApp()),
        ),
      /HTTP\/2 requires a TLS cert\/key/,
      'env mode with no cert throws rather than serving plain HTTP/1.1',
    );
  });

  test('h2 diagnostics (passive ping + session snapshot) do not disrupt serving', async function (assert) {
    // With REALM_SERVER_HTTP2_DIAGNOSTICS on, every accepted session is swept
    // every 5s — a passive PING + a state snapshot. Hold one h2 connection open
    // across a sweep and confirm the session still serves afterwards, i.e. the
    // observer-only diagnostics neither throw in the interval nor perturb the
    // session they watch.
    let prior = process.env.REALM_SERVER_HTTP2_DIAGNOSTICS;
    process.env.REALM_SERVER_HTTP2_DIAGNOSTICS = '1';
    let restoreEnv = () => {
      if (prior !== undefined) {
        process.env.REALM_SERVER_HTTP2_DIAGNOSTICS = prior;
      } else {
        delete process.env.REALM_SERVER_HTTP2_DIAGNOSTICS;
      }
    };
    let { port, isHttp2, close } = await startListener({
      cert: certFile,
      key: keyFile,
    });
    let client = http2.connect(`https://127.0.0.1:${port}`, {
      rejectUnauthorized: false,
    });
    let request = (path: string) =>
      new Promise<number>((resolve, reject) => {
        let req = client.request({ ':method': 'GET', ':path': path });
        let status = 0;
        req.on('response', (h) => (status = Number(h[':status'] ?? 0)));
        req.on('error', reject);
        req.resume();
        req.on('end', () => resolve(status));
        req.end();
      });
    try {
      assert.true(isHttp2, 'listener advertises h2 mode');
      assert.strictEqual(await request('/_alive'), 200, 'first request OK');
      // Cross at least one 5s sweep so the passive ping + snapshot run against
      // the live session.
      await new Promise((r) => setTimeout(r, 5500));
      assert.strictEqual(
        await request('/_alive'),
        200,
        'request after a diagnostics sweep still OK — ping did not disrupt the session',
      );
    } finally {
      client.close();
      await close();
      restoreEnv();
    }
  });

  test('no cert env vars produces plain HTTP listener', async function (assert) {
    let { port, isHttp2, close } = await startListener({
      cert: null,
      key: null,
    });
    try {
      assert.false(isHttp2, 'listener stays on plain HTTP');
      let res = await h1Request({
        host: '127.0.0.1',
        port,
        path: '/_alive',
        scheme: 'http',
      });
      assert.strictEqual(res.status, 200);
    } finally {
      await close();
    }
  });
});
