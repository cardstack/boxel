import { module, test } from 'qunit';
import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import { basename } from 'path';

import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  matrixURL,
  testRealmHref,
  testCreatePrerenderAuth,
} from './helpers';
import { buildPrerenderApp } from '../prerender/prerender-app';
import type { Prerenderer } from '../prerender';
import { baseCardRef } from '@cardstack/runtime-common';
import {
  PRERENDER_SERVER_DRAINING_STATUS_CODE,
  PRERENDER_SERVER_STATUS_DRAINING,
  PRERENDER_SERVER_STATUS_HEADER,
} from '../prerender/prerender-constants';
import { Deferred } from '@cardstack/runtime-common';

module(basename(__filename), function () {
  module('Prerender server', function (hooks) {
    let request: SuperTest<Test>;
    let prerenderer: Prerenderer;
    const testUserId = '@jade:localhost';
    let draining = false;

    setupBaseRealmServer(hooks, matrixURL);

    setupPermissionedRealm(hooks, {
      mode: 'before',
      permissions: { [testUserId]: ['read', 'write', 'realm-owner'] },
      fileSystem: {
        'pet.gts': `
          import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
          import { Component } from 'https://cardstack.com/base/card-api';
          export class Pet extends CardDef {
            static displayName = 'Pet';
            @field name = contains(StringField);
            static embedded = <template>{{@fields.name}} is a good pet</template>
          }
        `,
        '1.json': {
          data: {
            attributes: { name: 'Maple' },
            meta: {
              adoptsFrom: { module: './pet', name: 'Pet' },
            },
          },
        },
      },
    });

    hooks.before(function () {
      draining = false;
      let built = buildPrerenderApp({
        serverURL: 'http://127.0.0.1:4221',
        isDraining: () => draining,
      });
      prerenderer = built.prerenderer;
      request = supertest(built.app.callback());
    });

    hooks.after(async function () {
      await prerenderer.stop();
    });

    test('liveness', async function (assert) {
      let res = await request.get('/').set('Accept', 'application/json');
      assert.strictEqual(res.status, 200, 'HTTP 200');
      assert.deepEqual(res.body, { ready: true }, 'ready payload');
    });

    test('it handles prerender request', async function (assert) {
      let url = `${testRealmHref}1`;
      let permissions = {
        [testRealmHref]: ['read', 'write', 'realm-owner'] as (
          | 'read'
          | 'write'
          | 'realm-owner'
        )[],
      };
      let auth = testCreatePrerenderAuth(testUserId, permissions);
      let res = await request
        .post('/prerender-card')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'prerender-request',
            attributes: {
              url,
              auth,
              realm: testRealmHref,
            },
          },
        });

      assert.strictEqual(res.status, 201, 'HTTP 201');
      assert.strictEqual(res.body.data.type, 'prerender-result', 'type ok');
      assert.strictEqual(res.body.data.id, url, 'id is url');
      assert.deepEqual(
        res.body.data.attributes.displayNames,
        ['Pet', 'Card'],
        'displayNames ok',
      );
      assert.strictEqual(
        res.body.data.attributes.searchDoc?.name,
        'Maple',
        'searchDoc.name ok',
      );
      assert.strictEqual(
        res.body.data.attributes.searchDoc?._cardType,
        'Pet',
        'searchDoc._cardType ok',
      );
      assert.ok(
        /Maple/.test(res.body.data.attributes.isolatedHTML ?? ''),
        'isolatedHTML contains the instance title',
      );
      // spot check a few deps, as the whole list is overwhelming...
      assert.ok(
        res.body.data.attributes.deps?.includes(baseCardRef.module),
        `${baseCardRef.module} is a dep`,
      );
      assert.ok(
        res.body.data.attributes.deps?.includes(`${testRealmHref}pet`),
        `${testRealmHref}pet is a dep`,
      );
      assert.ok(
        (res.body.data.attributes.deps as string[]).find((d) =>
          d.match(
            /^https:\/\/cardstack.com\/base\/card-api\.gts\..*glimmer-scoped\.css$/,
          ),
        ),
        `glimmer scoped css from ${baseCardRef.module} is a dep`,
      );
      assert.ok(res.body.meta?.timing?.totalMs >= 0, 'has timing');
      assert.ok(res.body.meta?.pool?.pageId, 'has pool.pageId');
      assert.false(res.body.meta?.pool?.evicted, 'pool.evicted defaults false');
      assert.false(
        res.body.meta?.pool?.timedOut,
        'pool.timedOut defaults false',
      );
      assert.strictEqual(
        res.body.meta?.pool?.realm,
        testRealmHref,
        'pool realm ok',
      );
    });

    test('it handles module prerender request', async function (assert) {
      let url = `${testRealmHref}pet.gts`;
      let permissions = {
        [testRealmHref]: ['read', 'write', 'realm-owner'] as (
          | 'read'
          | 'write'
          | 'realm-owner'
        )[],
      };
      let auth = testCreatePrerenderAuth(testUserId, permissions);
      let res = await request
        .post('/prerender-module')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'prerender-module-request',
            attributes: {
              url,
              auth,
              realm: testRealmHref,
            },
          },
        });

      assert.strictEqual(res.status, 201, 'HTTP 201');
      assert.strictEqual(
        res.body.data.type,
        'prerender-module-result',
        'type ok',
      );
      assert.strictEqual(res.body.data.id, url, 'id is module url');
      assert.strictEqual(
        res.body.data.attributes.status,
        'ready',
        'module status ready',
      );
      assert.false(
        res.body.data.attributes.isShimmed,
        'module not shimmed by default',
      );
      assert.true(
        Object.keys(res.body.data.attributes.definitions || {}).length > 0,
        'definitions captured',
      );
      assert.ok(res.body.meta?.timing?.totalMs >= 0, 'has timing meta');
      assert.ok(res.body.meta?.pool?.pageId, 'has pool.pageId');
    });

    test('reports draining status when shutting down', async function (assert) {
      draining = true;
      const permissions: Record<string, ('read' | 'write' | 'realm-owner')[]> =
        { [testRealmHref]: ['read', 'write', 'realm-owner'] };
      let auth = testCreatePrerenderAuth(testUserId, permissions);
      let res = await request
        .post('/prerender-card')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'prerender-request',
            attributes: {
              url: `${testRealmHref}drain`,
              auth,
              realm: testRealmHref,
            },
          },
        });

      assert.strictEqual(
        res.status,
        PRERENDER_SERVER_DRAINING_STATUS_CODE,
        'returns draining status code',
      );
      assert.strictEqual(
        res.headers[PRERENDER_SERVER_STATUS_HEADER.toLowerCase()],
        PRERENDER_SERVER_STATUS_DRAINING,
        'sets draining header',
      );
      draining = false;
    });

    test('HEAD reflects draining state', async function (assert) {
      draining = true;
      let res = await request.head('/').set('Accept', 'application/json');
      assert.strictEqual(
        res.status,
        PRERENDER_SERVER_DRAINING_STATUS_CODE,
        'HEAD returns draining status',
      );
      assert.strictEqual(
        res.headers[PRERENDER_SERVER_STATUS_HEADER.toLowerCase()],
        PRERENDER_SERVER_STATUS_DRAINING,
        'HEAD sets draining header',
      );
      draining = false;
    });

    test('tracks warmed realms for heartbeat', async function (assert) {
      let beforeWarm = prerenderer.getWarmRealms();
      let url = `${testRealmHref}2`;
      const permissions: Record<string, ('read' | 'write' | 'realm-owner')[]> =
        { [testRealmHref]: ['read', 'write', 'realm-owner'] };
      let auth = testCreatePrerenderAuth(testUserId, permissions);
      await request
        .post('/prerender-card')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'prerender-request',
            attributes: {
              url,
              auth,
              realm: testRealmHref,
            },
          },
        });

      assert.true(
        prerenderer.getWarmRealms().includes(testRealmHref),
        'warm realms include prerendered realm',
      );
      assert.true(
        prerenderer.getWarmRealms().length >= beforeWarm.length,
        'warm realm list does not shrink',
      );
    });

    test('responds draining immediately when shutdown begins during an in-flight prerender', async function (assert) {
      let localDraining = false;
      let drainingDeferred = new Deferred<void>();
      let built = buildPrerenderApp({
        serverURL: 'http://127.0.0.1:4222',
        isDraining: () => localDraining,
        drainingPromise: drainingDeferred.promise,
      });
      let localRequest = supertest(built.app.callback());

      let execDeferred = new Deferred<void>();
      let stubResponse = {
        response: { ok: true },
        timings: { launchMs: 0, renderMs: 0 },
        pool: {
          pageId: 'p',
          realm: testRealmHref,
          reused: false,
          evicted: false,
          timedOut: false,
        },
      };
      let originalPrerender = (built.prerenderer as any).prerenderCard;
      (built.prerenderer as any).prerenderCard = async () => {
        await execDeferred.promise;
        return stubResponse;
      };

      let permissions: Record<string, ('read' | 'write' | 'realm-owner')[]> = {
        [testRealmHref]: ['read', 'write', 'realm-owner'],
      };
      let auth = testCreatePrerenderAuth(testUserId, permissions);
      let resPromise = localRequest
        .post('/prerender-card')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'prerender-request',
            attributes: {
              url: `${testRealmHref}drain-midflight`,
              auth,
              realm: testRealmHref,
            },
          },
        });

      // Allow handler to start by yielding once inside execute
      await Promise.resolve();
      // simulate shutdown signal while prerender is in progress (after handler start)
      localDraining = true;
      drainingDeferred.fulfill();

      let res = await resPromise;
      assert.strictEqual(
        res.status,
        PRERENDER_SERVER_DRAINING_STATUS_CODE,
        'returns draining status code during in-flight prerender',
      );
      assert.strictEqual(
        res.headers[PRERENDER_SERVER_STATUS_HEADER.toLowerCase()],
        PRERENDER_SERVER_STATUS_DRAINING,
        'sets draining header during in-flight prerender',
      );

      // clean up
      execDeferred.fulfill();
      (built.prerenderer as any).prerenderCard = originalPrerender;
      await built.prerenderer.stop();
    });

    test('draining race does not leak unhandled rejection from execute', async function (assert) {
      let unhandled = 0;
      let onUnhandled = () => unhandled++;
      process.on('unhandledRejection', onUnhandled);
      try {
        let built = buildPrerenderApp({
          serverURL: 'http://127.0.0.1:4223',
          isDraining: () => true,
          drainingPromise: Promise.resolve(),
        });
        let localRequest = supertest(built.app.callback());
        let originalPrerender = (built.prerenderer as any).prerenderCard;
        (built.prerenderer as any).prerenderCard = async () => {
          throw new Error('boom');
        };

        let permissions: Record<string, ('read' | 'write' | 'realm-owner')[]> =
          { [testRealmHref]: ['read', 'write', 'realm-owner'] };
        let auth = testCreatePrerenderAuth(testUserId, permissions);
        let res = await localRequest
          .post('/prerender-card')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .send({
            data: {
              type: 'prerender-request',
              attributes: {
                url: `${testRealmHref}drain-unhandled`,
                auth,
                realm: testRealmHref,
              },
            },
          });

        assert.strictEqual(res.status, PRERENDER_SERVER_DRAINING_STATUS_CODE);
        assert.strictEqual(
          res.headers[PRERENDER_SERVER_STATUS_HEADER.toLowerCase()],
          PRERENDER_SERVER_STATUS_DRAINING,
        );

        // allow promise rejection to settle
        await Promise.resolve();
        assert.strictEqual(unhandled, 0, 'no unhandled rejections raised');

        (built.prerenderer as any).prerenderCard = originalPrerender;
        await built.prerenderer.stop();
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });
});
