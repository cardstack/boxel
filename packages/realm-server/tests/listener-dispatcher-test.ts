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

import { createListener } from '../server';

// Coverage for the same-port HTTPS+HTTP/2 dispatcher (CS-11114). Exercises
// every branch a peer can land in: TLS h2, TLS HTTP/1.1 via ALPN fallback,
// plain HTTP redirect, and malformed-cert downgrade. Spawns minimal Koa
// apps with raw http/https clients rather than supertest so we control the
// negotiation explicitly.
//
// Tests bootstrap clears REALM_SERVER_TLS_CERT_FILE/_KEY_FILE globally;
// this suite restores them per-test via a module-scoped setup that
// generates a fresh self-signed cert into a tmp dir.

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
}): Promise<{
  port: number;
  isHttp2: boolean;
  close: () => Promise<void>;
}> {
  let priorCert = process.env.REALM_SERVER_TLS_CERT_FILE;
  let priorKey = process.env.REALM_SERVER_TLS_KEY_FILE;
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
    let force = (server as { closeAllConnections?: () => void })
      .closeAllConnections;
    if (typeof force === 'function') {
      force.call(server);
    }
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  };
  return { port, isHttp2, close };
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

  test('malformed cert downgrades to plain HTTP listener', async function (assert) {
    let badCert = join(tmpCertDir, 'bad-cert.pem');
    let badKey = join(tmpCertDir, 'bad-key.pem');
    writeFileSync(badCert, 'not a real cert');
    writeFileSync(badKey, 'not a real key');
    let { port, isHttp2, close } = await startListener({
      cert: badCert,
      key: badKey,
    });
    try {
      assert.false(isHttp2, 'listener falls back to plain HTTP');
      let res = await h1Request({
        host: '127.0.0.1',
        port,
        path: '/_alive',
        scheme: 'http',
      });
      assert.strictEqual(res.status, 200, 'plain http GET returns 200');
      assert.true(
        res.body.includes('ok via 1.1'),
        `body indicates HTTP/1.1 — got "${res.body}"`,
      );
    } finally {
      await close();
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
