import { module, test } from 'qunit';
import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import { basename } from 'path';

import {
  setupPermissionedRealmCached,
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
import { toAffinityKey } from '../prerender/affinity';
import { Deferred } from '@cardstack/runtime-common';

module(basename(__filename), function () {
  module('Prerender server', function (hooks) {
    let request: SuperTest<Test>;
    let prerenderer: Prerenderer;
    const testUserId = '@jade:localhost';
    let draining = false;
    let realmURL = new URL('http://127.0.0.1:4444/test/');

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      permissions: { [testUserId]: ['read', 'write', 'realm-owner'] },
      realmURL,
      fileSystem: {
        'pet.gts': `
          import { CardDef, field, contains, StringField } from '@cardstack/base/card-api';
          import { Component } from '@cardstack/base/card-api';
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
        'command-runner-test.gts': `
          import { Command } from '@cardstack/runtime-common';
          import {
            CardDef,
            field,
            contains,
            StringField,
          } from '@cardstack/base/card-api';

          export class CommandResult extends CardDef {
            static displayName = 'CommandResult';
            @field message = contains(StringField);
          }

          export class SayHelloCommand extends Command<
            undefined,
            typeof CommandResult
          > {
            static displayName = 'SayHelloCommand';
            async getInputType() {
              return undefined;
            }
            protected async run(): Promise<CommandResult> {
              return new CommandResult({ message: 'hello from command' });
            }
          }

          export class SayGoodbyeCommand extends Command<
            undefined,
            typeof CommandResult
          > {
            static displayName = 'SayGoodbyeCommand';
            async getInputType() {
              return undefined;
            }
            protected async run(): Promise<CommandResult> {
              return new CommandResult({ message: 'goodbye from command' });
            }
          }

          export class ThrowErrorCommand extends Command<
            undefined,
            typeof CommandResult
          > {
            static displayName = 'ThrowErrorCommand';
            async getInputType() {
              return undefined;
            }
            protected async run(): Promise<CommandResult> {
              throw new Error('command exploded');
            }
          }
        `,
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
      let url = `${realmURL.href}1`;
      let permissions = {
        [realmURL.href]: ['read', 'write', 'realm-owner'] as (
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
              realm: realmURL.href,
              affinityType: 'realm',
              affinityValue: realmURL.href,
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
        res.body.data.attributes.deps?.includes(`${realmURL.href}pet`),
        `${realmURL.href}pet is a dep`,
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
        res.body.meta?.pool?.affinityType,
        'realm',
        'pool affinity type ok',
      );
      assert.strictEqual(
        res.body.meta?.pool?.affinityValue,
        realmURL.href,
        'pool affinity value ok',
      );
    });

    test('it handles module prerender request', async function (assert) {
      let url = `${realmURL.href}pet.gts`;
      let permissions = {
        [realmURL.href]: ['read', 'write', 'realm-owner'] as (
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
              realm: realmURL.href,
              affinityType: 'realm',
              affinityValue: realmURL.href,
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

    module('run-command', function () {
      test('it handles run-command request', async function (assert) {
        let permissions = {
          [realmURL.href]: ['read', 'write', 'realm-owner'] as (
            | 'read'
            | 'write'
            | 'realm-owner'
          )[],
        };
        let auth = testCreatePrerenderAuth(testUserId, permissions);
        let command = `${realmURL.href}command-runner-test/SayHelloCommand`;
        let res = await request
          .post('/run-command')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .send({
            data: {
              type: 'command-request',
              attributes: {
                realm: realmURL.href,
                auth,
                command,
                affinityType: 'user',
                affinityValue: testUserId,
              },
            },
          });

        assert.strictEqual(res.status, 201, 'HTTP 201');
        assert.strictEqual(res.body.data.type, 'command-result', 'type ok');
        assert.strictEqual(res.body.data.id, command, 'id is command');
        assert.strictEqual(
          res.body.data.attributes.status,
          'ready',
          'command status ready',
        );
        assert.notOk(res.body.data.attributes.error, 'no command error');
        let cardResultString = res.body.data.attributes.cardResultString;
        assert.strictEqual(
          typeof cardResultString,
          'string',
          'returns serialized command card',
        );
        assert.notOk(
          res.body.data.attributes.cardResult,
          'does not return raw card instance over HTTP',
        );
        assert.ok(cardResultString.length > 0, 'serialized card is non-empty');
        assert.ok(
          cardResultString.includes('hello from command'),
          'serialized card includes command output',
        );
        assert.ok(res.body.meta?.timing?.totalMs >= 0, 'has timing');
        assert.ok(res.body.meta?.pool?.pageId, 'has pool.pageId');
      });

      test('it captures run-command error state', async function (assert) {
        let permissions = {
          [realmURL.href]: ['read', 'write', 'realm-owner'] as (
            | 'read'
            | 'write'
            | 'realm-owner'
          )[],
        };
        let auth = testCreatePrerenderAuth(testUserId, permissions);
        let command = `${realmURL.href}command-runner-test/ThrowErrorCommand`;
        let res = await request
          .post('/run-command')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .send({
            data: {
              type: 'command-request',
              attributes: {
                realm: realmURL.href,
                auth,
                command,
                affinityType: 'user',
                affinityValue: testUserId,
              },
            },
          });

        assert.strictEqual(res.status, 201, 'HTTP 201');
        assert.strictEqual(res.body.data.type, 'command-result', 'type ok');
        assert.strictEqual(
          res.body.data.attributes.status,
          'error',
          'command status error',
        );
        assert.ok(
          (res.body.data.attributes.error as string).includes(
            'command exploded',
          ),
          'returns command error message',
        );
        assert.notOk(
          res.body.data.attributes.cardResultString,
          'no serialized card result on command error',
        );
        assert.notOk(
          res.body.data.attributes.cardResult,
          'no raw card instance on command error',
        );
        assert.ok(res.body.meta?.timing?.totalMs >= 0, 'has timing');
        assert.ok(res.body.meta?.pool?.pageId, 'has pool.pageId');
      });

      test('concurrent commands each return their own correct result', async function (assert) {
        let permissions = {
          [realmURL.href]: ['read', 'write', 'realm-owner'] as (
            | 'read'
            | 'write'
            | 'realm-owner'
          )[],
        };
        let auth = testCreatePrerenderAuth(testUserId, permissions);
        let helloCommand = `${realmURL.href}command-runner-test/SayHelloCommand`;
        let goodbyeCommand = `${realmURL.href}command-runner-test/SayGoodbyeCommand`;

        let [resultA, resultB, resultC] = await Promise.all([
          prerenderer.runCommand({
            userId: '@user-a:localhost',
            auth,
            command: helloCommand,
            opts: { simulateTimeoutMs: 500 },
          }),
          prerenderer.runCommand({
            userId: '@user-b:localhost',
            auth,
            command: goodbyeCommand,
            opts: { simulateTimeoutMs: 500 },
          }),
          prerenderer.runCommand({
            userId: '@user-c:localhost',
            auth,
            command: helloCommand,
            opts: { simulateTimeoutMs: 500 },
          }),
        ]);

        assert.strictEqual(
          resultA.response.status,
          'ready',
          'command A (hello) returns ready despite concurrent nonce increments',
        );
        assert.strictEqual(
          resultB.response.status,
          'ready',
          'command B (goodbye) returns ready despite concurrent nonce increments',
        );
        assert.strictEqual(
          resultC.response.status,
          'ready',
          'command C (hello) returns ready despite concurrent nonce increments',
        );

        assert.ok(
          resultA.response.cardResultString?.includes('hello from command'),
          'command A payload contains "hello from command"',
        );
        assert.ok(
          resultB.response.cardResultString?.includes('goodbye from command'),
          'command B payload contains "goodbye from command"',
        );
        assert.ok(
          resultC.response.cardResultString?.includes('hello from command'),
          'command C payload contains "hello from command"',
        );

        assert.notOk(resultA.response.error, 'command A has no error');
        assert.notOk(resultB.response.error, 'command B has no error');
        assert.notOk(resultC.response.error, 'command C has no error');
      });

      test('it returns unusable status when command times out', async function (assert) {
        let permissions = {
          [realmURL.href]: ['read', 'write', 'realm-owner'] as (
            | 'read'
            | 'write'
            | 'realm-owner'
          )[],
        };
        let auth = testCreatePrerenderAuth(testUserId, permissions);
        let command = `${realmURL.href}command-runner-test/SayHelloCommand`;
        let result = await prerenderer.runCommand({
          userId: testUserId,
          auth,
          command,
          opts: { timeoutMs: 1, simulateTimeoutMs: 25 },
        });

        assert.strictEqual(
          result.response.status,
          'unusable',
          'timed-out command returns unusable status',
        );
        assert.ok(
          result.response.error?.includes('Render timed-out'),
          `error message mentions timeout (got: ${result.response.error})`,
        );
        assert.true(result.pool.timedOut, 'pool.timedOut is set');
      });
    });

    test('reports draining status when shutting down', async function (assert) {
      draining = true;
      const permissions: Record<string, ('read' | 'write' | 'realm-owner')[]> =
        { [realmURL.href]: ['read', 'write', 'realm-owner'] };
      let auth = testCreatePrerenderAuth(testUserId, permissions);
      let res = await request
        .post('/prerender-card')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'prerender-request',
            attributes: {
              url: `${realmURL.href}drain`,
              auth,
              realm: realmURL.href,
              affinityType: 'realm',
              affinityValue: realmURL.href,
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

    test('tracks warmed affinities for heartbeat', async function (assert) {
      let beforeWarm = prerenderer.getWarmAffinities();
      let url = `${realmURL.href}2`;
      const permissions: Record<string, ('read' | 'write' | 'realm-owner')[]> =
        { [realmURL.href]: ['read', 'write', 'realm-owner'] };
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
              realm: realmURL.href,
              affinityType: 'realm',
              affinityValue: realmURL.href,
            },
          },
        });

      assert.true(
        prerenderer.getWarmAffinities().includes(
          toAffinityKey({
            affinityType: 'realm',
            affinityValue: realmURL.href,
          }),
        ),
        'warm affinities include prerendered realm affinity',
      );
      assert.true(
        prerenderer.getWarmAffinities().length >= beforeWarm.length,
        'warm affinity list does not shrink',
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
          affinityType: 'realm',
          affinityValue: realmURL.href,
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
        [realmURL.href]: ['read', 'write', 'realm-owner'],
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
              url: `${realmURL.href}drain-midflight`,
              auth,
              realm: realmURL.href,
              affinityType: 'realm',
              affinityValue: realmURL.href,
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
          { [realmURL.href]: ['read', 'write', 'realm-owner'] };
        let auth = testCreatePrerenderAuth(testUserId, permissions);
        let res = await localRequest
          .post('/prerender-card')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .send({
            data: {
              type: 'prerender-request',
              attributes: {
                url: `${realmURL.href}drain-unhandled`,
                auth,
                realm: realmURL.href,
                affinityType: 'realm',
                affinityValue: realmURL.href,
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
