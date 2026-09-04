import QUnit from 'qunit';
const { module, test } = QUnit;
import Koa from 'koa';
import Router from '@koa/router';
import supertest from 'supertest';
import { basename } from 'path';
import type { DBAdapter, Prerenderer } from '@cardstack/runtime-common';
import type { RenderRouteOptions } from '@cardstack/runtime-common';

import handlePrerenderProxy from '../handlers/handle-prerender-proxy.ts';
import { jwtMiddleware } from '../middleware/index.ts';
import { createJWT } from '../utils/jwt.ts';
import { realmSecretSeed } from './helpers/index.ts';
import { buildCreatePrerenderAuth } from '../prerender/auth.ts';
import { verifyJWT } from '../jwt.ts';

module(basename(import.meta.filename), function () {
  module('prerender proxy', function () {
    let createPrerenderAuth = buildCreatePrerenderAuth(realmSecretSeed);
    // Only consulted to resolve a realm's `users` grant; the tests that
    // exercise one stub the profile lookup, so it is never dialed for real.
    let matrixURL = 'http://localhost:8008/';

    function makeDbAdapter(rows: any[]): DBAdapter {
      return {
        kind: 'pg',
        async notify() {},
        isClosed: false,
        async execute() {
          return rows;
        },
        async close() {},
        async getColumnNames() {
          return [];
        },
        async withWriteLock(_url, fn) {
          return await fn(undefined);
        },
        async withUserCostLock(_userId, fn) {
          return await fn();
        },
      };
    }

    function makePrerenderer() {
      let renderCalls: Array<{
        kind: 'module' | 'visit' | 'command';
        args: {
          affinityType?: 'realm' | 'user';
          affinityValue?: string;
          realm?: string;
          userId?: string;
          url?: string;
          auth: string;
          command?: string;
          commandInput?: Record<string, unknown> | null;
          renderOptions?: RenderRouteOptions;
        };
      }> = [];

      let prerenderer: Prerenderer = {
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
        async prerenderVisit(args) {
          renderCalls.push({ kind: 'visit', args });
          let response: any = {};
          if (args.renderOptions?.cardRender) {
            response.card = {
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
              markdown: null,
            };
          }
          if (args.renderOptions?.fileExtract) {
            response.fileExtract = {
              id: args.url,
              nonce: 'nonce',
              status: 'ready',
              searchDoc: { url: args.url, title: 'through proxy' },
              deps: [],
            };
          }
          if (args.renderOptions?.fileRender) {
            response.fileRender = {
              isolatedHTML: null,
              headHTML: null,
              atomHTML: null,
              embeddedHTML: null,
              fittedHTML: null,
              iconHTML: null,
              markdown: null,
            };
          }
          return response;
        },
        async runCommand(args) {
          renderCalls.push({ kind: 'command', args });
          return {
            status: 'ready',
            cardResultString: null,
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
        jwtMiddleware(realmSecretSeed, dbAdapter),
        handlePrerenderProxy({
          kind: 'card',
          prerenderer,
          dbAdapter,
          matrixURL,
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
              markdown: null,
            },
          },
        },
        'returns prerender response body',
      );
      assert.deepEqual(renderCalls.length, 1, 'invokes prerenderer once');
      assert.strictEqual(renderCalls[0]?.kind, 'visit');
      assert.deepEqual(
        renderCalls[0]?.args,
        {
          affinityType: 'realm',
          affinityValue: realm,
          realm,
          url: cardURL,
          auth: renderCalls[0]?.args.auth,
          renderOptions: { cardRender: true },
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
        jwtMiddleware(realmSecretSeed, makeDbAdapter([])),
        handlePrerenderProxy({
          kind: 'card',
          prerenderer: undefined,
          dbAdapter: makeDbAdapter([]),
          matrixURL,
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
        jwtMiddleware(realmSecretSeed, makeDbAdapter([])),
        handlePrerenderProxy({
          kind: 'card',
          prerenderer,
          dbAdapter: makeDbAdapter([]),
          matrixURL,
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
        jwtMiddleware(realmSecretSeed, makeDbAdapter([])),
        handlePrerenderProxy({
          kind: 'card',
          prerenderer,
          dbAdapter: makeDbAdapter([]), // no permissions
          matrixURL,
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
        jwtMiddleware(realmSecretSeed, dbAdapter),
        handlePrerenderProxy({
          kind: 'card',
          prerenderer,
          dbAdapter,
          matrixURL,
          createPrerenderAuth,
        }),
      );
      router.post(
        '/_prerender-module',
        jwtMiddleware(realmSecretSeed, dbAdapter),
        handlePrerenderProxy({
          kind: 'module',
          prerenderer,
          dbAdapter,
          matrixURL,
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
            kind: 'visit',
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

    // The realm verifies a session token by comparing its permissions claim
    // against the union of the realm's `users` and `*` grants with the
    // caller's own row, and rejects any difference as a PermissionMismatch.
    // These cover the mint side of that contract.
    async function mintPrerenderCard(
      rows: any[],
      user: string,
      realm: string,
    ): Promise<{ status: number; permissions?: string[] }> {
      let { prerenderer, renderCalls } = makePrerenderer();
      let dbAdapter = makeDbAdapter(rows);
      let app = new Koa();
      let router = new Router();
      router.post(
        '/_prerender-card',
        jwtMiddleware(realmSecretSeed, dbAdapter),
        handlePrerenderProxy({
          kind: 'card',
          prerenderer,
          dbAdapter,
          matrixURL,
          createPrerenderAuth,
        }),
      );
      app.use(router.routes());

      let token = createJWT(
        { user, sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );
      let response = await supertest(app.callback())
        .post('/_prerender-card')
        .set('Authorization', `Bearer ${token}`)
        .send({ data: { attributes: { realm, url: `${realm}card` } } });
      if (response.status !== 201) {
        return { status: response.status };
      }
      let sessions = JSON.parse(renderCalls[0]!.args.auth);
      // Sorted because the claim is compared as a set — `checkPermission`
      // sorts both sides before matching.
      let permissions = verifyJWT(
        sessions[realm],
        realmSecretSeed,
      ).permissions?.sort();
      return { status: response.status, permissions };
    }

    // Answers the homeserver's profile lookup with `respond` and counts the
    // lookups, so a test can pin both how a `users` grant resolves and the
    // claim that a realm without one costs no round trip.
    async function withProfileLookups<T>(
      respond: () => Response,
      fn: () => Promise<T>,
    ): Promise<{ result: T; profileRequests: string[] }> {
      let profileRequests: string[] = [];
      let realFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any, init?: any) => {
        let url = typeof input === 'string' ? input : input.url;
        if (url.includes('/_matrix/client/v3/profile/')) {
          profileRequests.push(url);
          return respond();
        }
        return realFetch(input, init);
      }) as typeof fetch;
      try {
        return { result: await fn(), profileRequests };
      } finally {
        globalThis.fetch = realFetch;
      }
    }

    const USERS_GRANT_ROWS = [
      { username: 'users', read: true, write: false, realm_owner: false },
      {
        username: '@someone:localhost',
        read: false,
        write: true,
        realm_owner: false,
      },
    ];

    test('mints the union of the wildcard grant and the caller row', async function (assert) {
      let realm = 'http://example.test/';
      let { result, profileRequests } = await withProfileLookups(
        () => new Response('{}', { status: 404 }),
        () =>
          mintPrerenderCard(
            [
              { username: '*', read: true, write: false, realm_owner: false },
              {
                username: '@someone:localhost',
                read: false,
                write: true,
                realm_owner: false,
              },
            ],
            '@someone:localhost',
            realm,
          ),
      );

      assert.deepEqual(
        result.permissions,
        ['read', 'write'],
        "wildcard read is unioned with the row's write",
      );
      assert.deepEqual(
        profileRequests,
        [],
        'a realm with no users grant costs no homeserver round trip',
      );
    });

    test('mints the wildcard grant for a caller with no row of their own', async function (assert) {
      let realm = 'http://example.test/';
      let { permissions } = await mintPrerenderCard(
        [{ username: '*', read: true, write: false, realm_owner: false }],
        '@nobody:localhost',
        realm,
      );

      assert.deepEqual(
        permissions,
        ['read'],
        'a public realm is reachable without an explicit grant',
      );
    });

    test('mints the union of the users grant and the caller row for a registered matrix user', async function (assert) {
      let realm = 'http://example.test/';
      let { result, profileRequests } = await withProfileLookups(
        () =>
          new Response(JSON.stringify({ displayname: 'Someone' }), {
            headers: { 'content-type': 'application/json' },
          }),
        () => mintPrerenderCard(USERS_GRANT_ROWS, '@someone:localhost', realm),
      );

      assert.deepEqual(
        result.permissions,
        ['read', 'write'],
        "the users grant is unioned with the row's write",
      );
      assert.strictEqual(
        profileRequests.length,
        1,
        'resolves the users grant against the homeserver once',
      );
    });

    test('withholds the users grant from an unregistered matrix user', async function (assert) {
      let realm = 'http://example.test/';
      let { result } = await withProfileLookups(
        () => new Response('{}', { status: 404 }),
        () => mintPrerenderCard(USERS_GRANT_ROWS, '@someone:localhost', realm),
      );

      assert.deepEqual(
        result.permissions,
        ['write'],
        "only the caller's own row survives",
      );
    });

    // A homeserver that cannot answer is not evidence the account is absent.
    // Reading it that way would drop the `users` grant and mint a token the
    // realm rejects for its whole lifetime, so the request fails instead.
    test('fails the request when the homeserver cannot resolve the users grant', async function (assert) {
      let realm = 'http://example.test/';
      let { result } = await withProfileLookups(
        () => new Response('upstream boom', { status: 503 }),
        () => mintPrerenderCard(USERS_GRANT_ROWS, '@someone:localhost', realm),
      );

      assert.strictEqual(
        result.status,
        500,
        'answers with an error rather than a token missing the users grant',
      );
      assert.strictEqual(result.permissions, undefined, 'mints nothing');
    });

    test('mints the caller row verbatim when the realm has no shared grants', async function (assert) {
      let realm = 'http://example.test/';
      let { permissions } = await mintPrerenderCard(
        [
          {
            username: '@someone:localhost',
            read: true,
            write: true,
            realm_owner: false,
          },
        ],
        '@someone:localhost',
        realm,
      );

      assert.deepEqual(
        permissions,
        ['read', 'write'],
        'the union of a lone row is the row itself',
      );
    });
  });
});
