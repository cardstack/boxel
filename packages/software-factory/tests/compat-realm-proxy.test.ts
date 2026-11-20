import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  startCompatRealmProxy,
  type StartedCompatRealmProxy,
} from '@cardstack/realm-test-harness';

// The realm server keeps idle sockets open for over an hour so the load
// balancer in front of it never sends onto a closed one; the upstream here
// advertises the same.
const REALM_SERVER_KEEP_ALIVE_MS = 4200 * 1000;

// The proxy's own server closes an idle client socket after Node's default
// keepAliveTimeout (5s) plus keepAliveTimeoutBuffer (1s).
const PROXY_IDLE_CLOSE_MS = 6000;

async function startUpstream(): Promise<Server> {
  let upstream = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url?.endsWith('?named-per-connection')) {
        res.setHeader('x-upstream-only', 'per-connection');
        res.setHeader('connection', 'keep-alive, x-upstream-only');
      }
      res.end('{"ok":true}');
    });
  });
  upstream.keepAliveTimeout = REALM_SERVER_KEEP_ALIVE_MS;
  await new Promise<void>((resolve) =>
    upstream.listen(0, '127.0.0.1', () => resolve()),
  );
  return upstream;
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

  test('answers with its own connection headers, not the upstream realm server’s', async function (assert) {
    let response = await post();
    await response.text();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      response.headers.get('keep-alive'),
      `timeout=${Math.floor((PROXY_IDLE_CLOSE_MS - 1000) / 1000)}`,
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

  test('a request sent as the proxy closes an idle client socket still gets a response', async function (assert) {
    assert.timeout(30_000);

    let warm = await post();
    await warm.text();

    // Go idle until just past the proxy's close, with the event loop blocked
    // across it the way a test's fixture keeps it busy, so the request below
    // is written before the client has processed the close.
    let stallMs = 1000;
    await new Promise((resolve) =>
      setTimeout(resolve, PROXY_IDLE_CLOSE_MS + 50 - stallMs),
    );
    let stallStart = Date.now();
    while (Date.now() - stallStart < stallMs) {
      // block the event loop
    }

    let status: number | string;
    try {
      let response = await post();
      await response.text();
      status = response.status;
    } catch (error) {
      let cause = (error as { cause?: { code?: string; message?: string } })
        .cause;
      status = `${(error as Error).message} (caused by: ${cause?.code ?? cause?.message})`;
    }
    assert.strictEqual(status, 200, 'the request gets a response');
  });
});
