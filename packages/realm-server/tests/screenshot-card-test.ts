import QUnit from 'qunit';
const { module, test } = QUnit;
import Koa from 'koa';
import Router from '@koa/router';
import supertest from 'supertest';
import { basename } from 'path';
import {
  Deferred,
  asExpressions,
  captureSpecHash,
  insert,
  putMedia,
  query,
} from '@cardstack/runtime-common';
import type {
  DBAdapter,
  QueuePublisher,
  QueuePublishArgs,
  Job,
  PgPrimitive,
  ScreenshotPrerenderResponse,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';

import handleScreenshotCard from '../handlers/handle-screenshot-card.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { jwtMiddleware } from '../middleware/index.ts';
import { createJWT } from '../utils/jwt.ts';
import { FakeMediaCacheAdapter } from './helpers/fake-media-cache-adapter.ts';
import { realmSecretSeed, setupDB } from './helpers/index.ts';

module(basename(import.meta.filename), function () {
  module('/_screenshot-card endpoint', function () {
    function makeDbAdapter(): DBAdapter {
      return {
        kind: 'pg',
        async notify() {},
        isClosed: false,
        async execute() {
          return [];
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

    function makeQueue(result: PgPrimitive | (() => PgPrimitive)): {
      queue: QueuePublisher;
      published: Array<QueuePublishArgs<unknown>>;
    } {
      let published: Array<QueuePublishArgs<unknown>> = [];
      let nextId = 1;
      let queue: QueuePublisher = {
        async publish<TResult = PgPrimitive>(
          args: QueuePublishArgs<TResult>,
        ): Promise<Job<TResult>> {
          published.push(args as QueuePublishArgs<unknown>);
          let notifier = new Deferred<TResult>();
          let resolved = typeof result === 'function' ? result() : result;
          notifier.fulfill(resolved as unknown as TResult);
          // Job is a class with private constructor symbols only used as a
          // shape — rely on its public surface (id + done getter).
          return {
            id: nextId++,
            get done() {
              return notifier.promise;
            },
          } as Job<TResult>;
        },
        async destroy() {},
      };
      return { queue, published };
    }

    function buildArgs(
      dbAdapter: DBAdapter,
      queue: QueuePublisher,
    ): CreateRoutesArgs {
      // The screenshot-card handler only reads dbAdapter + queue from
      // CreateRoutesArgs, so we cast a minimal shape rather than spinning up
      // the full realm server.
      return {
        dbAdapter,
        queue,
      } as unknown as CreateRoutesArgs;
    }

    function buildApp(args: CreateRoutesArgs) {
      let app = new Koa();
      let router = new Router();
      router.post(
        '/_screenshot-card',
        jwtMiddleware(realmSecretSeed, args.dbAdapter),
        handleScreenshotCard(args),
      );
      app.use(router.routes());
      return app;
    }

    test('enqueues a screenshot-card job and forwards the result', async function (assert) {
      let dbAdapter = makeDbAdapter();
      let stubResult: ScreenshotPrerenderResponse = {
        status: 'ready',
        base64: 'iVBORw0KGgo=',
        width: 800,
        height: 600,
        contentType: 'image/png',
      };
      let { queue, published } = makeQueue(
        stubResult as unknown as PgPrimitive,
      );
      let app = buildApp(buildArgs(dbAdapter, queue));

      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );
      let realmURL = 'http://example.test/';
      let cardId = `${realmURL}Person/fadhlan`;

      let response = await supertest(app.callback())
        .post('/_screenshot-card')
        .set('Authorization', `Bearer ${token}`)
        .send({
          data: {
            type: 'screenshot-card',
            attributes: { realmURL, cardId, format: 'isolated' },
          },
        })
        .expect(201);

      assert.deepEqual(
        response.body,
        {
          data: {
            type: 'screenshot-card-result',
            attributes: stubResult,
          },
        },
        'returns the screenshot-card-result envelope from the job',
      );
      assert.strictEqual(published.length, 1, 'published exactly one job');
      assert.strictEqual(published[0]?.jobType, 'screenshot-card');
      assert.strictEqual(
        published[0]?.concurrencyGroup,
        `screenshot:${realmURL}`,
      );
      assert.deepEqual(published[0]?.args, {
        realmURL,
        realmUsername: '@someone:localhost',
        runAs: '@someone:localhost',
        cardId,
        format: 'isolated',
        // The POST surface returns the capture in its response body rather
        // than recording it in the MediaCache ledger.
        persist: null,
      });
    });

    test('rejects without auth', async function (assert) {
      let { queue, published } = makeQueue({ status: 'ready' });
      let app = buildApp(buildArgs(makeDbAdapter(), queue));

      let response = await supertest(app.callback())
        .post('/_screenshot-card')
        .send({
          data: {
            attributes: {
              realmURL: 'http://example.test/',
              cardId: 'http://example.test/Person/fadhlan',
              format: 'isolated',
            },
          },
        });

      assert.strictEqual(response.status, 401, '401 without auth');
      assert.deepEqual(published, [], 'does not enqueue any job');
    });

    test('rejects missing realmURL', async function (assert) {
      let { queue, published } = makeQueue({ status: 'ready' });
      let app = buildApp(buildArgs(makeDbAdapter(), queue));
      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );

      let response = await supertest(app.callback())
        .post('/_screenshot-card')
        .set('Authorization', `Bearer ${token}`)
        .send({
          data: {
            attributes: {
              cardId: 'http://example.test/Person/fadhlan',
              format: 'isolated',
            },
          },
        });

      assert.strictEqual(response.status, 400);
      assert.deepEqual(published, [], 'does not enqueue any job');
    });

    test('rejects missing cardId', async function (assert) {
      let { queue, published } = makeQueue({ status: 'ready' });
      let app = buildApp(buildArgs(makeDbAdapter(), queue));
      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );

      let response = await supertest(app.callback())
        .post('/_screenshot-card')
        .set('Authorization', `Bearer ${token}`)
        .send({
          data: {
            attributes: {
              realmURL: 'http://example.test/',
              format: 'isolated',
            },
          },
        });

      assert.strictEqual(response.status, 400);
      assert.deepEqual(published, [], 'does not enqueue any job');
    });

    test('rejects invalid format', async function (assert) {
      let { queue, published } = makeQueue({ status: 'ready' });
      let app = buildApp(buildArgs(makeDbAdapter(), queue));
      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );

      let response = await supertest(app.callback())
        .post('/_screenshot-card')
        .set('Authorization', `Bearer ${token}`)
        .send({
          data: {
            attributes: {
              realmURL: 'http://example.test/',
              cardId: 'http://example.test/Person/fadhlan',
              format: 'fitted',
            },
          },
        });

      assert.strictEqual(response.status, 400);
      assert.ok(
        response.text.includes('format'),
        'mentions format in the error message',
      );
      assert.deepEqual(published, [], 'does not enqueue any job');
    });

    test('rejects a cardId outside the realm', async function (assert) {
      let { queue, published } = makeQueue({ status: 'ready' });
      let app = buildApp(buildArgs(makeDbAdapter(), queue));
      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );

      let response = await supertest(app.callback())
        .post('/_screenshot-card')
        .set('Authorization', `Bearer ${token}`)
        .send({
          data: {
            attributes: {
              realmURL: 'http://example.test/',
              cardId: 'http://other.test/Person/fadhlan',
              format: 'isolated',
            },
          },
        });

      assert.strictEqual(response.status, 400);
      assert.ok(response.text.includes('cardId must be within realmURL'));
      assert.deepEqual(published, [], 'does not enqueue any job');
    });
  });

  module('/_screenshot-card persistence', function (hooks) {
    const REALM_URL = 'http://example.test/';
    const CARD_ID = `${REALM_URL}Person/fadhlan`;
    const PNG_BYTES = new TextEncoder().encode('stub-png-bytes');
    const PNG_BASE64 = Buffer.from(PNG_BYTES).toString('base64');
    const READY: ScreenshotPrerenderResponse = {
      status: 'ready',
      base64: PNG_BASE64,
      width: 800,
      height: 600,
      contentType: 'image/png',
    };

    let dbAdapter: PgAdapter;
    let adapter: FakeMediaCacheAdapter;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter: PgAdapter): Promise<void> => {
        dbAdapter = _dbAdapter;
        adapter = new FakeMediaCacheAdapter();
      },
    });

    function makePersistQueue(behavior: 'ready' | 'never'): {
      queue: QueuePublisher;
      published: Array<QueuePublishArgs<unknown>>;
    } {
      let published: Array<QueuePublishArgs<unknown>> = [];
      let nextId = 1;
      let queue: QueuePublisher = {
        async publish<TResult = PgPrimitive>(
          args: QueuePublishArgs<TResult>,
        ): Promise<Job<TResult>> {
          published.push(args as QueuePublishArgs<unknown>);
          let notifier = new Deferred<TResult>();
          if (behavior === 'ready') {
            notifier.fulfill(READY as unknown as TResult);
          }
          return {
            id: nextId++,
            get done() {
              return notifier.promise;
            },
          } as Job<TResult>;
        },
        async destroy() {},
      };
      return { queue, published };
    }

    function persistApp(
      queue: QueuePublisher,
      opts: { screenshotSyncWaitMs?: number } = {},
    ) {
      let app = new Koa();
      let router = new Router();
      router.post(
        '/_screenshot-card',
        jwtMiddleware(realmSecretSeed, dbAdapter),
        handleScreenshotCard({
          dbAdapter,
          queue,
          mediaCacheAdapter: adapter,
          ...opts,
        } as unknown as CreateRoutesArgs),
      );
      app.use(router.routes());
      return app;
    }

    async function seedInstanceRow(generation = 1) {
      let { nameExpressions, valueExpressions } = asExpressions(
        {
          url: `${CARD_ID}.json`,
          file_alias: CARD_ID,
          realm_url: REALM_URL,
          type: 'instance',
          generation,
          last_modified: Date.now(),
          resource_created_at: Date.now(),
          is_deleted: false,
          pristine_doc: { attributes: {} },
        },
        { jsonFields: ['pristine_doc'] },
      );
      await query(
        dbAdapter,
        insert('boxel_index', nameExpressions, valueExpressions),
      );
    }

    function post(app: Koa, attributes: Record<string, unknown>) {
      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );
      return supertest(app.callback())
        .post('/_screenshot-card')
        .set('Authorization', `Bearer ${token}`)
        .send({ data: { type: 'screenshot-card', attributes } });
    }

    test('a capture of an indexed card enqueues with the DSL-matching persist identity and returns a served URL', async function (assert) {
      await seedInstanceRow();
      let { queue, published } = makePersistQueue('ready');

      let response = await post(persistApp(queue), {
        realmURL: REALM_URL,
        cardId: CARD_ID,
        format: 'isolated',
      }).expect(201);

      assert.deepEqual((published[0]?.args as any)?.persist, {
        realmURL: REALM_URL,
        sourceURL: CARD_ID,
        captureSpecHash: await captureSpecHash({ format: 'isolated' }),
        sourceGeneration: 1,
        lane: 'on-demand',
      });

      let attrs = response.body.data.attributes;
      assert.strictEqual(attrs.status, 'ready');
      assert.strictEqual(attrs.base64, PNG_BASE64, 'top-level mirror intact');
      assert.strictEqual(attrs.width, 800);
      assert.strictEqual(attrs.height, 600);
      assert.deepEqual(attrs.captures, [
        {
          name: null,
          url: `${REALM_URL}_screenshot/Person/fadhlan`,
          width: 800,
          height: 600,
          deviceScaleFactor: null,
          base64: PNG_BASE64,
        },
      ]);
    });

    test('a non-default format shows up in the served URL', async function (assert) {
      await seedInstanceRow();
      let { queue } = makePersistQueue('ready');

      let response = await post(persistApp(queue), {
        realmURL: REALM_URL,
        cardId: CARD_ID,
        format: 'embedded',
      }).expect(201);

      assert.strictEqual(
        response.body.data.attributes.captures[0].url,
        `${REALM_URL}_screenshot/Person/fadhlan?format=embedded`,
      );
    });

    test('includeBase64: false omits the bytes everywhere', async function (assert) {
      await seedInstanceRow();
      let { queue } = makePersistQueue('ready');

      let response = await post(persistApp(queue), {
        realmURL: REALM_URL,
        cardId: CARD_ID,
        format: 'isolated',
        includeBase64: false,
      }).expect(201);

      let attrs = response.body.data.attributes;
      assert.false('base64' in attrs, 'no top-level base64');
      assert.false('base64' in attrs.captures[0], 'no per-capture base64');
      assert.strictEqual(attrs.width, 800, 'dimensions still mirror');
    });

    test('a ledger hit answers with zero render work', async function (assert) {
      await seedInstanceRow();
      await putMedia(dbAdapter, adapter, {
        realmURL: REALM_URL,
        sourceURL: CARD_ID,
        captureSpecHash: await captureSpecHash({ format: 'isolated' }),
        sourceGeneration: 1,
        bytes: PNG_BYTES,
        contentType: 'image/png',
        lane: 'on-demand',
        width: 800,
        height: 600,
      });
      let { queue, published } = makePersistQueue('ready');

      let response = await post(persistApp(queue), {
        realmURL: REALM_URL,
        cardId: CARD_ID,
        format: 'isolated',
      }).expect(201);

      assert.deepEqual(published, [], 'no job was enqueued');
      let attrs = response.body.data.attributes;
      assert.strictEqual(attrs.status, 'ready');
      assert.strictEqual(attrs.base64, PNG_BASE64, 'bytes come from the store');
      assert.strictEqual(attrs.width, 800);
      assert.strictEqual(attrs.height, 600);
      assert.strictEqual(
        attrs.captures[0].url,
        `${REALM_URL}_screenshot/Person/fadhlan`,
      );
    });

    test('an edited card misses the stale ledger entry and re-captures', async function (assert) {
      await seedInstanceRow(2);
      // A capture of generation 1 exists, but the instance has moved on.
      await putMedia(dbAdapter, adapter, {
        realmURL: REALM_URL,
        sourceURL: CARD_ID,
        captureSpecHash: await captureSpecHash({ format: 'isolated' }),
        sourceGeneration: 1,
        bytes: PNG_BYTES,
        contentType: 'image/png',
        lane: 'on-demand',
      });
      let { queue, published } = makePersistQueue('ready');

      await post(persistApp(queue), {
        realmURL: REALM_URL,
        cardId: CARD_ID,
        format: 'isolated',
      }).expect(201);

      assert.strictEqual(published.length, 1, 'a fresh capture was enqueued');
      assert.strictEqual(
        ((published[0]?.args as any)?.persist as { sourceGeneration: number })
          .sourceGeneration,
        2,
        'the persist identity carries the current generation',
      );
    });

    test('a wait that outruns the budget answers 503 + Retry-After', async function (assert) {
      await seedInstanceRow();
      let { queue, published } = makePersistQueue('never');

      let response = await post(
        persistApp(queue, { screenshotSyncWaitMs: 50 }),
        { realmURL: REALM_URL, cardId: CARD_ID, format: 'isolated' },
      );

      assert.strictEqual(response.status, 503);
      assert.ok(Number(response.headers['retry-after']) >= 1);
      assert.strictEqual(
        published.length,
        1,
        'the capture is in flight; its job persists the result for the retry',
      );
    });

    test('an unindexed card still captures, without persisting', async function (assert) {
      let { queue, published } = makePersistQueue('ready');

      let response = await post(persistApp(queue), {
        realmURL: REALM_URL,
        cardId: CARD_ID,
        format: 'isolated',
      }).expect(201);

      assert.strictEqual((published[0]?.args as any)?.persist, null);
      let attrs = response.body.data.attributes;
      assert.strictEqual(attrs.base64, PNG_BASE64, 'legacy shape intact');
      assert.false('captures' in attrs, 'no served URL without a persist');
    });
  });
});
