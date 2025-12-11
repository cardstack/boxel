import { module, test } from 'qunit';
import { basename } from 'path';
import { createServer } from 'http';
import { createRemotePrerenderer } from '../prerender/remote-prerenderer';
import {
  PRERENDER_SERVER_DRAINING_STATUS_CODE,
  PRERENDER_SERVER_STATUS_DRAINING,
  PRERENDER_SERVER_STATUS_HEADER,
} from '../prerender/prerender-constants';

module(basename(__filename), function (hooks) {
  hooks.afterEach(function () {
    delete process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS;
    delete process.env.PRERENDER_MANAGER_RETRY_DELAY_MS;
    delete process.env.PRERENDER_MANAGER_REQUEST_TIMEOUT_MS;
    delete process.env.PRERENDER_MANAGER_MAX_DELAY_MS;
  });

  module('remote prerenderer payload', function () {
    test('sends JSON:API headers and attributes', async function (assert) {
      let receivedHeaders: any;
      let receivedBody: any;
      let server = createServer((req, res) => {
        receivedHeaders = req.headers;
        let body: Buffer[] = [];
        req.on('data', (chunk) => body.push(chunk));
        req.on('end', () => {
          receivedBody = JSON.parse(Buffer.concat(body).toString('utf-8'));
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              data: { attributes: { ok: true } },
            }),
          );
        });
      }).listen(0);

      try {
        let url = `http://127.0.0.1:${(server.address() as any).port}`;
        let prerenderer = createRemotePrerenderer(url);

        await prerenderer.prerenderModule({
          realm: 'realm-1',
          url: 'https://example.com/module',
          auth: '{"token":"x"}',
        });

        assert.strictEqual(
          receivedHeaders?.['content-type'],
          'application/vnd.api+json',
          'content-type header set',
        );
        assert.strictEqual(
          receivedHeaders?.accept,
          'application/vnd.api+json',
          'accept header set',
        );
        assert.deepEqual(
          receivedBody?.data?.attributes,
          {
            realm: 'realm-1',
            url: 'https://example.com/module',
            auth: '{"token":"x"}',
            renderOptions: {},
          },
          'sends expected attributes',
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test('validates required attributes before sending', async function (assert) {
      let originalFetch = globalThis.fetch;
      let fetchCalled = false;
      (globalThis as any).fetch = () => {
        fetchCalled = true;
        throw new Error('fetch should not be called when validation fails');
      };

      try {
        let prerenderer = createRemotePrerenderer('http://127.0.0.1:0');
        await assert.rejects(
          prerenderer.prerenderModule({
            realm: '',
            url: 'https://example.com/module',
            auth: '{}',
          }),
          /Missing prerender prerender-module-request attributes: realm/,
          'throws with helpful message',
        );
        assert.false(fetchCalled, 'does not hit network on validation failure');
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });
  });

  module('remote prerenderer retries', function () {
    test('retries draining responses and succeeds', async function (assert) {
      let attempts = 0;
      let server = createServer((req, res) => {
        attempts++;
        if (req.url?.endsWith('/prerender-card') && attempts < 3) {
          res.statusCode = PRERENDER_SERVER_DRAINING_STATUS_CODE;
          res.setHeader(
            PRERENDER_SERVER_STATUS_HEADER,
            PRERENDER_SERVER_STATUS_DRAINING,
          );
          res.end('draining');
          return;
        }
        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            data: { attributes: { ok: true } },
          }),
        );
      }).listen(0);
      let url = `http://127.0.0.1:${(server.address() as any).port}`;
      let prerenderer = createRemotePrerenderer(url);

      let result = await prerenderer.prerenderCard({
        realm: 'realm',
        url: 'https://example.com/card',
        auth: '{}',
      });

      assert.true((result as any).ok, 'eventually succeeds after retries');
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    test('fails after exhausting retries on 503', async function (assert) {
      process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS = '2';
      let attempts = 0;
      let server = createServer((_req, res) => {
        attempts++;
        res.statusCode = 503;
        res.end('unavailable');
      }).listen(0);
      let url = `http://127.0.0.1:${(server.address() as any).port}`;
      let prerenderer = createRemotePrerenderer(url);

      try {
        await prerenderer.prerenderCard({
          realm: 'realm',
          url: 'https://example.com/card',
          auth: '{}',
        });
        assert.ok(false, 'should have thrown');
      } catch (e: any) {
        assert.ok(/status 503/.test(e.message), 'fails after retries with 503');
        assert.ok(attempts >= 2, 'retried at least configured attempts');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        delete process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS;
        delete process.env.PRERENDER_MANAGER_RETRY_MAX_ELAPSED_MS;
      }
    });

    test('retries on manager 500 and succeeds', async function (assert) {
      process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS = '3';
      process.env.PRERENDER_MANAGER_RETRY_DELAY_MS = '1';
      let attempts = 0;
      let server = createServer((_req, res) => {
        attempts++;
        if (attempts === 1) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              errors: [{ status: 500, message: 'Protocol error' }],
            }),
          );
          return;
        }
        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            data: { attributes: { ok: true } },
          }),
        );
      }).listen(0);

      try {
        let url = `http://127.0.0.1:${(server.address() as any).port}`;
        let prerenderer = createRemotePrerenderer(url);

        let result = await prerenderer.prerenderCard({
          realm: 'realm',
          url: 'https://example.com/card',
          auth: '{}',
        });

        assert.true((result as any).ok, 'eventually succeeds after 500');
        assert.ok(attempts >= 2, 'retried after 500');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});

module(basename(__filename), function () {
  module('remote prerenderer timeouts', function () {
    test('does not retry when the client aborts from request timeout', async function (assert) {
      process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS = '3';
      process.env.PRERENDER_MANAGER_RETRY_DELAY_MS = '1';
      process.env.PRERENDER_MANAGER_REQUEST_TIMEOUT_MS = '20';
      let attempts = 0;

      let server = createServer((_req, res) => {
        attempts++;
        // Never respond; let client-side timeout abort the request.
        res.on('error', () => {});
      }).listen(0);

      try {
        let url = `http://127.0.0.1:${(server.address() as any).port}`;
        let prerenderer = createRemotePrerenderer(url);

        await assert.rejects(
          prerenderer.prerenderCard({
            realm: 'realm',
            url: 'https://example.com/card',
            auth: '{}',
          }),
          /aborted/,
          'throws after client-side abort',
        );
        assert.strictEqual(attempts, 1, 'does not retry after timeout abort');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});
