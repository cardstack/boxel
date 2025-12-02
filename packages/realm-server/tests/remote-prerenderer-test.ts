import { module, test } from 'qunit';
import { basename } from 'path';
import { createServer } from 'http';
import { createRemotePrerenderer } from '../prerender/remote-prerenderer';
import {
  PRERENDER_SERVER_DRAINING_STATUS_CODE,
  PRERENDER_SERVER_STATUS_DRAINING,
  PRERENDER_SERVER_STATUS_HEADER,
} from '../prerender/prerender-constants';

module(basename(__filename), function () {
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
        userId: '@user:localhost',
        permissions: {},
      });

      assert.true((result as any).ok, 'eventually succeeds after retries');
      await new Promise<void>((resolve) => server.close(() => resolve()));
      delete process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS;
      delete process.env.PRERENDER_MANAGER_RETRY_MAX_ELAPSED_MS;
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
          userId: '@user:localhost',
          permissions: {},
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
  });
});

module(basename(__filename), function () {
  module('remote prerenderer timeouts', function () {
    test('retries when a request times out', async function (assert) {
      process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS = '3';
      process.env.PRERENDER_MANAGER_RETRY_DELAY_MS = '1';
      process.env.PRERENDER_MANAGER_REQUEST_TIMEOUT_MS = '20';
      let attempts = 0;

      let server = createServer((_req, res) => {
        attempts++;
        if (attempts === 1) {
          res.on('error', () => {});
          setTimeout(() => {
            if (!res.writableEnded && !res.destroyed) {
              res.statusCode = 504;
              res.end('delayed');
            }
          }, 100);
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
          userId: '@user:localhost',
          permissions: {},
        });

        assert.true(
          (result as any).ok,
          'eventually succeeds after timing out and retrying',
        );
        assert.ok(attempts >= 2, 'retried after timeout');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        delete process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS;
        delete process.env.PRERENDER_MANAGER_RETRY_DELAY_MS;
        delete process.env.PRERENDER_MANAGER_REQUEST_TIMEOUT_MS;
      }
    });
  });
});
