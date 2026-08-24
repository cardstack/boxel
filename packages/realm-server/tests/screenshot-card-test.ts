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
  insertPermissions,
  param,
  putMedia,
  query,
  setScreenshotPerfSink,
} from '@cardstack/runtime-common';
import {
  chooseScreenshotCardCoalesceDecision,
  estimateScreenshotQueueWait,
} from '@cardstack/runtime-common/jobs/screenshot-card';
import type {
  DBAdapter,
  QueuePublisher,
  QueuePublishArgs,
  Job,
  PgPrimitive,
  ScreenshotPerfEvent,
  ScreenshotPrerenderResponse,
  ScreenshotRequestPerfEvent,
} from '@cardstack/runtime-common';
import type { QueueJobSpec } from '@cardstack/runtime-common/queue';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
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
        captureSpec: null,
        // The POST surface returns the capture in its response body rather
        // than recording it in the MediaCache ledger.
        persist: null,
        surface: 'post',
        // No x-boxel-logging-correlation-id on this request; the surface
        // still records the field so the capture's telemetry is explicit
        // about the absence.
        loggingCorrelationId: null,
      });
    });

    test('threads a valid captureSpec into the enqueued job', async function (assert) {
      let dbAdapter = makeDbAdapter();
      let { queue, published } = makeQueue({
        status: 'ready',
      } as unknown as PgPrimitive);
      let app = buildApp(buildArgs(dbAdapter, queue));
      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );
      let realmURL = 'http://example.test/';
      let cardId = `${realmURL}Person/fadhlan`;
      let captureSpec = {
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
        clip: { x: 0, y: 0, width: 400, height: 300 },
      };

      await supertest(app.callback())
        .post('/_screenshot-card')
        .set('Authorization', `Bearer ${token}`)
        .send({
          data: {
            type: 'screenshot-card',
            attributes: { realmURL, cardId, format: 'isolated', captureSpec },
          },
        })
        .expect(201);

      assert.strictEqual(published.length, 1, 'published exactly one job');
      assert.deepEqual(
        (published[0]?.args as Record<string, unknown>)?.captureSpec,
        captureSpec,
        'captureSpec forwarded verbatim into the job args',
      );
    });

    test('a default-valued captureSpec normalizes to null', async function (assert) {
      // `{ fullPage: false, deviceScaleFactor: 1 }` means the same capture
      // as no spec at all; eliding the defaults keeps it classified as
      // canonical (ledger fast path, persistence, served URL).
      let dbAdapter = makeDbAdapter();
      let { queue, published } = makeQueue({
        status: 'ready',
      } as unknown as PgPrimitive);
      let app = buildApp(buildArgs(dbAdapter, queue));
      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );
      let realmURL = 'http://example.test/';
      let cardId = `${realmURL}Person/fadhlan`;

      await supertest(app.callback())
        .post('/_screenshot-card')
        .set('Authorization', `Bearer ${token}`)
        .send({
          data: {
            type: 'screenshot-card',
            attributes: {
              realmURL,
              cardId,
              format: 'isolated',
              captureSpec: { fullPage: false, deviceScaleFactor: 1 },
            },
          },
        })
        .expect(201);

      assert.strictEqual(published.length, 1, 'published exactly one job');
      assert.strictEqual(
        (published[0]?.args as Record<string, unknown>)?.captureSpec,
        null,
        'default-valued spec reaches the job as null',
      );
    });

    async function expectCaptureSpecRejected(
      assert: Assert,
      captureSpec: unknown,
      offendingField: string,
    ) {
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
            type: 'screenshot-card',
            attributes: {
              realmURL: 'http://example.test/',
              cardId: 'http://example.test/Person/fadhlan',
              format: 'isolated',
              captureSpec,
            },
          },
        });

      assert.strictEqual(response.status, 400, '400 for invalid captureSpec');
      assert.ok(
        response.text.includes(offendingField),
        `names the offending field (${offendingField}) in the error: ${response.text}`,
      );
      assert.deepEqual(published, [], 'does not enqueue any job');
    }

    test('rejects oversize viewport width', async function (assert) {
      await expectCaptureSpecRejected(
        assert,
        { viewport: { width: 5000, height: 800 } },
        'viewport.width',
      );
    });

    test('rejects oversize viewport height', async function (assert) {
      await expectCaptureSpecRejected(
        assert,
        { viewport: { width: 800, height: 20000 } },
        'viewport.height',
      );
    });

    test('rejects deviceScaleFactor above the cap', async function (assert) {
      await expectCaptureSpecRejected(
        assert,
        { deviceScaleFactor: 4 },
        'deviceScaleFactor',
      );
    });

    test('rejects fullPage combined with clip', async function (assert) {
      await expectCaptureSpecRejected(
        assert,
        { fullPage: true, clip: { x: 0, y: 0, width: 100, height: 100 } },
        'fullPage',
      );
    });

    test('rejects clip that exceeds the viewport', async function (assert) {
      await expectCaptureSpecRejected(
        assert,
        {
          viewport: { width: 400, height: 300 },
          clip: { x: 100, y: 0, width: 400, height: 100 },
        },
        'clip',
      );
    });

    test('rejects clip extent beyond the viewport caps even without a viewport', async function (assert) {
      // Puppeteer captures beyond the viewport by default, so an unbounded
      // clip would be a way around the viewport cost caps.
      await expectCaptureSpecRejected(
        assert,
        { clip: { x: 0, y: 0, width: 1_000_000_000, height: 100 } },
        'clip x + width',
      );
      await expectCaptureSpecRejected(
        assert,
        { clip: { x: 0, y: 16_000, width: 100, height: 1_000 } },
        'clip y + height',
      );
    });

    test('rejects an unknown captureSpec field by name', async function (assert) {
      // A dropped typo would silently classify the request as canonical and
      // serve the wrong image.
      await expectCaptureSpecRejected(assert, { fullpage: true }, 'fullpage');
    });

    test('rejects an unknown nested captureSpec field by name', async function (assert) {
      await expectCaptureSpecRejected(
        assert,
        { clip: { x: 0, y: 0, width: 100, height: 100, scale: 2 } },
        'clip.scale',
      );
      await expectCaptureSpecRejected(
        assert,
        { viewport: { width: 800, height: 600, dsf: 2 } },
        'viewport.dsf',
      );
    });

    test('rejects physical pixels per edge beyond the texture cap', async function (assert) {
      // Each CSS cap alone passes; the product with deviceScaleFactor is
      // what exceeds the Chromium texture limit.
      await expectCaptureSpecRejected(
        assert,
        { viewport: { width: 800, height: 6_000 }, deviceScaleFactor: 3 },
        'viewport.height × deviceScaleFactor',
      );
      await expectCaptureSpecRejected(
        assert,
        {
          clip: { x: 0, y: 0, width: 100, height: 6_000 },
          deviceScaleFactor: 3,
        },
        'clip.height × deviceScaleFactor',
      );
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
    // The permission checker consults the matrix profile only for realms
    // with a `users` grant; these tests seed exact-user rows, so the stub
    // is never called.
    let matrixClient = {
      async getProfile() {
        return null;
      },
    } as unknown as MatrixClient;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter: PgAdapter): Promise<void> => {
        dbAdapter = _dbAdapter;
        adapter = new FakeMediaCacheAdapter();
        // The ledger fast path is gated on realm read; `@stranger:localhost`
        // is deliberately left without permissions for the negative tests.
        await insertPermissions(dbAdapter, new URL(REALM_URL), {
          '@someone:localhost': ['read'],
        });
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
          matrixClient,
          mediaCacheAdapter: adapter,
          ...opts,
        } as unknown as CreateRoutesArgs),
      );
      app.use(router.routes());
      return app;
    }

    async function seedInstanceRow(
      generation = 1,
      opts: { hasError?: boolean } = {},
    ) {
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
          ...(opts.hasError
            ? { has_error: true, error_doc: { message: 'index error' } }
            : {}),
        },
        { jsonFields: ['pristine_doc', 'error_doc'] },
      );
      await query(
        dbAdapter,
        insert('boxel_index', nameExpressions, valueExpressions),
      );
    }

    function post(
      app: Koa,
      attributes: Record<string, unknown>,
      user = '@someone:localhost',
    ) {
      let token = createJWT(
        { user, sessionRoom: '!room:localhost' },
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

    test('the POST surface emits a request telemetry record whose correlation id rides the job args', async function (assert) {
      await seedInstanceRow();
      let { queue, published } = makePersistQueue('ready');
      let perfEvents: ScreenshotPerfEvent[] = [];
      setScreenshotPerfSink((event) => perfEvents.push(event));
      try {
        await post(persistApp(queue), {
          realmURL: REALM_URL,
          cardId: CARD_ID,
          format: 'isolated',
        })
          .set('x-boxel-logging-correlation-id', 'corr-post-1')
          .expect(201);
      } finally {
        setScreenshotPerfSink(undefined);
      }

      let request = perfEvents.find(
        (event): event is ScreenshotRequestPerfEvent =>
          event.eventType === 'request',
      );
      assert.strictEqual(request?.surface, 'post');
      assert.strictEqual(request?.outcome, 'rendered');
      assert.strictEqual(request?.correlationId, 'corr-post-1');
      assert.strictEqual(request?.lane, 'on-demand');
      assert.strictEqual(typeof request?.generationLookupMs, 'number');
      assert.strictEqual(typeof request?.ledgerLookupMs, 'number');
      assert.strictEqual(typeof request?.enqueueMs, 'number');
      assert.strictEqual(typeof request?.jobWaitMs, 'number');
      assert.strictEqual(typeof request?.jobId, 'number');

      let args = published[0]?.args as Record<string, unknown>;
      assert.strictEqual(args?.surface, 'post');
      assert.strictEqual(args?.loggingCorrelationId, 'corr-post-1');
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

    test('a default-valued captureSpec still answers from the ledger', async function (assert) {
      // `{ fullPage: false, deviceScaleFactor: 1 }` is the canonical capture
      // spelled explicitly — it must keep the ledger fast path rather than
      // classify as a custom capture.
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
        captureSpec: { fullPage: false, deviceScaleFactor: 1 },
      }).expect(201);

      assert.deepEqual(published, [], 'no job was enqueued');
      assert.strictEqual(
        response.body.data.attributes.captures[0].url,
        `${REALM_URL}_screenshot/Person/fadhlan`,
        'the canonical served URL is returned',
      );
    });

    test('a custom captureSpec bypasses the ledger and never persists', async function (assert) {
      await seedInstanceRow();
      // A canonical (format-only) capture exists; the custom-spec request
      // must not serve it — the ledger identity cannot represent viewport /
      // scale / clip overrides, so a canonical entry is the wrong image for
      // this request, and persisting the custom render under that identity
      // would poison the canonical `_screenshot/` URL.
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
      let captureSpec = { viewport: { width: 1280, height: 800 } };

      let response = await post(persistApp(queue), {
        realmURL: REALM_URL,
        cardId: CARD_ID,
        format: 'isolated',
        captureSpec,
      }).expect(201);

      assert.strictEqual(
        published.length,
        1,
        'renders fresh instead of answering from the canonical ledger entry',
      );
      assert.deepEqual(
        (published[0]?.args as any)?.captureSpec,
        captureSpec,
        'the custom spec reaches the job',
      );
      assert.strictEqual(
        (published[0]?.args as any)?.persist,
        null,
        'the custom capture is never persisted',
      );
      assert.false(
        'captures' in response.body.data.attributes,
        'no served URL for a capture the ledger cannot key',
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

    test('a caller without realm read never touches the ledger', async function (assert) {
      await seedInstanceRow();
      let ledgerBytes = new TextEncoder().encode('private-ledger-bytes');
      let ledgerBase64 = Buffer.from(ledgerBytes).toString('base64');
      await putMedia(dbAdapter, adapter, {
        realmURL: REALM_URL,
        sourceURL: CARD_ID,
        captureSpecHash: await captureSpecHash({ format: 'isolated' }),
        sourceGeneration: 1,
        bytes: ledgerBytes,
        contentType: 'image/png',
        lane: 'on-demand',
        width: 800,
        height: 600,
      });
      let { queue, published } = makePersistQueue('ready');

      let response = await post(
        persistApp(queue),
        { realmURL: REALM_URL, cardId: CARD_ID, format: 'isolated' },
        '@stranger:localhost',
      ).expect(201);

      assert.strictEqual(
        published.length,
        1,
        'goes to the render path (whose permissions the worker enforces) instead of the ledger',
      );
      assert.strictEqual(
        (published[0]?.args as any)?.persist,
        null,
        'no persist identity without realm read',
      );
      let attrs = response.body.data.attributes;
      assert.notStrictEqual(
        attrs.base64,
        ledgerBase64,
        'the stored capture bytes never reach a caller without read',
      );
      assert.false(
        'captures' in attrs,
        'no served URL is disclosed without read',
      );
    });

    test('an errored instance captures without persisting', async function (assert) {
      await seedInstanceRow(1, { hasError: true });
      let { queue, published } = makePersistQueue('ready');

      let response = await post(persistApp(queue), {
        realmURL: REALM_URL,
        cardId: CARD_ID,
        format: 'isolated',
      }).expect(201);

      // An errored instance can never serve on the GET `_screenshot/` route
      // (its liveness gate excludes effective-error rows), so persisting
      // here would return a served URL that 404s.
      assert.strictEqual((published[0]?.args as any)?.persist, null);
      assert.false('captures' in response.body.data.attributes);
    });

    test('a ledger hit refreshes a stale last-accessed stamp', async function (assert) {
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
      // Age the entry past the touch throttle so the hit must bump it —
      // otherwise a capture consumed only through this endpoint looks idle
      // to the GC's on-demand TTL while in active use.
      let staleStamp = Date.now() - 25 * 60 * 60 * 1000;
      await query(dbAdapter, [
        `UPDATE media_cache_ledger SET last_accessed_at =`,
        param(staleStamp),
        `WHERE realm_url =`,
        param(REALM_URL),
        `AND source_url =`,
        param(CARD_ID),
      ]);
      let { queue, published } = makePersistQueue('ready');

      await post(persistApp(queue), {
        realmURL: REALM_URL,
        cardId: CARD_ID,
        format: 'isolated',
      }).expect(201);

      assert.deepEqual(published, [], 'answered from the ledger');
      let rows = (await query(dbAdapter, [
        `SELECT last_accessed_at FROM media_cache_ledger WHERE realm_url =`,
        param(REALM_URL),
        `AND source_url =`,
        param(CARD_ID),
      ])) as { last_accessed_at: string | number }[];
      assert.true(
        Number(rows[0]?.last_accessed_at) > staleStamp,
        'the hit bumped last_accessed_at',
      );
    });
  });

  module('screenshot queue twin estimate', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter: PgAdapter): Promise<void> => {
        dbAdapter = _dbAdapter;
      },
    });

    test('hasTwin requires the runAs the caller would render under', async function (assert) {
      let concurrencyGroup = 'screenshot:http://example.test/';
      let persist = {
        realmURL: 'http://example.test/',
        sourceURL: 'http://example.test/Person/fadhlan',
        captureSpecHash: 'abc123',
        sourceGeneration: 1,
        lane: 'on-demand',
      };
      let { nameExpressions, valueExpressions } = asExpressions(
        {
          job_type: 'screenshot-card',
          concurrency_group: concurrencyGroup,
          args: {
            cardId: persist.sourceURL,
            format: 'isolated',
            runAs: '@owner:localhost',
            persist,
          },
        },
        { jsonFields: ['args'] },
      );
      await query(dbAdapter, insert('jobs', nameExpressions, valueExpressions));

      let twinKey = {
        sourceURL: persist.sourceURL,
        captureSpecHash: persist.captureSpecHash,
        sourceGeneration: persist.sourceGeneration,
      };
      let sameIdentity = await estimateScreenshotQueueWait(
        dbAdapter,
        concurrencyGroup,
        { ...twinKey, runAs: '@owner:localhost' },
      );
      assert.true(
        sameIdentity.hasTwin,
        'a same-runAs pending job is a joinable twin',
      );

      // A persist-target match under a different runAs is a job the caller
      // cannot join (the coalesce key includes runAs), so reporting it as a
      // twin would wave a gate-skipping request into a lane that then
      // renders anyway.
      let differentRunAs = await estimateScreenshotQueueWait(
        dbAdapter,
        concurrencyGroup,
        { ...twinKey, runAs: '@someone-else:localhost' },
      );
      assert.false(
        differentRunAs.hasTwin,
        'a different-runAs job is not a twin',
      );
    });
  });

  module('screenshot-card coalesce decision', function () {
    const PERSIST = {
      realmURL: 'http://example.test/',
      sourceURL: 'http://example.test/Person/fadhlan',
      captureSpecHash: 'abc123',
      sourceGeneration: 1,
      lane: 'on-demand',
    };

    function jobSpec(args: Record<string, unknown>): QueueJobSpec {
      return {
        jobType: 'screenshot-card',
        concurrencyGroup: 'screenshot:http://example.test/',
        timeout: 60,
        priority: 0,
        args: args as PgPrimitive,
      };
    }

    function canonicalArgs(): Record<string, unknown> {
      return {
        cardId: PERSIST.sourceURL,
        format: 'isolated',
        runAs: '@owner:localhost',
        captureSpec: null,
        persist: PERSIST,
      };
    }

    test('canonical persist-carrying twins join', function (assert) {
      let decision = chooseScreenshotCardCoalesceDecision({
        incoming: jobSpec(canonicalArgs()),
        candidates: [{ ...jobSpec(canonicalArgs()), id: 7 }],
        inFlightCandidates: [],
      });
      assert.deepEqual(decision, { type: 'join', jobId: 7 });
    });

    test('an incoming job with captureSpec overrides always inserts', function (assert) {
      // The persist identity cannot represent the overrides, so joining a
      // canonical twin would hand this caller the wrong image.
      let decision = chooseScreenshotCardCoalesceDecision({
        incoming: jobSpec({
          ...canonicalArgs(),
          captureSpec: { viewport: { width: 1280, height: 800 } },
        }),
        candidates: [{ ...jobSpec(canonicalArgs()), id: 7 }],
        inFlightCandidates: [],
      });
      assert.deepEqual(decision, { type: 'insert' });
    });

    test('a candidate with captureSpec overrides is never a twin', function (assert) {
      let decision = chooseScreenshotCardCoalesceDecision({
        incoming: jobSpec(canonicalArgs()),
        candidates: [
          {
            ...jobSpec({
              ...canonicalArgs(),
              captureSpec: { deviceScaleFactor: 2 },
            }),
            id: 7,
          },
        ],
        inFlightCandidates: [],
      });
      assert.deepEqual(decision, { type: 'insert' });
    });
  });
});
