import { module, test } from 'qunit';
import Koa from 'koa';
import Router from '@koa/router';
import supertest from 'supertest';
import { basename } from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import type { DBAdapter } from '@cardstack/runtime-common';

import handlePrerenderProxy from '../handlers/handle-prerender-proxy';
import { jwtMiddleware } from '../middleware';
import { createJWT } from '../utils/jwt';
import { closeServer, realmSecretSeed } from './helpers';
import { buildPrerenderApp } from '../prerender/prerender-app';
import { buildCreatePrerenderAuth } from '../prerender/auth';
import { verifyJWT } from '../jwt';

module(basename(__filename), function () {
  module('prerender proxy', function (hooks) {
    let upstream: http.Server | undefined;
    let upstreamRequests: Array<{
      url: string;
      headers: http.IncomingHttpHeaders;
      body: string;
    }> = [];
    let createPrerenderAuth = buildCreatePrerenderAuth(realmSecretSeed);

    hooks.afterEach(async function () {
      upstreamRequests = [];
      if (upstream) {
        await closeServer(upstream);
      }
      upstream = undefined;
    });

    async function startUpstreamServer(): Promise<string> {
      upstreamRequests = [];
      upstream = http.createServer((req, res) => {
        let body: Buffer[] = [];
        req.on('data', (chunk) => body.push(chunk));
        req.on('end', () => {
          upstreamRequests.push({
            url: req.url || '',
            headers: req.headers,
            body: Buffer.concat(body).toString(),
          });
          res.statusCode = 201;
          res.setHeader('content-type', 'application/vnd.api+json');
          res.end(
            JSON.stringify({
              data: {
                attributes: { ok: true },
              },
            }),
          );
        });
      });

      await new Promise<void>((resolve) =>
        upstream!.listen(0, '127.0.0.1', () => resolve()),
      );
      let address = upstream!.address() as AddressInfo;
      return `http://127.0.0.1:${address.port}/`;
    }

    function makeDbAdapter(rows: any[]): DBAdapter {
      return {
        kind: 'pg',
        isClosed: false,
        async execute() {
          return rows;
        },
        async close() {},
        async getColumnNames() {
          return [];
        },
      };
    }

    async function getAvailablePort() {
      return await new Promise<number>((resolve, reject) => {
        let server = http.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          let { port } = server.address() as AddressInfo;
          server.close(() => resolve(port));
        });
      });
    }

    async function startPrerenderServer() {
      let port = await getAvailablePort();
      let prerenderURL = `http://127.0.0.1:${port}`;
      let { app, prerenderer } = buildPrerenderApp({
        serverURL: prerenderURL,
        silent: true,
      });
      let renderCalls: Array<{
        kind: 'card' | 'module';
        args: {
          realm: string;
          url: string;
          auth: string;
        };
      }> = [];

      (prerenderer as any).prerenderCard = async ({
        realm,
        url,
        auth,
      }: {
        realm: string;
        url: string;
        auth: string;
      }) => {
        renderCalls.push({
          kind: 'card',
          args: { realm, url, auth },
        });
        return {
          response: {
            displayNames: ['Proxy Card'],
            searchDoc: { url, title: 'through proxy' },
            isolatedHTML: `<div>${url}</div>`,
          },
          timings: { launchMs: 1, renderMs: 2 },
          pool: {
            pageId: 'card-page',
            realm,
            reused: false,
            evicted: false,
            timedOut: false,
          },
        };
      };

      (prerenderer as any).prerenderModule = async ({
        realm,
        url,
        auth,
      }: {
        realm: string;
        url: string;
        auth: string;
      }) => {
        renderCalls.push({
          kind: 'module',
          args: { realm, url, auth },
        });
        return {
          response: {
            status: 'ready',
            definitions: { [url]: { name: 'definition' } },
            isShimmed: false,
          },
          timings: { launchMs: 3, renderMs: 4 },
          pool: {
            pageId: 'module-page',
            realm,
            reused: false,
            evicted: false,
            timedOut: false,
          },
        };
      };

      let server = http.createServer(app.callback());
      await new Promise<void>((resolve) =>
        server.listen(port, '127.0.0.1', () => resolve()),
      );

      return {
        prerenderURL,
        renderCalls,
        async stopServer() {
          await closeServer(server);
          await prerenderer.stop();
        },
      };
    }

    test('proxies prerender requests to the configured upstream server', async function (assert) {
      let upstreamURL = await startUpstreamServer();
      let dbAdapter = makeDbAdapter([
        {
          username: '@someone:localhost',
          read: true,
          write: true,
          realm_owner: false,
        },
      ]);
      let app = new Koa();
      let router = new Router();
      router.post(
        '/_prerender-card',
        jwtMiddleware(realmSecretSeed),
        handlePrerenderProxy({
          path: '/prerender-card',
          prerendererUrl: upstreamURL,
          dbAdapter,
          createPrerenderAuth,
        }),
      );
      app.use(router.routes());

      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );
      let payload = {
        data: {
          attributes: { realm: 'http://example/', url: 'http://example/card' },
        },
      };

      let response = await supertest(app.callback())
        .post('/_prerender-card')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201);

      assert.deepEqual(
        response.body,
        { data: { attributes: { ok: true } } },
        'passes through upstream response body',
      );
      assert.strictEqual(
        upstreamRequests[0]?.url,
        '/prerender-card',
        'forwards request to prerender path',
      );
      let forwarded = JSON.parse(upstreamRequests[0]?.body || '{}');
      assert.strictEqual(
        forwarded.data.attributes.userId,
        '@someone:localhost',
        'forwards request payload with derived userId',
      );
      assert.deepEqual(
        forwarded.data.attributes.permissions,
        {
          'http://example/': ['read', 'write'],
        },
        'forwards request payload with derived permissions',
      );
      assert.ok(
        forwarded.data.attributes.auth,
        'forwards prerender auth token',
      );
      let sessions = JSON.parse(forwarded.data.attributes.auth);
      let tokenClaims = verifyJWT(sessions['http://example/'], realmSecretSeed);
      assert.strictEqual(
        tokenClaims.user,
        '@someone:localhost',
        'includes user in prerender auth',
      );
      assert.deepEqual(
        tokenClaims.permissions,
        ['read', 'write'],
        'encodes permissions in prerender auth',
      );
      assert.strictEqual(
        tokenClaims.realm,
        'http://example/',
        'encodes realm in prerender auth',
      );
    });

    test('returns an error when no upstream is configured', async function (assert) {
      let app = new Koa();
      let router = new Router();
      router.post(
        '/_prerender-card',
        jwtMiddleware(realmSecretSeed),
        handlePrerenderProxy({
          path: '/prerender-card',
          prerendererUrl: undefined,
          dbAdapter: makeDbAdapter([]),
          createPrerenderAuth,
        }),
      );
      app.use(router.routes());

      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );

      let res = await supertest(app.callback())
        .post('/_prerender-card')
        .set('Authorization', `Bearer ${token}`)
        .send({ data: { attributes: {} } })
        .expect(500);

      assert.ok(
        res.text.includes('Prerender proxy is not configured'),
        'returns a useful error message when upstream is missing',
      );
    });

    test('returns forbidden when user has no realm permissions', async function (assert) {
      let upstreamURL = await startUpstreamServer();
      let app = new Koa();
      let router = new Router();
      router.post(
        '/_prerender-card',
        jwtMiddleware(realmSecretSeed),
        handlePrerenderProxy({
          path: '/prerender-card',
          prerendererUrl: upstreamURL,
          dbAdapter: makeDbAdapter([]), // no permissions
          createPrerenderAuth,
        }),
      );
      app.use(router.routes());

      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );

      let res = await supertest(app.callback())
        .post('/_prerender-card')
        .set('Authorization', `Bearer ${token}`)
        .send({
          data: {
            attributes: {
              realm: 'http://localhost:4201/base/',
              url: 'http://localhost:4201/base/some-card',
            },
          },
        });

      assert.strictEqual(
        res.status,
        403,
        'forbidden when user lacks permissions',
      );
    });

    test('proxies to prerender server card and module endpoints', async function (assert) {
      let { prerenderURL, renderCalls, stopServer } =
        await startPrerenderServer();
      let realm = 'http://example.test/';
      let dbAdapter = makeDbAdapter([
        {
          username: '@someone:localhost',
          read: true,
          write: true,
          realm_owner: false,
        },
      ]);
      let app = new Koa();
      let router = new Router();
      router.post(
        '/_prerender-card',
        jwtMiddleware(realmSecretSeed),
        handlePrerenderProxy({
          path: '/prerender-card',
          prerendererUrl: prerenderURL,
          dbAdapter,
          createPrerenderAuth,
        }),
      );
      router.post(
        '/_prerender-module',
        jwtMiddleware(realmSecretSeed),
        handlePrerenderProxy({
          path: '/prerender-module',
          prerendererUrl: prerenderURL,
          dbAdapter,
          createPrerenderAuth,
        }),
      );
      app.use(router.routes());

      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );

      try {
        let cardUrl = `${realm}card`;
        let cardResponse = await supertest(app.callback())
          .post('/_prerender-card')
          .set('Authorization', `Bearer ${token}`)
          .send({
            data: { attributes: { realm, url: cardUrl } },
          })
          .expect(201);

        assert.strictEqual(cardResponse.body.data.type, 'prerender-result');
        assert.strictEqual(cardResponse.body.data.id, cardUrl);
        assert.deepEqual(cardResponse.body.data.attributes.displayNames, [
          'Proxy Card',
        ]);

        let moduleUrl = `${realm}module.gts`;
        let moduleResponse = await supertest(app.callback())
          .post('/_prerender-module')
          .set('Authorization', `Bearer ${token}`)
          .send({
            data: { attributes: { realm, url: moduleUrl } },
          })
          .expect(201);

        assert.strictEqual(
          moduleResponse.body.data.type,
          'prerender-module-result',
        );
        assert.strictEqual(moduleResponse.body.data.id, moduleUrl);
        assert.strictEqual(moduleResponse.body.data.attributes.status, 'ready');

        assert.deepEqual(
          renderCalls.map(({ kind, args }) => {
            let sessions = JSON.parse(args.auth);
            let claims = verifyJWT(sessions[realm], realmSecretSeed);
            return {
              kind,
              realm: args.realm,
              url: args.url,
              permissions: { [claims.realm]: claims.permissions },
              userId: claims.user,
            };
          }),
          [
            {
              kind: 'card',
              realm,
              url: cardUrl,
              permissions: { [realm]: ['read', 'write'] },
              userId: '@someone:localhost',
            },
            {
              kind: 'module',
              realm,
              url: moduleUrl,
              permissions: { [realm]: ['read', 'write'] },
              userId: '@someone:localhost',
            },
          ],
          'forwards requests to prerender server with derived auth info',
        );
      } finally {
        await stopServer();
      }
    });
  });
});
