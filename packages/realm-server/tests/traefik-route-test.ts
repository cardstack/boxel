import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

import { awaitTraefikRoute } from '../../../scripts/traefik-route.js';

const serverURL = 'https://host.docker.internal:50002';
const timeoutMs = 300;
const unreachableTimeoutMs = 900;

module(basename(import.meta.filename), function (hooks) {
  let api: Server | undefined;

  hooks.afterEach(async function () {
    await new Promise<void>((resolve) =>
      api ? api.close(() => resolve()) : resolve(),
    );
    api = undefined;
  });

  // A stand-in for Traefik's API that answers each request for the service
  // with whatever `answer` returns for that request's position, or drops the
  // connection, as Traefik does while it restarts.
  async function startAPI(
    answer: (
      requestNumber: number,
    ) => { status: number; url?: string } | 'drop',
  ) {
    let requested: string[] = [];
    api = createServer((req, res) => {
      requested.push(req.url ?? '');
      let answered = answer(requested.length);
      if (answered === 'drop') {
        req.socket.destroy();
        return;
      }
      let { status, url } = answered;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify(
          url ? { loadBalancer: { servers: [{ url }] } } : { message: '' },
        ),
      );
    });
    await new Promise<void>((resolve) =>
      api!.listen(0, '127.0.0.1', () => resolve()),
    );
    let { port } = api!.address() as AddressInfo;
    return { apiURL: `http://127.0.0.1:${port}`, requested };
  }

  function options(apiURL: string) {
    let restarts = 0;
    let warnings: string[] = [];
    return {
      opts: {
        platform: 'darwin',
        apiURL,
        timeoutMs,
        unreachableTimeoutMs,
        intervalMs: 10,
        restart: () => restarts++,
        warn: (message: string) => warnings.push(message),
      },
      restarts: () => restarts,
      warnings,
    };
  }

  test('a route Traefik already serves needs no restart', async function (assert) {
    let { apiURL, requested } = await startAPI(() => ({
      status: 200,
      url: serverURL,
    }));
    let { opts, restarts } = options(apiURL);

    let outcome = await awaitTraefikRoute('realm-server-slug', serverURL, opts);

    assert.strictEqual(outcome, 'loaded');
    assert.strictEqual(restarts(), 0);
    assert.deepEqual(requested, ['/api/http/services/realm-server-slug@file']);
  });

  test('a route still naming an earlier server is waited for, not restarted', async function (assert) {
    let { apiURL, requested } = await startAPI((n) =>
      n < 4
        ? { status: 200, url: 'https://host.docker.internal:50001' }
        : { status: 200, url: serverURL },
    );
    let { opts, restarts } = options(apiURL);

    let outcome = await awaitTraefikRoute('realm-server-slug', serverURL, opts);

    assert.strictEqual(outcome, 'loaded');
    assert.strictEqual(requested.length, 4);
    assert.strictEqual(restarts(), 0);
  });

  test('a route Traefik never loads restarts Traefik once', async function (assert) {
    let { apiURL } = await startAPI(() => ({ status: 404 }));
    let { opts, restarts, warnings } = options(apiURL);

    let outcome = await awaitTraefikRoute('realm-server-slug', serverURL, opts);

    assert.strictEqual(outcome, 'restarted');
    assert.strictEqual(restarts(), 1);
    assert.strictEqual(warnings.length, 1);
  });

  test('a route Traefik loads after a restart it was already going through is not restarted again', async function (assert) {
    let silentUntil = 0;
    let { apiURL } = await startAPI((n) => {
      if (n === 1) {
        // The API stops answering for longer than the route timeout.
        silentUntil = Date.now() + 2 * timeoutMs;
        return { status: 404 };
      }
      if (Date.now() < silentUntil) {
        return 'drop';
      }
      return { status: 200, url: serverURL };
    });

    let { opts, restarts } = options(apiURL);

    let outcome = await awaitTraefikRoute('realm-server-slug', serverURL, opts);

    assert.strictEqual(outcome, 'loaded');
    assert.strictEqual(restarts(), 0);
  });

  test('an API that never answers restarts Traefik once, after the longer wait', async function (assert) {
    let { apiURL } = await startAPI(() => ({ status: 200, url: serverURL }));
    await new Promise<void>((resolve) => api!.close(() => resolve()));
    api = undefined;
    let { opts, restarts, warnings } = options(apiURL);
    let started = Date.now();

    let outcome = await awaitTraefikRoute('realm-server-slug', serverURL, opts);

    assert.strictEqual(outcome, 'restarted');
    assert.strictEqual(restarts(), 1);
    assert.strictEqual(warnings.length, 1);
    assert.true(Date.now() - started >= unreachableTimeoutMs);
  });

  test('outside macOS the route is not checked', async function (assert) {
    let { apiURL, requested } = await startAPI(() => ({ status: 404 }));
    let { opts, restarts } = options(apiURL);

    let outcome = await awaitTraefikRoute('realm-server-slug', serverURL, {
      ...opts,
      platform: 'linux',
    });

    assert.strictEqual(outcome, 'unchecked');
    assert.deepEqual(requested, []);
    assert.strictEqual(restarts(), 0);
  });
});
