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
      server.close();
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
        server.close();
        delete process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS;
      }
    });
  });
});
