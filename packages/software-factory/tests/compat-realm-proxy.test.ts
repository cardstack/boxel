import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  startCompatRealmProxy,
  type StartedCompatRealmProxy,
} from '@cardstack/realm-test-harness';

// The realm server keeps idle sockets open for over an hour so the load
// balancer in front of it never sends onto a closed one; this upstream
// advertises the same.
const REALM_SERVER_KEEP_ALIVE_MS = 4200 * 1000;

async function startUpstream(): Promise<Server> {
  let upstream = createServer((req, res) => {
    let chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url?.endsWith('?named-per-connection')) {
        res.setHeader('x-upstream-only', 'per-connection');
        res.setHeader('connection', 'keep-alive, x-upstream-only');
      }
      res.end(JSON.stringify({ body: Buffer.concat(chunks).toString('utf8') }));
    });
  });
  upstream.keepAliveTimeout = REALM_SERVER_KEEP_ALIVE_MS;
  await new Promise<void>((resolve) =>
    upstream.listen(0, '127.0.0.1', () => resolve()),
  );
  return upstream;
}

// Sends a request with headers `fetch` won't let a caller set, the way a
// client that frames its own body would.
function rawPost(
  port: number,
  headers: Record<string, string>,
  chunks: string[],
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/_run-command',
        method: 'POST',
        headers,
        agent: false,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    for (let chunk of chunks) {
      req.write(chunk);
    }
    req.end();
  });
}

module('startCompatRealmProxy', function (hooks) {
  let upstream: Server;
  let proxy: StartedCompatRealmProxy;
  let url: string;

  hooks.beforeEach(async function () {
    upstream = await startUpstream();
    proxy = await startCompatRealmProxy({ listenPort: 0 });
    proxy.setTargetPort((upstream.address() as AddressInfo).port, () => '');
    url = `http://localhost:${proxy.listenPort}/_run-command`;
  });

  hooks.afterEach(async function () {
    await proxy.stop();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  function post(search = ''): Promise<Response> {
    return fetch(`${url}${search}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
  }

  // A client pools its socket to the proxy for as long as the proxy's
  // `Keep-Alive` says. The proxy's server closes an idle socket after
  // keepAliveTimeout (5s) plus keepAliveTimeoutBuffer (1s), so the proxy
  // must advertise its own timeout: with the realm server's, a client sends
  // onto a socket the proxy is closing and gets no response.
  test('answers with its own keep-alive, not the upstream realm server’s', async function (assert) {
    let response = await post();
    await response.text();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      response.headers.get('keep-alive'),
      'timeout=5',
      'the keep-alive timeout is the proxy server’s own',
    );
    assert.strictEqual(
      response.headers.get('content-type'),
      'application/json',
      'end-to-end headers are forwarded',
    );
  });

  test('does not forward a header the upstream names in Connection', async function (assert) {
    let response = await post('?named-per-connection');
    await response.text();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('x-upstream-only'), null);
  });

  test('forwards a chunked request body without its framing headers', async function (assert) {
    let response = await rawPost(
      proxy.listenPort,
      {
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
        connection: 'keep-alive',
        'keep-alive': 'timeout=5',
      },
      ['{"a":', '1}'],
    );

    assert.strictEqual(response.status, 200, response.body);
    assert.deepEqual(JSON.parse(response.body), { body: '{"a":1}' });
  });
});
