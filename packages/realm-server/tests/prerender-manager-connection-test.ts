import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createServer, type IncomingMessage, type Server } from 'http';
import type { AddressInfo } from 'net';
import { fetchFromManager } from '../prerender/config.ts';

// A prerender server's calls to the manager must each open a connection of
// their own: the manager's load balancer picks a task per connection, so a
// reused connection keeps a server talking to a manager task that is being
// replaced.

interface Received {
  socket: string;
  method: string;
  contentType: string | undefined;
  body: string;
}

async function startManager(): Promise<{
  url: string;
  received: Received[];
  close: () => Promise<void>;
}> {
  let received: Received[] = [];
  let server: Server = createServer((req: IncomingMessage, res) => {
    let chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        socket: `${req.socket.remoteAddress}:${req.socket.remotePort}`,
        method: req.method ?? '',
        contentType: req.headers['content-type'],
        body: Buffer.concat(chunks).toString(),
      });
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  // Long enough that nothing but the client closing a connection ends it
  // between two requests.
  server.keepAliveTimeout = 60_000;
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  let { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

module(basename(import.meta.filename), function () {
  test('each request to the manager opens a connection of its own', async function (assert) {
    let manager = await startManager();
    try {
      for (let i = 0; i < 4; i++) {
        let response = await fetchFromManager(
          `${manager.url}/prerender-servers`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/vnd.api+json' },
            body: JSON.stringify({ heartbeat: i }),
          },
        );
        await response.text();
      }
      assert.strictEqual(manager.received.length, 4);
      assert.strictEqual(
        new Set(manager.received.map((r) => r.socket)).size,
        4,
        'four requests arrive on four different connections',
      );
      assert.deepEqual(
        manager.received.map((r) => [r.method, r.contentType, r.body]),
        [0, 1, 2, 3].map((i) => [
          'POST',
          'application/vnd.api+json',
          JSON.stringify({ heartbeat: i }),
        ]),
        'the method, the caller’s headers and the body are sent as given',
      );
    } finally {
      await manager.close();
    }
  });

  test('a plain fetch to the same manager reuses its connection', async function (assert) {
    // The contrast the test above depends on: without closing, the client
    // keeps the connection and sends later requests on it.
    let manager = await startManager();
    try {
      for (let i = 0; i < 4; i++) {
        let response = await fetch(`${manager.url}/prerender-servers`, {
          method: 'POST',
          body: '{}',
        });
        await response.text();
      }
      assert.true(
        new Set(manager.received.map((r) => r.socket)).size < 4,
        'at least one request reuses an earlier connection',
      );
    } finally {
      await manager.close();
    }
  });
});
