import QUnit from 'qunit';
const { module, test } = QUnit;
import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import { basename } from 'path';
import sinon from 'sinon';

import {
  closeServer,
  setupPermissionedRealmCached,
  testCreatePrerenderAuth,
} from './helpers/index.ts';
import {
  buildPrerenderApp,
  createPrerenderHttpServer,
} from '../prerender/prerender-app.ts';
import type { Prerenderer } from '../prerender/index.ts';
import { baseCardRef, rri } from '@cardstack/runtime-common';
import {
  PRERENDER_SERVER_DRAINING_STATUS_CODE,
  PRERENDER_SERVER_STATUS_DRAINING,
  PRERENDER_SERVER_STATUS_HEADER,
} from '../prerender/prerender-constants.ts';
import { toAffinityKey } from '../prerender/affinity.ts';
import { Deferred } from '@cardstack/runtime-common';

// supertest dispatches when its thenable is first awaited. A test that waits on
// something the handler does — a stub reporting itself, a signal from inside a
// dependency — has to send the request first, or nothing is in flight and the
// wait has nothing to wait for. Awaiting the thenable inside an immediately
// invoked async function is what puts it on the wire now while leaving the
// response to be awaited later.
function inFlight<T>(send: () => PromiseLike<T>): Promise<T> {
  return (async () => await send())();
}

module(basename(import.meta.filename), function () {
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
              adoptsFrom: {
                module: rri('./pet'),
                name: 'Pet',
              },
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

    // The hop this file owns in the `renderScope` chain. The scope is what
    // lets a prerender tab tell one job's resident instances from another's,
    // and every hop between `visit-file.ts` and the page destructures it by
    // name — so a hop that drops it fails silently: the render still returns
    // HTML, built from instances the previous job left behind.
    module('renderScope', function () {
      function stubVisit(captured: { attrs: any[] }) {
        return async function (args: any) {
          captured.attrs.push(args);
          return {
            response: {
              card: {
                serialized: null,
                searchDoc: null,
                displayNames: null,
                deps: [],
                types: null,
                isolatedHTML: '<h1>stub</h1>',
                headHTML: null,
                atomHTML: null,
                embeddedHTML: null,
                fittedHTML: null,
                iconHTML: null,
                markdown: null,
              },
            },
            timings: {
              launchMs: 0,
              renderMs: 0,
              waits: {
                semaphoreMs: 0,
                admissionMs: 0,
                tabQueueMs: 0,
                tabStartupMs: 0,
                tabProbeMs: 0,
              },
            },
            pool: {
              pageId: 'page-stub',
              affinityType: 'realm' as const,
              affinityValue: realmURL.href,
              reused: false,
              evicted: false,
              timedOut: false,
            },
          };
        };
      }

      async function postVisit(attributes: Record<string, unknown>) {
        return await request
          .post('/prerender-visit')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .send({
            data: {
              type: 'prerender-visit-request',
              attributes: {
                url: `${realmURL.href}1.json`,
                auth: testCreatePrerenderAuth(testUserId, {
                  [realmURL.href]: ['read', 'write', 'realm-owner'],
                }),
                realm: realmURL.href,
                affinityType: 'realm',
                affinityValue: realmURL.href,
                renderOptions: { cardRender: true },
                ...attributes,
              },
            },
          });
      }

      test('a renderScope on the request reaches the prerenderer', async function (assert) {
        let captured: { attrs: any[] } = { attrs: [] };
        let original = prerenderer.prerenderVisit;
        prerenderer.prerenderVisit = stubVisit(captured) as any;
        try {
          let res = await postVisit({
            renderScope: `${realmURL.href}@4242`,
          });
          assert.strictEqual(res.status, 201, 'HTTP 201');
          assert.strictEqual(
            captured.attrs[0]?.renderScope,
            `${realmURL.href}@4242`,
            'the scope off the request body is forwarded to the visit',
          );
        } finally {
          prerenderer.prerenderVisit = original;
        }
      });

      test('a blank or non-string renderScope is dropped rather than forwarded', async function (assert) {
        // The page falls back to the job id when it sees no scope, which is
        // narrower and so never unsound. Forwarding `''` or a number would
        // instead key every such visit to one shared bucket.
        let original = prerenderer.prerenderVisit;
        for (let scope of ['', '   ', 42, null]) {
          let captured: { attrs: any[] } = { attrs: [] };
          prerenderer.prerenderVisit = stubVisit(captured) as any;
          try {
            let res = await postVisit({ renderScope: scope });
            assert.strictEqual(res.status, 201, `HTTP 201 for ${scope}`);
            assert.strictEqual(
              captured.attrs[0]?.renderScope,
              undefined,
              `${JSON.stringify(scope)} is not forwarded as a scope`,
            );
          } finally {
            prerenderer.prerenderVisit = original;
          }
        }
      });
    });

    test('screenshot route rejects an out-of-bounds captureSpec by field name', async function (assert) {
      // This route is its own HTTP surface: without the shared bounds check
      // an oversize viewport would reach page.setViewport on a pooled page
      // with none of the realm-server's cost caps applied.
      let res = await request
        .post('/prerender-screenshot')
        .send({
          data: {
            attributes: {
              url: 'http://example.test/card',
              realm: 'http://example.test/',
              auth: '{}',
              affinityType: 'realm',
              affinityValue: 'http://example.test/',
              format: 'isolated',
              captureSpec: { viewport: { width: 1_000_000, height: 600 } },
            },
          },
        })
        .set('Accept', 'application/json');
      assert.strictEqual(res.status, 400, 'rejected before any render work');
      assert.true(
        res.body.errors?.[0]?.message?.includes('captureSpec.viewport.width'),
        `names the offending field: ${JSON.stringify(res.body)}`,
      );
    });

    test('screenshot route rejects an unknown captureSpec field by name', async function (assert) {
      let res = await request
        .post('/prerender-screenshot')
        .send({
          data: {
            attributes: {
              url: 'http://example.test/card',
              realm: 'http://example.test/',
              auth: '{}',
              affinityType: 'realm',
              affinityValue: 'http://example.test/',
              format: 'isolated',
              captureSpec: { fullpage: true },
            },
          },
        })
        .set('Accept', 'application/json');
      assert.strictEqual(res.status, 400, 'rejected before any render work');
      assert.true(
        res.body.errors?.[0]?.message?.includes('captureSpec.fullpage'),
        `names the offending field: ${JSON.stringify(res.body)}`,
      );
    });

    test('liveness', async function (assert) {
      let res = await request.get('/').set('Accept', 'application/json');
      assert.strictEqual(res.status, 200, 'HTTP 200');
      assert.true(res.body.ready, 'ready payload');

      // The field names are pinned because they are read by name outside
      // this codebase: the heap dashboard extracts each one out of the
      // `prerender-heap` log line with a regex, and a rename here would
      // leave those panels silently empty rather than failing anywhere.
      // The values themselves vary per run, so assert only the shape and
      // the one relationship that always has to hold.
      let memory = res.body.memory;
      assert.deepEqual(
        Object.keys(memory).sort(),
        ['externalMB', 'heapLimitMB', 'heapTotalMB', 'heapUsedMB', 'rssMB'],
        'memory reports the expected fields',
      );
      for (let [field, value] of Object.entries(memory)) {
        assert.strictEqual(typeof value, 'number', `${field} is a number`);
      }
      assert.true(memory.heapUsedMB > 0, 'heap in use is positive');
      assert.true(
        memory.heapUsedMB <= memory.heapLimitMB,
        'heap in use is within the limit',
      );
    });

    test('heap snapshot route is off unless the flag is set', async function (assert) {
      // The resting state, and the only one safe to assert in a suite: with
      // the flag set this route stops the world for as long as it takes to
      // serialise the heap. The guard returns before any of that, so this
      // costs microseconds.
      delete process.env.PRERENDER_HEAP_SNAPSHOT;
      let res = await request
        .post('/heap-snapshot')
        .set('Accept', 'application/json');
      assert.strictEqual(res.status, 404, 'not found while disabled');
      assert.strictEqual(
        res.body.status,
        'disabled',
        'body names why, so an operator who gets a 404 knows to set the flag',
      );
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
        .post('/prerender-visit')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'prerender-visit-request',
            attributes: {
              url,
              auth,
              realm: realmURL.href,
              affinityType: 'realm',
              affinityValue: realmURL.href,
              renderOptions: { cardRender: true },
            },
          },
        });

      assert.strictEqual(res.status, 201, 'HTTP 201');
      assert.strictEqual(
        res.body.data.type,
        'prerender-visit-result',
        'type ok',
      );
      assert.strictEqual(res.body.data.id, url, 'id is url');
      let card = res.body.data.attributes.card;
      assert.deepEqual(card.displayNames, ['Pet', 'Card'], 'displayNames ok');
      assert.strictEqual(card.searchDoc?.name, 'Maple', 'searchDoc.name ok');
      assert.strictEqual(
        card.searchDoc?._cardType,
        'Pet',
        'searchDoc._cardType ok',
      );
      assert.ok(
        /Maple/.test(card.isolatedHTML ?? ''),
        'isolatedHTML contains the instance title',
      );
      // spot check a few deps, as the whole list is overwhelming...
      assert.ok(
        card.deps?.includes(baseCardRef.module),
        `${baseCardRef.module} is a dep`,
      );
      assert.ok(
        card.deps?.includes(`${realmURL.href}pet`),
        `${realmURL.href}pet is a dep`,
      );
      assert.ok(
        (card.deps as string[]).find((d) =>
          d.match(/^@cardstack\/base\/card-api\.gts\..*glimmer-scoped\.css$/),
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
        .post('/prerender-visit')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'prerender-visit-request',
            attributes: {
              url: `${realmURL.href}drain`,
              auth,
              realm: realmURL.href,
              affinityType: 'realm',
              affinityValue: realmURL.href,
              renderOptions: { cardRender: true },
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
        .post('/prerender-visit')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'prerender-visit-request',
            attributes: {
              url,
              auth,
              realm: realmURL.href,
              affinityType: 'realm',
              affinityValue: realmURL.href,
              renderOptions: { cardRender: true },
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

    test('heartbeat capacity tracks the live pool capacity', async function (assert) {
      let previousMin = process.env.PRERENDER_PAGE_POOL_MIN;
      let previousMax = process.env.PRERENDER_PAGE_POOL_MAX;
      let previousManagerURL = process.env.PRERENDER_MANAGER_URL;
      let previousInterval = process.env.PRERENDER_HEARTBEAT_INTERVAL_MS;
      let originalFetch = global.fetch;
      let fetchStub = sinon
        .stub(global, 'fetch')
        .resolves(new Response(null, { status: 204 }));
      process.env.PRERENDER_PAGE_POOL_MIN = '2';
      process.env.PRERENDER_PAGE_POOL_MAX = '6';
      process.env.PRERENDER_MANAGER_URL = 'http://127.0.0.1:4999';
      process.env.PRERENDER_HEARTBEAT_INTERVAL_MS = '60000';

      let server = createPrerenderHttpServer({
        maxPages: 5,
        fatalExitOnUncaught: false,
      });

      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        let heartbeatCall = fetchStub.getCalls().find((call) => {
          let raw = call.args[0];
          let url = typeof raw === 'string' ? raw : raw.toString();
          return url.endsWith('/prerender-servers');
        });
        assert.ok(heartbeatCall, 'heartbeat posted to the prerender manager');
        let body = JSON.parse(String(heartbeatCall!.args[1]?.body));
        assert.strictEqual(
          body.data.attributes.capacity,
          2,
          'heartbeat reports PRERENDER_PAGE_POOL_MIN as the initial live capacity',
        );
      } finally {
        await closeServer(server);
        fetchStub.restore();
        global.fetch = originalFetch;

        if (previousMin === undefined) {
          delete process.env.PRERENDER_PAGE_POOL_MIN;
        } else {
          process.env.PRERENDER_PAGE_POOL_MIN = previousMin;
        }
        if (previousMax === undefined) {
          delete process.env.PRERENDER_PAGE_POOL_MAX;
        } else {
          process.env.PRERENDER_PAGE_POOL_MAX = previousMax;
        }
        if (previousManagerURL === undefined) {
          delete process.env.PRERENDER_MANAGER_URL;
        } else {
          process.env.PRERENDER_MANAGER_URL = previousManagerURL;
        }
        if (previousInterval === undefined) {
          delete process.env.PRERENDER_HEARTBEAT_INTERVAL_MS;
        } else {
          process.env.PRERENDER_HEARTBEAT_INTERVAL_MS = previousInterval;
        }
      }
    });

    test('reports per-affinity vacancy for warm-vacancy-first routing', async function (assert) {
      let url = `${realmURL.href}1`;
      let permissions: Record<string, ('read' | 'write' | 'realm-owner')[]> = {
        [realmURL.href]: ['read', 'write', 'realm-owner'],
      };
      let auth = testCreatePrerenderAuth(testUserId, permissions);
      // Warm the affinity with a visit.
      await request
        .post('/prerender-visit')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'prerender-visit-request',
            attributes: {
              url,
              auth,
              realm: realmURL.href,
              affinityType: 'realm',
              affinityValue: realmURL.href,
              renderOptions: { cardRender: true },
            },
          },
        });

      let affinityKey = toAffinityKey({
        affinityType: 'realm',
        affinityValue: realmURL.href,
      });
      let snapshot = prerenderer.getVacancySnapshot();
      let entry = snapshot[affinityKey];
      assert.ok(entry, `vacancy snapshot includes ${affinityKey}`);
      assert.true(entry.idle, 'affinity is idle after the visit completes');
      assert.strictEqual(
        entry.tabCount,
        1,
        'affinity owns exactly one tab after a single visit',
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
      let renderEntered = new Deferred<void>();
      let stubResponse = {
        response: { ok: true },
        timings: {
          launchMs: 0,
          renderMs: 0,
          waits: {
            semaphoreMs: 0,
            admissionMs: 0,
            tabQueueMs: 0,
            tabStartupMs: 0,
            tabProbeMs: 0,
          },
        },
        pool: {
          pageId: 'p',
          affinityType: 'realm',
          affinityValue: realmURL.href,
          reused: false,
          evicted: false,
          timedOut: false,
        },
      };
      // `prerenderVisit` is what the route calls. This previously stubbed
      // `prerenderCard`, which is a test helper rather than a method on
      // `Prerenderer` — behind an `as any` cast, so it attached a property
      // nothing reads, and the render this test means to catch mid-flight was
      // never parked.
      let renderCalls = 0;
      let originalPrerender = (built.prerenderer as any).prerenderVisit;
      (built.prerenderer as any).prerenderVisit = async () => {
        renderCalls++;
        renderEntered.fulfill();
        await execDeferred.promise;
        return stubResponse;
      };

      let permissions: Record<string, ('read' | 'write' | 'realm-owner')[]> = {
        [realmURL.href]: ['read', 'write', 'realm-owner'],
      };
      let auth = testCreatePrerenderAuth(testUserId, permissions);
      let resPromise = inFlight(() =>
        localRequest
          .post('/prerender-visit')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .send({
            data: {
              type: 'prerender-visit-request',
              attributes: {
                url: `${realmURL.href}drain-midflight`,
                auth,
                realm: realmURL.href,
                affinityType: 'realm',
                affinityValue: realmURL.href,
                renderOptions: { cardRender: true },
              },
            },
          }),
      );

      // Drains once the render has reported itself and parked, so the answer
      // below comes from `raceAgainstDrain` giving up on a render in progress
      // rather than from the draining guard that sits ahead of the routes.
      await renderEntered.promise;
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
      assert.strictEqual(
        renderCalls,
        1,
        'the render was in flight, so the drain had something to interrupt',
      );

      // clean up
      execDeferred.fulfill();
      (built.prerenderer as any).prerenderVisit = originalPrerender;
      await built.prerenderer.stop();
    });

    // The stale-shell re-render, at the route rather than through its
    // predicate. What matters here is the plumbing the predicate can't see:
    // which token the handler samples, that the re-render waits for the
    // recycle, that it happens exactly once, and what a drain or a rejection
    // during it answers.
    module('stale-shell re-render', function () {
      const MISSING_EXPORT =
        "Module 'https://packages/@cardstack/boxel-ui/components' has no " +
        "exported member 'MarkdownContentShell'.";

      function poolMeta() {
        return {
          pageId: 'p',
          affinityType: 'realm',
          affinityValue: realmURL.href,
          reused: false,
          evicted: false,
          timedOut: false,
        };
      }

      // The handler's success log reads every `waits` field, so a stub that
      // omits them throws there rather than at the assertion.
      function timings() {
        return {
          launchMs: 0,
          renderMs: 0,
          waits: {
            semaphoreMs: 0,
            admissionMs: 0,
            tabQueueMs: 0,
            tabStartupMs: 0,
            tabProbeMs: 0,
          },
        };
      }

      function moduleFailure() {
        return {
          response: { card: { error: { error: { message: MISSING_EXPORT } } } },
          timings: timings(),
          pool: poolMeta(),
        };
      }

      // A render that failed for its own reasons and merely *mentions* a
      // missing export among the console errors `RenderRunner` merged onto it.
      function timeoutCarryingModuleError() {
        return {
          response: {
            card: {
              error: {
                error: {
                  message: 'Render timed out after 30000ms',
                  additionalErrors: [{ message: MISSING_EXPORT }],
                },
              },
            },
          },
          timings: timings(),
          pool: poolMeta(),
        };
      }

      function rendered() {
        return {
          response: { card: { isolatedHTML: '<div>fresh</div>' } },
          timings: timings(),
          pool: poolMeta(),
        };
      }

      // Reports `babf3612` on the first sample and `b778fe76` after, which is
      // a shell change learned while the render was in flight.
      function shellThatMovesOnce() {
        let samples = 0;
        return () => (++samples > 1 ? 'b778fe76' : 'babf3612');
      }

      // The pool's own token, which these tests must also state: the predicate
      // reads the warmed samples, so leaving them undefined makes the gate fire
      // whatever the reported token does — and a test named for a moving token
      // would pass identically with a steady one.
      const POOL_ON_OUTGOING = () => 'babf3612';

      function visitRequest(
        request: SuperTest<Test>,
        url: string,
        auth: string,
      ) {
        return request
          .post('/prerender-visit')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .send({
            data: {
              type: 'prerender-visit-request',
              attributes: {
                url,
                auth,
                realm: realmURL.href,
                affinityType: 'realm',
                affinityValue: realmURL.href,
                renderOptions: { cardRender: true },
              },
            },
          });
      }

      function authFor() {
        return testCreatePrerenderAuth(testUserId, {
          [realmURL.href]: ['read', 'write', 'realm-owner'],
        });
      }

      test('a module failure under a moved shell is re-rendered once, after the recycle', async function (assert) {
        let recycleSettled = false;
        let recycleDeferred = new Deferred<void>();
        let built = buildPrerenderApp({
          serverURL: 'http://127.0.0.1:4222',
          getHostShellHash: shellThatMovesOnce(),
          getWarmedHostShellHash: POOL_ON_OUTGOING,
          awaitHostShellRecycle: () =>
            recycleDeferred.promise.then(() => {
              recycleSettled = true;
            }),
        });
        let request: SuperTest<Test> = supertest(built.app.callback());

        let calls = 0;
        let sawRecycleSettled: boolean[] = [];
        let firstRenderEntered = new Deferred<void>();
        (built.prerenderer as any).prerenderVisit = async () => {
          calls++;
          sawRecycleSettled.push(recycleSettled);
          if (calls === 1) {
            firstRenderEntered.fulfill();
          }
          return calls === 1 ? moduleFailure() : rendered();
        };

        let resPromise = inFlight(() =>
          visitRequest(request, `${realmURL.href}stale-shell`, authFor()),
        );
        // Waits for the render to report itself rather than for a clock: how
        // long the route spends parsing and authenticating before it reaches
        // the prerenderer is not this test's subject, and on a loaded runner
        // it is longer than any interval worth sleeping. The observation below
        // is stable under any interleaving because the second render cannot
        // start while the recycle promise is pending.
        await firstRenderEntered.promise;
        assert.strictEqual(calls, 1, 're-render waits for the recycle');
        recycleDeferred.fulfill();

        let res = await resPromise;
        assert.strictEqual(res.status, 201, 'answers with the replacement');
        assert.strictEqual(calls, 2, 'exactly one re-render');
        assert.deepEqual(
          sawRecycleSettled,
          [false, true],
          'the second render ran only after the recycle settled',
        );
        assert.strictEqual(
          res.body.data.attributes.card.isolatedHTML,
          '<div>fresh</div>',
          "the replacement's result is what is returned",
        );
        assert.strictEqual(
          res.body.data.attributes.meta.diagnostics.hostShellHashAtCompletion,
          'b778fe76',
          'the tokens ride under diagnostics, where they reach a row',
        );
        await built.prerenderer.stop();
      });

      // What makes a module failure the card's own is not that nothing moved
      // during the render — it is that the pool can be shown to have been on
      // the current shell throughout. So this states both tokens.
      test("a module failure on a pool that is current is returned as the card's own", async function (assert) {
        let built = buildPrerenderApp({
          serverURL: 'http://127.0.0.1:4222',
          getHostShellHash: () => 'b778fe76',
          getWarmedHostShellHash: () => 'b778fe76',
        });
        let request: SuperTest<Test> = supertest(built.app.callback());

        let calls = 0;
        (built.prerenderer as any).prerenderVisit = async () => {
          calls++;
          return moduleFailure();
        };

        let res = await visitRequest(
          request,
          `${realmURL.href}steady-shell`,
          authFor(),
        );
        assert.strictEqual(res.status, 201);
        assert.strictEqual(calls, 1, 'no re-render');
        assert.strictEqual(
          res.body.data.attributes.card.error.error.message,
          MISSING_EXPORT,
          'the failure is returned for the caller to persist',
        );
        await built.prerenderer.stop();
      });

      // A failure that survives the re-render is returned, whatever the pool
      // did in between. Recovery here is exactly one extra render: the pool
      // being behind is grounds for trying again, never grounds for this
      // server to answer 5xx — the manager prunes a server that returns one,
      // and its proxy loop walks on to prune the next, so a single visit can
      // empty the registry.
      test('a failure surviving the re-render is returned to the caller', async function (assert) {
        // The pool is behind when the first render runs and current once the
        // recycle resolves, which is what a working recycle looks like.
        let warmed = 'babf3612';
        let recycleDeferred = new Deferred<void>();
        let built = buildPrerenderApp({
          serverURL: 'http://127.0.0.1:4222',
          getHostShellHash: () => 'b778fe76',
          getWarmedHostShellHash: () => warmed,
          awaitHostShellRecycle: () =>
            recycleDeferred.promise.then(() => {
              warmed = 'b778fe76';
            }),
        });
        let request: SuperTest<Test> = supertest(built.app.callback());

        let calls = 0;
        let firstRenderEntered = new Deferred<void>();
        (built.prerenderer as any).prerenderVisit = async () => {
          if (++calls === 1) {
            firstRenderEntered.fulfill();
          }
          // Both attempts fail the same way: the card really is broken.
          return moduleFailure();
        };

        let resPromise = inFlight(() =>
          visitRequest(request, `${realmURL.href}genuinely-broken`, authFor()),
        );
        await firstRenderEntered.promise;
        recycleDeferred.fulfill();

        let res = await resPromise;
        assert.strictEqual(calls, 2, 'the re-render happened');
        assert.strictEqual(
          res.status,
          201,
          'answered with the failure rather than a 5xx that would prune the fleet',
        );
        assert.strictEqual(
          res.body.data.attributes.card.error.error.message,
          MISSING_EXPORT,
          "the caller gets the card's own failure to persist",
        );
        // The stamped tokens have to describe the render the response came
        // from. Both attempts failed identically, so only the pool
        // distinguishes them: the discarded one ran behind, the retry ran
        // current. Reporting the discarded attempt's pool here would say this
        // failure came from an outgoing bundle when it did not — and a later
        // persistence decision reading that would suppress a row for a card
        // that really is broken.
        let stamped = res.body.data.attributes.meta.diagnostics;
        assert.strictEqual(
          stamped.warmedHostShellHash,
          'b778fe76',
          'the retry started on the recycled pool, not the outgoing one',
        );
        assert.strictEqual(
          stamped.warmedHostShellHashAtCompletion,
          'b778fe76',
          'and finished on it',
        );
        assert.strictEqual(
          stamped.hostShellHashAtCompletion,
          'b778fe76',
          'so the warmed pair agrees with the reported pair — one render, four consistent values',
        );
        await built.prerenderer.stop();
      });

      // The verdict the write site acts on, in both directions. Suppressing a
      // row is only safe if the mark is absent whenever the failure might be
      // the card's — so these two cases differ in nothing but whether the pool
      // ever reached the shell being served.
      test('a pool that never reaches the current shell marks the failure unattributable', async function (assert) {
        let built = buildPrerenderApp({
          serverURL: 'http://127.0.0.1:4222',
          getHostShellHash: () => 'b778fe76',
          getWarmedHostShellHash: () => 'babf3612',
          awaitHostShellRecycle: () => Promise.resolve(),
        });
        let request: SuperTest<Test> = supertest(built.app.callback());

        let calls = 0;
        (built.prerenderer as any).prerenderVisit = async () => {
          calls++;
          return moduleFailure();
        };

        let res = await visitRequest(
          request,
          `${realmURL.href}pool-never-current`,
          authFor(),
        );
        assert.strictEqual(calls, 2, 'one re-render, and no more');
        assert.strictEqual(res.status, 201, 'the failure is still returned');
        assert.deepEqual(
          res.body.data.attributes.meta.diagnostics.staleShellFailure,
          ['instance'],
          'marked, and scoped to the row that actually failed this way',
        );
      });

      test('a genuine break on a current pool is not marked', async function (assert) {
        // The pool is behind for the first render and current after the
        // recycle, so the retry runs on the shell being served and its failure
        // is the card's. Nothing here may be withheld.
        let warmed = 'babf3612';
        let built = buildPrerenderApp({
          serverURL: 'http://127.0.0.1:4222',
          getHostShellHash: () => 'b778fe76',
          getWarmedHostShellHash: () => warmed,
          awaitHostShellRecycle: async () => {
            warmed = 'b778fe76';
          },
        });
        let request: SuperTest<Test> = supertest(built.app.callback());

        let calls = 0;
        (built.prerenderer as any).prerenderVisit = async () => {
          calls++;
          return moduleFailure();
        };

        let res = await visitRequest(
          request,
          `${realmURL.href}genuinely-broken-import`,
          authFor(),
        );
        assert.strictEqual(calls, 2, 'the re-render happened');
        assert.strictEqual(res.status, 201);
        assert.notOk(
          res.body.data.attributes.meta.diagnostics.staleShellFailure,
          'unmarked, so the error persists and the break stays visible',
        );
        assert.strictEqual(
          res.body.data.attributes.card.error.error.message,
          MISSING_EXPORT,
          "and it is the card's own failure that is returned",
        );
      });

      // The scoping the review asked for. One visit produces the instance and
      // file rows independently: here the card render hit the stale bundle
      // while the file extraction failed for a reason of its own. A verdict
      // naming the response rather than the rows would withhold both, hiding
      // the file's genuine failure.
      test('a verdict names only the rows that failed on the stale bundle', async function (assert) {
        let built = buildPrerenderApp({
          serverURL: 'http://127.0.0.1:4222',
          getHostShellHash: () => 'b778fe76',
          getWarmedHostShellHash: () => 'babf3612',
          awaitHostShellRecycle: () => Promise.resolve(),
        });
        let request: SuperTest<Test> = supertest(built.app.callback());

        (built.prerenderer as any).prerenderVisit = async () => ({
          response: {
            card: { error: { error: { message: MISSING_EXPORT } } },
            fileExtract: {
              error: { error: { message: 'Unexpected end of JSON input' } },
            },
          },
          timings: timings(),
          pool: poolMeta(),
        });

        let res = await visitRequest(
          request,
          `${realmURL.href}two-failures`,
          authFor(),
        );
        assert.deepEqual(
          res.body.data.attributes.meta.diagnostics.staleShellFailure,
          ['instance'],
          "only the card's row is withheld; the file's own failure stays visible",
        );
      });

      // The narrowing that separates driving a re-render from withholding a
      // row. A timeout whose console happens to carry a missing-export line is
      // worth one more render — the broad test allows that — but it is not
      // grounds to withhold the timeout the render actually produced. Using the
      // broad predicate for the mark makes this fail.
      test('a failure that merely mentions a missing export is not marked', async function (assert) {
        let built = buildPrerenderApp({
          serverURL: 'http://127.0.0.1:4222',
          getHostShellHash: () => 'b778fe76',
          getWarmedHostShellHash: () => 'babf3612',
          awaitHostShellRecycle: () => Promise.resolve(),
        });
        let request: SuperTest<Test> = supertest(built.app.callback());

        let calls = 0;
        (built.prerenderer as any).prerenderVisit = async () => {
          calls++;
          return timeoutCarryingModuleError();
        };

        let res = await visitRequest(
          request,
          `${realmURL.href}timed-out-render`,
          authFor(),
        );
        assert.strictEqual(
          calls,
          2,
          'the broad test still drove a re-render, which is cheap and fine',
        );
        assert.notOk(
          res.body.data.attributes.meta.diagnostics.staleShellFailure,
          'but the timeout is not withheld: the missing export was not the failure',
        );
        assert.strictEqual(
          res.body.data.attributes.card.error.error.message,
          'Render timed out after 30000ms',
          'and the real failure is what reaches the caller',
        );
      });

      test('a rejecting re-render answers 500 so the visit is retried elsewhere', async function (assert) {
        let built = buildPrerenderApp({
          serverURL: 'http://127.0.0.1:4222',
          getHostShellHash: shellThatMovesOnce(),
          getWarmedHostShellHash: POOL_ON_OUTGOING,
        });
        let request: SuperTest<Test> = supertest(built.app.callback());

        let calls = 0;
        (built.prerenderer as any).prerenderVisit = async () => {
          if (++calls === 1) {
            return moduleFailure();
          }
          throw new Error('page closed mid-recycle');
        };

        let res = await visitRequest(
          request,
          `${realmURL.href}rejecting-rerender`,
          authFor(),
        );
        assert.strictEqual(
          res.status,
          500,
          'remote-prerenderer maps this to a retryable error rather than persisting the distrusted result',
        );
        assert.strictEqual(calls, 2, 'the re-render was attempted');
        await built.prerenderer.stop();
      });

      test('a drain during the re-render answers draining', async function (assert) {
        let localDraining = false;
        let drainingDeferred = new Deferred<void>();
        // Reports when the handler has entered the re-render and parked on the
        // recycle. Draining any earlier trips the `isDraining` check that
        // precedes the re-render, so the handler would skip it and answer with
        // the first result — a different path from the one under test.
        let recycleWaitEntered = new Deferred<void>();
        let built = buildPrerenderApp({
          serverURL: 'http://127.0.0.1:4222',
          isDraining: () => localDraining,
          drainingPromise: drainingDeferred.promise,
          getHostShellHash: shellThatMovesOnce(),
          getWarmedHostShellHash: POOL_ON_OUTGOING,
          awaitHostShellRecycle: () => {
            recycleWaitEntered.fulfill();
            // Never settles, so the drain is guaranteed to win the race.
            return new Promise<void>(() => {});
          },
        });
        let request: SuperTest<Test> = supertest(built.app.callback());

        let calls = 0;
        (built.prerenderer as any).prerenderVisit = async () => {
          calls++;
          return moduleFailure();
        };

        let resPromise = inFlight(() =>
          visitRequest(
            request,
            `${realmURL.href}drain-during-rerender`,
            authFor(),
          ),
        );
        await recycleWaitEntered.promise;
        localDraining = true;
        drainingDeferred.fulfill();

        let res = await resPromise;
        assert.strictEqual(
          res.status,
          PRERENDER_SERVER_DRAINING_STATUS_CODE,
          'reports draining rather than the failure it distrusts',
        );
        assert.strictEqual(calls, 1, 'the re-render never ran');
        await built.prerenderer.stop();
      });
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
          .post('/prerender-visit')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .send({
            data: {
              type: 'prerender-visit-request',
              attributes: {
                url: `${realmURL.href}drain-unhandled`,
                auth,
                realm: realmURL.href,
                affinityType: 'realm',
                affinityValue: realmURL.href,
                renderOptions: { cardRender: true },
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

  // Regression guard for CS-10813: default handlers would exit the qunit
  // process before teardown hooks ran, leaving hardcoded test ports bound.
  module('createPrerenderHttpServer fatal handler gating', function () {
    test('fatalExitOnUncaught=false does not register process-wide fatal handlers', async function (assert) {
      let baselineUncaught = process.listenerCount('uncaughtException');
      let baselineRejection = process.listenerCount('unhandledRejection');
      let server = createPrerenderHttpServer({
        maxPages: 1,
        fatalExitOnUncaught: false,
      });
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
        });
        assert.strictEqual(
          process.listenerCount('uncaughtException'),
          baselineUncaught,
          'no new uncaughtException listener registered',
        );
        assert.strictEqual(
          process.listenerCount('unhandledRejection'),
          baselineRejection,
          'no new unhandledRejection listener registered',
        );
      } finally {
        await closeServer(server);
      }
    });

    test('fatalExitOnUncaught default registers process-wide fatal handlers', async function (assert) {
      let baselineUncaught = process.listenerCount('uncaughtException');
      let baselineRejection = process.listenerCount('unhandledRejection');
      let server = createPrerenderHttpServer({ maxPages: 1 });
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
        });
        assert.strictEqual(
          process.listenerCount('uncaughtException') - baselineUncaught,
          1,
          'one new uncaughtException listener registered',
        );
        assert.strictEqual(
          process.listenerCount('unhandledRejection') - baselineRejection,
          1,
          'one new unhandledRejection listener registered',
        );
      } finally {
        await closeServer(server);
        // server.on('close') removes the handlers; confirm they're gone so a
        // regression here doesn't leak handlers across tests.
        assert.strictEqual(
          process.listenerCount('uncaughtException'),
          baselineUncaught,
          'uncaughtException listener removed on close',
        );
        assert.strictEqual(
          process.listenerCount('unhandledRejection'),
          baselineRejection,
          'unhandledRejection listener removed on close',
        );
      }
    });
  });
});
