import { module, test } from 'qunit';
import Koa from 'koa';
import Router from '@koa/router';
import supertest from 'supertest';
import { basename } from 'path';
import type { DBAdapter, Prerenderer } from '@cardstack/runtime-common';
import type { RenderRouteOptions } from '@cardstack/runtime-common';

import handlePrerenderProxy from '../handlers/handle-prerender-proxy';
import { jwtMiddleware } from '../middleware';
import { createJWT } from '../utils/jwt';
import { realmSecretSeed } from './helpers';
import { buildCreatePrerenderAuth } from '../prerender/auth';
import { verifyJWT } from '../jwt';

module(basename(__filename), function () {
  module('prerender proxy', function () {
    let createPrerenderAuth = buildCreatePrerenderAuth(realmSecretSeed);

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

    function makePrerenderer() {
      let renderCalls: Array<{
        kind: 'card' | 'module' | 'file-extract' | 'file-render';
        args: {
          realm: string;
          url: string;
          auth: string;
          renderOptions?: RenderRouteOptions;
        };
      }> = [];

      let prerenderer: Prerenderer = {
        async prerenderCard(args) {
          renderCalls.push({ kind: 'card', args });
          return {
            serialized: null,
            searchDoc: { url: args.url, cardTitle: 'through proxy' },
            displayNames: ['Proxy Card'],
            deps: [],
            types: [],
            isolatedHTML: `<div>${args.url}</div>`,
            headHTML: null,
            atomHTML: null,
            embeddedHTML: {},
            fittedHTML: {},
            iconHTML: null,
          };
        },
        async prerenderModule(args) {
          renderCalls.push({ kind: 'module', args });
          return {
            id: args.url,
            status: 'ready',
            nonce: 'nonce',
            isShimmed: false,
            lastModified: Date.now(),
            createdAt: Date.now(),
            deps: [],
            definitions: {},
          };
        },
        async prerenderFileExtract(args) {
          renderCalls.push({ kind: 'file-extract', args });
          return {
            id: args.url,
            nonce: 'nonce',
            status: 'ready',
            searchDoc: { url: args.url, title: 'through proxy' },
            deps: [],
          };
        },
        async prerenderFileRender(args) {
          renderCalls.push({ kind: 'file-render', args });
          return {
            isolatedHTML: null,
            headHTML: null,
            atomHTML: null,
            embeddedHTML: null,
            fittedHTML: null,
            iconHTML: null,
          };
        },
      };

      return { prerenderer, renderCalls };
    }

    test('proxies prerender requests to the configured prerenderer', async function (assert) {
      let { prerenderer, renderCalls } = makePrerenderer();
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
          kind: 'card',
          prerenderer,
          dbAdapter,
          createPrerenderAuth,
        }),
      );
      app.use(router.routes());

      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );
      let cardURL = 'http://example/card';
      let realm = 'http://example/';
      let payload = {
        data: {
          attributes: { realm, url: cardURL },
        },
      };

      let response = await supertest(app.callback())
        .post('/_prerender-card')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201);

      assert.deepEqual(
        response.body,
        {
          data: {
            type: 'prerender-result',
            id: cardURL,
            attributes: {
              serialized: null,
              searchDoc: { url: cardURL, cardTitle: 'through proxy' },
              displayNames: ['Proxy Card'],
              deps: [],
              types: [],
              isolatedHTML: `<div>${cardURL}</div>`,
              headHTML: null,
              atomHTML: null,
              embeddedHTML: {},
              fittedHTML: {},
              iconHTML: null,
            },
          },
        },
        'returns prerender response body',
      );
      assert.deepEqual(renderCalls.length, 1, 'invokes prerenderer once');
      assert.strictEqual(renderCalls[0]?.kind, 'card');
      assert.deepEqual(
        renderCalls[0]?.args,
        {
          realm,
          url: cardURL,
          auth: renderCalls[0]?.args.auth,
          renderOptions: undefined,
        },
        'forwards request to prerenderer with derived realm and url',
      );
      let sessions = JSON.parse(renderCalls[0]!.args.auth);
      let tokenClaims = verifyJWT(sessions[realm], realmSecretSeed);
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
        realm,
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
          kind: 'card',
          prerenderer: undefined,
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

    test('returns unauthorized when no token is provided', async function (assert) {
      let { prerenderer } = makePrerenderer();
      let app = new Koa();
      let router = new Router();
      router.post(
        '/_prerender-card',
        jwtMiddleware(realmSecretSeed),
        handlePrerenderProxy({
          kind: 'card',
          prerenderer,
          dbAdapter: makeDbAdapter([]),
          createPrerenderAuth,
        }),
      );
      app.use(router.routes());

      let res = await supertest(app.callback())
        .post('/_prerender-card')
        .send({
          data: {
            attributes: {
              realm: 'http://localhost:4201/base/',
              url: 'http://localhost:4201/base/some-card',
            },
          },
        })
        .expect(401);

      assert.deepEqual(
        res.body.errors,
        ['Missing Authorization header'],
        'responds with unauthorized error when no auth token is present',
      );
    });

    test('returns forbidden when user has no realm permissions', async function (assert) {
      let { prerenderer, renderCalls } = makePrerenderer();
      let app = new Koa();
      let router = new Router();
      router.post(
        '/_prerender-card',
        jwtMiddleware(realmSecretSeed),
        handlePrerenderProxy({
          kind: 'card',
          prerenderer,
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
      assert.deepEqual(renderCalls, [], 'does not call prerenderer');
    });

    test('proxies to prerender server card and module endpoints', async function (assert) {
      let { prerenderer, renderCalls } = makePrerenderer();
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
          kind: 'card',
          prerenderer,
          dbAdapter,
          createPrerenderAuth,
        }),
      );
      router.post(
        '/_prerender-module',
        jwtMiddleware(realmSecretSeed),
        handlePrerenderProxy({
          kind: 'module',
          prerenderer,
          dbAdapter,
          createPrerenderAuth,
        }),
      );
      app.use(router.routes());

      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );

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
        'forwards requests to prerenderer with derived auth info',
      );
    });
  });
});
