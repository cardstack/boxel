import { module, test } from 'qunit';
import Koa from 'koa';
import Router from '@koa/router';
import supertest from 'supertest';
import http from 'http';
import type { AddressInfo } from 'net';
import type { DBAdapter } from '@cardstack/runtime-common';

import handlePrerenderProxy from '../handlers/handle-prerender-proxy';
import { jwtMiddleware } from '../middleware';
import { createJWT } from '../utils/jwt';
import { closeServer, realmSecretSeed } from './helpers';

module('prerender-proxy', function (hooks) {
  let upstream: http.Server | undefined;
  let upstreamRequests: Array<{
    url: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }> = [];

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
    assert.deepEqual(
      JSON.parse(upstreamRequests[0]?.body || '{}'),
      {
        data: {
          ...payload.data,
          attributes: {
            ...payload.data.attributes,
            userId: '@someone:localhost',
            permissions: {
              'http://localhost:4201/base/': ['read', 'write'],
            },
          },
        },
      },
      'forwards request payload with derived permissions and userId',
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

  test('returns forbidden when user has no realm permissions', async function () {
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
      }),
    );
    app.use(router.routes());

    let token = createJWT(
      { user: '@someone:localhost', sessionRoom: '!room:localhost' },
      realmSecretSeed,
    );

    await supertest(app.callback())
      .post('/_prerender-card')
      .set('Authorization', `Bearer ${token}`)
      .send({
        data: {
          attributes: { realm: 'http://localhost:4201/base/' },
        },
      })
      .expect(403);
  });
});
