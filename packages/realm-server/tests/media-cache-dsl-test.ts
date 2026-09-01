import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PgAdapter } from '@cardstack/postgres';
import type {
  DefinitionLookup,
  IndexWriter,
  Prerenderer,
  QueuePublisher,
  QueueRunner,
  Realm,
  ScreenshotCapturePerfEvent,
  ScreenshotPerfEvent,
  ScreenshotPrerenderResponse,
  ScreenshotRequestPerfEvent,
  VirtualNetwork as VirtualNetworkType,
} from '@cardstack/runtime-common';
import {
  Deferred,
  MEDIA_CACHE_MAX_AGE_SECONDS,
  VirtualNetwork,
  asExpressions,
  canonicalCaptureSpecQuery,
  canonicalCaptureSpecString,
  captureSpecHash,
  findMediaCacheEntry,
  insert,
  logger,
  parseCaptureSpecParams,
  parseScreenshotCaptureSpec,
  putMedia,
  query,
  screenshotCard,
  setScreenshotPerfSink,
} from '@cardstack/runtime-common';

import Koa from 'koa';
import Router from '@koa/router';
import supertest from 'supertest';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';

import { enqueueScreenshotCardJob } from '@cardstack/runtime-common/jobs/screenshot-card';
import handleScreenshotCard from '../handlers/handle-screenshot-card.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { jwtMiddleware } from '../middleware/index.ts';
import { createJWT } from '../utils/jwt.ts';
import { FakeMediaCacheAdapter } from './helpers/fake-media-cache-adapter.ts';
import {
  createRealm,
  insertJob,
  realmSecretSeed,
  setupDB,
} from './helpers/index.ts';
import { nodeStreamToBuffer } from '../stream.ts';

const REALM_URL = 'http://test-dsl-realm/';
const OWNER = '@node-test_realm:localhost';
const PNG_BYTES = new TextEncoder().encode('stub-png-bytes');
const PNG_BASE64 = Buffer.from(PNG_BYTES).toString('base64');
// Long enough that a healthy queue round-trip never times out; short enough
// that the deliberately-stalled timeout test doesn't drag the suite.
const SYNC_WAIT_MS = 2000;

function params(qs: string): URLSearchParams {
  return new URL(`http://x/?${qs}`).searchParams;
}

module(basename(import.meta.filename), function () {
  module('capture-spec canonicalization', function () {
    test('the all-defaults spec canonicalizes to {} however it is spelled', async function (assert) {
      let bare = parseCaptureSpecParams(params(''));
      let explicit = parseCaptureSpecParams(params('format=isolated'));
      assert.true('spec' in bare, 'the bare URL parses');
      assert.true('spec' in explicit, 'the explicit-default URL parses');
      if ('spec' in bare && 'spec' in explicit) {
        assert.strictEqual(canonicalCaptureSpecString(bare.spec), '{}');
        assert.strictEqual(
          await captureSpecHash(bare.spec),
          await captureSpecHash(explicit.spec),
          'default-elision makes the two spellings one cache key',
        );
      }
    });

    test('a non-default format is its own cache key', async function (assert) {
      let embedded = parseCaptureSpecParams(params('format=embedded'));
      assert.true('spec' in embedded, 'format=embedded parses');
      if ('spec' in embedded) {
        assert.strictEqual(
          canonicalCaptureSpecString(embedded.spec),
          '{"format":"embedded"}',
        );
        assert.notStrictEqual(
          await captureSpecHash(embedded.spec),
          await captureSpecHash({ format: 'isolated' }),
        );
      }
    });

    test('every spelling of one capture geometry is one cache key', async function (assert) {
      // Explicit engine defaults are elided: this URL means the bare URL.
      let explicitDefaults = parseCaptureSpecParams(
        params('viewport=800x600&dsf=1&fullPage=false'),
      );
      assert.true('spec' in explicitDefaults, 'explicit defaults parse');
      if ('spec' in explicitDefaults) {
        assert.strictEqual(
          canonicalCaptureSpecString(explicitDefaults.spec),
          '{}',
        );
      }

      // Numeric spellings normalize: 2.0 and 2 are the same scale.
      let dsfInt = parseCaptureSpecParams(params('dsf=2'));
      let dsfDecimal = parseCaptureSpecParams(params('dsf=2.0'));
      if ('spec' in dsfInt && 'spec' in dsfDecimal) {
        assert.strictEqual(
          await captureSpecHash(dsfInt.spec),
          await captureSpecHash(dsfDecimal.spec),
          'dsf=2 and dsf=2.0 are one cache key',
        );
      }

      // The GET grammar and the POST body express one identity: parsing
      // either surface's spelling of a capture hashes identically.
      let viaGet = parseCaptureSpecParams(
        params('viewport=1280x800&dsf=2&format=embedded'),
      );
      let viaPost = parseScreenshotCaptureSpec(
        {
          viewport: { width: 1280, height: 800 },
          deviceScaleFactor: 2,
        },
        'embedded',
      );
      assert.true('spec' in viaGet, 'the GET spelling parses');
      assert.strictEqual(viaPost.error, undefined, 'the POST spelling parses');
      if ('spec' in viaGet && !viaPost.error) {
        assert.strictEqual(
          await captureSpecHash(viaGet.spec),
          await captureSpecHash({
            format: 'embedded',
            ...(viaPost.captureSpec ?? {}),
          }),
          'GET params and POST body canonicalize to one hash',
        );
      }
    });

    test('the canonical served query round-trips through the parser', async function (assert) {
      let specs: Parameters<typeof canonicalCaptureSpecQuery>[0][] = [
        { format: 'isolated' },
        { format: 'embedded', viewport: { width: 1280, height: 800 } },
        { format: 'isolated', deviceScaleFactor: 1.5, fullPage: true },
        {
          format: 'isolated',
          viewport: { width: 1280, height: 800 },
          clip: { x: 0.5, y: 10, width: 400, height: 300 },
        },
        // A clip offset whose String form is scientific notation: the
        // validator admits any non-negative finite x/y, so the URL grammar
        // must reparse every spelling `String` can emit for them.
        {
          format: 'isolated',
          clip: { x: 1e-7, y: 0, width: 400, height: 300 },
        },
        // Default-valued fields must vanish from the query entirely.
        {
          format: 'isolated',
          viewport: { width: 800, height: 600 },
          deviceScaleFactor: 1,
          fullPage: false,
        },
      ];
      for (let spec of specs) {
        let queryString = canonicalCaptureSpecQuery(spec);
        let reparsed = parseCaptureSpecParams(
          new URL(`http://x/${queryString}`).searchParams,
        );
        assert.true(
          'spec' in reparsed,
          `"${queryString}" reparses (${JSON.stringify(spec)})`,
        );
        if ('spec' in reparsed) {
          assert.strictEqual(
            canonicalCaptureSpecString(reparsed.spec),
            canonicalCaptureSpecString(spec),
            `"${queryString}" round-trips to the same canonical form`,
          );
        }
      }
    });

    test('the served query spells the documented grammar, commas unescaped', function (assert) {
      // The emitted URL must read as the same grammar the params document
      // and the 400 messages teach — `URLSearchParams` would percent-encode
      // the clip commas into `clip=0%2C0%2C400x300`.
      assert.strictEqual(
        canonicalCaptureSpecQuery({
          format: 'embedded',
          viewport: { width: 1280, height: 800 },
          deviceScaleFactor: 2,
          clip: { x: 0, y: 10, width: 400, height: 300 },
        }),
        '?format=embedded&viewport=1280x800&dsf=2&clip=0,10,400x300',
      );
      assert.strictEqual(
        canonicalCaptureSpecQuery({ format: 'isolated', fullPage: true }),
        '?fullPage=true',
      );
    });

    test('errors name the offending field', function (assert) {
      let unknown = parseCaptureSpecParams(params('sparkle=true'));
      assert.deepEqual(unknown, {
        error: { field: 'sparkle', message: 'unsupported parameter "sparkle"' },
      });

      let reserved = parseCaptureSpecParams(params('envelope=fitted'));
      assert.deepEqual(reserved, {
        error: {
          field: 'envelope',
          message:
            'parameter "envelope" is not supported by this capture engine',
        },
      });

      let badFormat = parseCaptureSpecParams(params('format=fancy'));
      assert.deepEqual(badFormat, {
        error: {
          field: 'format',
          message: 'format must be "isolated" or "embedded"',
        },
      });

      let repeated = parseCaptureSpecParams(
        params('format=isolated&format=embedded'),
      );
      assert.strictEqual(
        'error' in repeated ? repeated.error.field : undefined,
        'format',
      );
    });

    test('malformed geometry values are refused naming the param', function (assert) {
      for (let [qs, field] of [
        ['viewport=huge', 'viewport'],
        ['viewport=1280', 'viewport'],
        ['dsf=fast', 'dsf'],
        ['fullPage=1', 'fullPage'],
        ['clip=0,0', 'clip'],
        ['clip=-1,0,400x300', 'clip'],
        ['viewport=1280x800&viewport=640x480', 'viewport'],
      ] as const) {
        let parsed = parseCaptureSpecParams(params(qs));
        assert.strictEqual(
          'error' in parsed ? parsed.error.field : undefined,
          field,
          `"${qs}" is refused naming ${field}`,
        );
      }
    });

    test('out-of-range geometry is refused with the POST wording', function (assert) {
      for (let [qs, field, message] of [
        [
          'viewport=5000x100',
          'viewport',
          'captureSpec.viewport.width must be <= 4096',
        ],
        [
          'viewport=100x20000',
          'viewport',
          'captureSpec.viewport.height must be <= 16384',
        ],
        ['dsf=5', 'dsf', 'captureSpec.deviceScaleFactor must be <= 3'],
        [
          'dsf=0',
          'dsf',
          'captureSpec.deviceScaleFactor must be a positive number',
        ],
        [
          'fullPage=true&clip=0,0,400x300',
          'fullPage',
          'captureSpec cannot set both fullPage and clip',
        ],
        [
          'viewport=200x200&clip=0,0,400x300',
          'clip',
          'captureSpec.clip exceeds the viewport width',
        ],
        [
          'viewport=100x16384&dsf=2',
          'viewport',
          'captureSpec.viewport.height × deviceScaleFactor must be <= 16384 physical pixels',
        ],
      ] as const) {
        let parsed = parseCaptureSpecParams(params(qs));
        assert.deepEqual(
          'error' in parsed ? parsed.error : undefined,
          { field, message },
          `"${qs}" is refused with the shared-validator wording`,
        );
      }
    });
  });

  module('GET _screenshot capture flow', function (hooks) {
    let dbAdapter: PgAdapter;
    let publisher: QueuePublisher;
    let runner: QueueRunner;
    let realm: Realm;
    let adapter: FakeMediaCacheAdapter;
    let virtualNetwork: VirtualNetworkType;
    let captureCalls: number;
    // The captureSpec each stub render received, so tests can assert the
    // parsed geometry actually reaches the capture engine.
    let capturedSpecs: unknown[];
    // When set, in-flight captures park on it — the lever for the sync-wait
    // timeout test.
    let captureGate: Deferred<void> | undefined;
    // Telemetry captured through the perf sink instead of the log channel,
    // so tests assert on records, not stdout.
    let perfEvents: ScreenshotPerfEvent[];

    hooks.beforeEach(function () {
      perfEvents = [];
      setScreenshotPerfSink((event) => perfEvents.push(event));
    });
    hooks.afterEach(function () {
      setScreenshotPerfSink(undefined);
    });

    setupDB(hooks, {
      beforeEach: async (
        _dbAdapter: PgAdapter,
        _publisher: QueuePublisher,
        _runner: QueueRunner,
      ): Promise<void> => {
        dbAdapter = _dbAdapter;
        publisher = _publisher;
        runner = _runner;
        adapter = new FakeMediaCacheAdapter();
        captureCalls = 0;
        capturedSpecs = [];
        captureGate = undefined;
        virtualNetwork = new VirtualNetwork();
        ({ realm } = await createRealm({
          dir: await mkdtemp(join(tmpdir(), 'media-cache-dsl-test-')),
          definitionLookup: {
            forRealm() {
              return this;
            },
          } as unknown as DefinitionLookup,
          realmURL: REALM_URL,
          permissions: {
            '*': ['read'],
            [OWNER]: ['read', 'write', 'realm-owner'],
          },
          virtualNetwork,
          publisher,
          dbAdapter,
          mediaCacheAdapter: adapter,
          screenshotSyncWaitMs: SYNC_WAIT_MS,
        }));
      },
    });

    // Registers the real screenshot-card task on the test runner, with a
    // stub prerenderer standing in for the Chrome pool. Only tests that
    // want a capture to complete start the worker; the rest leave enqueued
    // jobs unclaimed on purpose. `prerenderResult` swaps in a non-ready
    // outcome so a test can exercise the render-failure path.
    async function startWorker(
      prerenderResult?: () => ScreenshotPrerenderResponse,
    ) {
      let prerenderer = {
        prerenderScreenshot: async (args: {
          captureSpec?: unknown;
        }): Promise<ScreenshotPrerenderResponse> => {
          captureCalls++;
          capturedSpecs.push(args.captureSpec ?? null);
          if (captureGate) {
            await captureGate.promise;
          }
          if (prerenderResult) {
            return prerenderResult();
          }
          return {
            status: 'ready',
            base64: PNG_BASE64,
            width: 8,
            height: 6,
            contentType: 'image/png',
            // The shape the real prerenderer attaches: an HTTP request id
            // plus the timing diagnostics block, so the telemetry tests can
            // assert the task lifts every stage into its capture record.
            meta: {
              requestId: 'stub-prerender-req',
              diagnostics: {
                launchMs: 5,
                waits: { semaphoreMs: 1 },
                renderElapsedMs: 20,
                tabReused: true,
                screenshotNavMs: 4,
                screenshotSettleMs: 6,
                screenshotImagePaintMs: 7,
                screenshotCaptureMs: 3,
              },
            },
          };
        },
      } as unknown as Prerenderer;
      await runner.register(
        'screenshot-card',
        screenshotCard({
          dbAdapter,
          queuePublisher: publisher,
          prerenderer,
          mediaCacheAdapter: adapter,
          log: logger('media-cache-dsl-test'),
          reportStatus: () => {},
          matrixURL: 'http://localhost:8008',
          indexWriter: null as unknown as IndexWriter,
          definitionLookup: null as unknown as DefinitionLookup,
          virtualNetwork,
          getReader: () => {
            throw new Error('getReader is not used by screenshot-card');
          },
          getAuthedFetch: async () => globalThis.fetch,
          createPrerenderAuth: () => 'test-auth',
        }),
      );
      await runner.start();
    }

    async function seedInstanceRow(localPath: string, generation = 1) {
      let { nameExpressions, valueExpressions } = asExpressions(
        {
          url: `${REALM_URL}${localPath}.json`,
          file_alias: `${REALM_URL}${localPath}`,
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

    async function seedRealmConfigRow(allowArbitraryScreenshots: boolean) {
      let { nameExpressions, valueExpressions } = asExpressions(
        {
          url: `${REALM_URL}realm.json`,
          file_alias: `${REALM_URL}realm`,
          realm_url: REALM_URL,
          type: 'instance',
          generation: 1,
          last_modified: Date.now(),
          resource_created_at: Date.now(),
          is_deleted: false,
          pristine_doc: { attributes: { allowArbitraryScreenshots } },
        },
        { jsonFields: ['pristine_doc'] },
      );
      await query(
        dbAdapter,
        insert('boxel_index', nameExpressions, valueExpressions),
      );
    }

    async function get(
      pathAndQuery: string,
      method = 'GET',
      headers: Record<string, string> = {},
    ) {
      let response = await realm.handle(
        new Request(`${REALM_URL}${pathAndQuery}`, { method, headers }),
      );
      return response!;
    }

    // The realm-server's POST /_screenshot-card surface wired to this
    // suite's real queue and MediaCache store, so cross-surface tests can
    // prove one capture satisfies both the POST response and its GET
    // `_screenshot/` URL. The matrix stub is never consulted: the realm's
    // permissions have no `users` grant.
    function postScreenshotCard(attributes: Record<string, unknown>) {
      let app = new Koa();
      let router = new Router();
      router.post(
        '/_screenshot-card',
        jwtMiddleware(realmSecretSeed, dbAdapter),
        handleScreenshotCard({
          dbAdapter,
          queue: publisher,
          matrixClient: {
            async getProfile() {
              return null;
            },
          } as unknown as MatrixClient,
          mediaCacheAdapter: adapter,
          screenshotSyncWaitMs: SYNC_WAIT_MS,
        } as unknown as CreateRoutesArgs),
      );
      app.use(router.routes());
      let token = createJWT(
        { user: OWNER, sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );
      return supertest(app.callback())
        .post('/_screenshot-card')
        .set('Authorization', `Bearer ${token}`)
        .send({ data: { type: 'screenshot-card', attributes } });
    }

    test('an already-captured spec serves on a gated realm with zero capture work', async function (assert) {
      await seedInstanceRow('card-1');
      await putMedia(dbAdapter, adapter, {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: await captureSpecHash({ format: 'isolated' }),
        sourceGeneration: 1,
        bytes: PNG_BYTES,
        contentType: 'image/png',
        lane: 'on-demand',
      });

      let response = await get('_screenshot/card-1');

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'image/png');
      assert.deepEqual(
        [...(await nodeStreamToBuffer(response.nodeStream!))],
        [...PNG_BYTES],
      );
      assert.strictEqual(captureCalls, 0, 'no render work occurred');
    });

    test('a gated miss is a 403 naming the flag', async function (assert) {
      await seedInstanceRow('card-1');

      let response = await get('_screenshot/card-1');

      assert.strictEqual(response.status, 403);
      assert.true(
        (await response.text()).includes('allowArbitraryScreenshots'),
        'the refusal names the config flag',
      );
      assert.strictEqual(captureCalls, 0);
    });

    test('flipping the indexed config opens the gate with no restart', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(false);

      assert.strictEqual((await get('_screenshot/card-1')).status, 403);

      // The flag is read from the indexed config on every request, so an
      // index update is all it takes.
      await query(dbAdapter, [
        `UPDATE boxel_index SET pristine_doc = '{"attributes":{"allowArbitraryScreenshots":true}}'::jsonb
         WHERE url = '${REALM_URL}realm.json'`,
      ]);
      await startWorker();

      let response = await get('_screenshot/card-1');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(captureCalls, 1);
    });

    test('an open realm captures on demand, persists, and then serves hits', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      await startWorker();

      let response = await get('_screenshot/card-1?format=embedded');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'image/png');
      assert.deepEqual(
        [...(await nodeStreamToBuffer(response.nodeStream!))],
        [...PNG_BYTES],
      );
      assert.strictEqual(captureCalls, 1);

      let entry = await findMediaCacheEntry(dbAdapter, {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: await captureSpecHash({ format: 'embedded' }),
        sourceGeneration: 1,
      });
      assert.strictEqual(entry?.lane, 'on-demand');

      let second = await get('_screenshot/card-1?format=embedded');
      assert.strictEqual(second.status, 200);
      assert.strictEqual(captureCalls, 1, 'the second request is a pure hit');
    });

    test('a failed capture answers 500 with the short cache window', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      await startWorker(() => ({
        status: 'error',
        error: 'capture failed in the engine',
      }));

      let response = await get('_screenshot/card-1');
      assert.strictEqual(response.status, 500);
      // A failure persists nothing, so no ledger entry short-circuits the
      // repeat; the explicit freshness window is the only thing bounding a
      // capture that fails every time (a fullPage document past the
      // physical-pixel cap) to one render per window instead of one per
      // image load.
      assert.strictEqual(
        response.headers.get('cache-control'),
        `public, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}`,
        'the failure carries the same short window the miss and gate use',
      );
      assert.strictEqual(captureCalls, 1);
    });

    test('an edited instance never serves a stale capture', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      await startWorker();

      await get('_screenshot/card-1');
      assert.strictEqual(captureCalls, 1);

      // An edit bumps the instance's index generation, which is part of the
      // cache key.
      await query(dbAdapter, [
        `UPDATE boxel_index SET generation = 2 WHERE url = '${REALM_URL}card-1.json'`,
      ]);

      let response = await get('_screenshot/card-1');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(captureCalls, 2, 'the edited card re-captured');
    });

    test('a sync wait that outruns the budget answers 503, and the capture still lands', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      captureGate = new Deferred<void>();
      await startWorker();

      let response = await get('_screenshot/card-1');
      assert.strictEqual(response.status, 503);
      assert.ok(
        Number(response.headers.get('retry-after')) >= 1,
        'the 503 carries a Retry-After',
      );

      // The job kept running; once the render finishes it persists its own
      // capture, so the client retry is a pure ledger hit.
      captureGate.fulfill();
      captureGate = undefined;
      let entryKey = {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: await captureSpecHash({ format: 'isolated' }),
        sourceGeneration: 1,
      };
      let deadline = Date.now() + 10_000;
      while (
        !(await findMediaCacheEntry(dbAdapter, entryKey)) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(
        await findMediaCacheEntry(dbAdapter, entryKey),
        'the timed-out capture persisted anyway',
      );
      let capturesSoFar = captureCalls;
      let retry = await get('_screenshot/card-1');
      assert.strictEqual(retry.status, 200);
      assert.strictEqual(
        captureCalls,
        capturesSoFar,
        'the retry re-rendered nothing',
      );
    });

    test('a custom-geometry GET captures, persists under its own spec hash, and then serves hits', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      await startWorker();

      let response = await get('_screenshot/card-1?viewport=1280x800&dsf=2');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(captureCalls, 1);
      assert.deepEqual(
        capturedSpecs[0],
        { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
        'the parsed geometry reached the capture engine',
      );

      let customEntry = await findMediaCacheEntry(dbAdapter, {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: await captureSpecHash({
          format: 'isolated',
          viewport: { width: 1280, height: 800 },
          deviceScaleFactor: 2,
        }),
        sourceGeneration: 1,
      });
      assert.strictEqual(
        customEntry?.lane,
        'on-demand',
        'the capture persisted under the full-spec hash',
      );
      assert.strictEqual(
        await findMediaCacheEntry(dbAdapter, {
          realmURL: REALM_URL,
          sourceURL: `${REALM_URL}card-1`,
          captureSpecHash: await captureSpecHash({ format: 'isolated' }),
          sourceGeneration: 1,
        }),
        undefined,
        'the canonical identity is untouched',
      );

      // Another spelling of the same geometry is the same cache key.
      let second = await get('_screenshot/card-1?dsf=2.0&viewport=1280x800');
      assert.strictEqual(second.status, 200);
      assert.strictEqual(captureCalls, 1, 'the second request is a pure hit');

      // A different geometry is its own capture identity.
      let different = await get('_screenshot/card-1?viewport=640x480');
      assert.strictEqual(different.status, 200);
      assert.strictEqual(captureCalls, 2, 'a new spec renders fresh');
    });

    test('the task refuses to persist a render whose spec contradicts the persist identity', async function (assert) {
      // A producer bug no parse layer can catch: the persist identity names
      // the canonical capture while the job renders a custom viewport.
      // Persisting would serve the 1280×800 render on the canonical URL for
      // as long as the source generation holds, so the task re-hashes the
      // rendered spec and refuses the mismatch — while the capture itself
      // still resolves with its bytes.
      await seedInstanceRow('card-1');
      await startWorker();

      let job = await enqueueScreenshotCardJob(
        {
          realmURL: REALM_URL,
          realmUsername: OWNER,
          runAs: OWNER,
          cardId: `${REALM_URL}card-1`,
          format: 'isolated',
          captureSpec: { viewport: { width: 1280, height: 800 } },
          persist: {
            realmURL: REALM_URL,
            sourceURL: `${REALM_URL}card-1`,
            captureSpecHash: await captureSpecHash({ format: 'isolated' }),
            sourceGeneration: 1,
            lane: 'on-demand',
          },
          surface: 'get-dsl',
          loggingCorrelationId: null,
        },
        publisher,
        dbAdapter,
        0,
      );
      let result = await job.done;
      assert.strictEqual(
        result.status,
        'ready',
        'the capture itself still succeeds',
      );
      assert.strictEqual(
        await findMediaCacheEntry(dbAdapter, {
          realmURL: REALM_URL,
          sourceURL: `${REALM_URL}card-1`,
          captureSpecHash: await captureSpecHash({ format: 'isolated' }),
          sourceGeneration: 1,
        }),
        undefined,
        'nothing lands under the mismatched identity',
      );
    });

    test('concurrent misses for one spec coalesce onto one capture', async function (assert) {
      // A custom geometry rather than the bare URL: the persist identity's
      // spec hash is what keys the twin match, so this exercises coalescing
      // for exactly the captures that used to be uncoalesceable.
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      // Recent capture history keeps the congestion pre-check's estimate
      // under the budget while the first capture is in flight, so the
      // second request reaches the queue and can coalesce instead of
      // failing fast.
      let job = await insertJob(dbAdapter, {
        job_type: 'screenshot-card',
        concurrency_group: `screenshot:${REALM_URL}`,
        status: 'resolved',
        finished_at: new Date().toISOString(),
        result: {},
      });
      await query(dbAdapter, [
        `INSERT INTO job_reservations (job_id, created_at, locked_until, completed_at, worker_id)
         VALUES (${Number(job.id)}, NOW() - INTERVAL '200 milliseconds', NOW(), NOW(), 'test-worker')`,
      ]);
      captureGate = new Deferred<void>();
      await startWorker();

      let first = get('_screenshot/card-1?viewport=1280x800');
      // Wait for the first capture to be claimed and parked on the gate so
      // the second request's publish sees it as an in-flight twin.
      let deadline = Date.now() + 5000;
      while (captureCalls === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      let second = get('_screenshot/card-1?viewport=1280x800');
      // Give the second request time to publish (and coalesce) before the
      // render completes.
      await new Promise((resolve) => setTimeout(resolve, 100));
      captureGate.fulfill();
      captureGate = undefined;

      let [firstResponse, secondResponse] = await Promise.all([first, second]);
      assert.strictEqual(firstResponse.status, 200);
      assert.strictEqual(secondResponse.status, 200);
      assert.strictEqual(
        captureCalls,
        1,
        'both requests were satisfied by one render',
      );
    });

    test('a congested lane fails fast with 503 + Retry-After', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      // A queued capture already holds the realm's serialized lane; with no
      // worker started it stays pending, and pending × the default capture
      // estimate dwarfs the budget.
      await insertJob(dbAdapter, {
        job_type: 'screenshot-card',
        concurrency_group: `screenshot:${REALM_URL}`,
      });

      let response = await get('_screenshot/card-1');

      assert.strictEqual(response.status, 503);
      assert.ok(Number(response.headers.get('retry-after')) >= 1);
      assert.strictEqual(captureCalls, 0, 'nothing was enqueued or rendered');
    });

    test('HEAD never reaches the screenshot route, even for a captured spec', async function (assert) {
      // checkPermission exempts HEAD from auth realm-wide; the GET-only
      // dispatch is what keeps HEAD from becoming an unauthenticated
      // existence/size/content-hash oracle. Even a spec with a live capture
      // answers a HEAD from the generic handlers, not this route.
      await seedInstanceRow('card-1');
      await putMedia(dbAdapter, adapter, {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: await captureSpecHash({ format: 'isolated' }),
        sourceGeneration: 1,
        bytes: PNG_BYTES,
        contentType: 'image/png',
        lane: 'on-demand',
      });

      let response = await get('_screenshot/card-1', 'HEAD');

      assert.notStrictEqual(response.status, 200);
      assert.strictEqual(
        response.headers.get('etag'),
        null,
        'no content-hash validator leaks',
      );
      assert.strictEqual(captureCalls, 0);
    });

    test('parameter errors are 400s naming the field', async function (assert) {
      await seedInstanceRow('card-1');

      let unknown = await get('_screenshot/card-1?sparkle=true');
      assert.strictEqual(unknown.status, 400);
      assert.true((await unknown.text()).includes('sparkle'));

      let mixed = await get('_screenshot/card-1?name=hero&format=embedded');
      assert.strictEqual(mixed.status, 400);
      assert.true((await mixed.text()).includes('name cannot be combined'));
    });

    test('a missing instance is an uncaptured miss, not a capture attempt', async function (assert) {
      await seedRealmConfigRow(true);
      await startWorker();

      let response = await get('_screenshot/nope');

      assert.strictEqual(response.status, 404);
      assert.strictEqual(captureCalls, 0);
      assert.deepEqual(perfEvents, [], 'addressing misses emit no telemetry');
    });

    test('one custom capture satisfies both surfaces: a POST persists it, its GET URL serves it', async function (assert) {
      await seedInstanceRow('card-1');
      // The realm's capture gate stays closed: the POST surface captures
      // under realm-read trust, and the GET route serves existing ledger
      // entries regardless of the gate.
      await startWorker();
      let captureSpec = {
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
      };

      let response = await postScreenshotCard({
        realmURL: REALM_URL,
        cardId: `${REALM_URL}card-1`,
        format: 'isolated',
        captureSpec,
      });
      assert.strictEqual(response.status, 201);
      assert.strictEqual(captureCalls, 1);
      let served = response.body.data.attributes.captures?.[0]?.url as string;
      assert.strictEqual(
        served,
        `${REALM_URL}_screenshot/card-1?viewport=1280x800&dsf=2`,
        'the served URL spells the spec in the GET grammar',
      );

      let getResponse = await get(served.slice(REALM_URL.length));
      assert.strictEqual(getResponse.status, 200);
      assert.deepEqual(
        [...(await nodeStreamToBuffer(getResponse.nodeStream!))],
        [...PNG_BYTES],
      );
      assert.strictEqual(
        captureCalls,
        1,
        'the GET serve is a pure ledger hit on the POSTed capture',
      );
    });

    test('a timed-out custom-spec POST persists anyway; the retry answers from the ledger', async function (assert) {
      await seedInstanceRow('card-1');
      captureGate = new Deferred<void>();
      await startWorker();
      let captureSpec = { viewport: { width: 1280, height: 800 } };
      let attributes = {
        realmURL: REALM_URL,
        cardId: `${REALM_URL}card-1`,
        format: 'isolated',
        captureSpec,
      };

      let response = await postScreenshotCard(attributes);
      assert.strictEqual(response.status, 503);
      assert.ok(
        Number(response.headers['retry-after']) >= 1,
        'the 503 carries a Retry-After',
      );

      // The abandoned job still lands its capture under the full-spec
      // identity — the honesty the Retry-After hint rests on.
      captureGate.fulfill();
      captureGate = undefined;
      let entryKey = {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: await captureSpecHash({
          format: 'isolated' as const,
          ...captureSpec,
        }),
        sourceGeneration: 1,
      };
      let deadline = Date.now() + 10_000;
      while (
        !(await findMediaCacheEntry(dbAdapter, entryKey)) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(
        await findMediaCacheEntry(dbAdapter, entryKey),
        'the timed-out custom capture persisted anyway',
      );

      let capturesSoFar = captureCalls;
      let retry = await postScreenshotCard(attributes);
      assert.strictEqual(retry.status, 201);
      assert.strictEqual(
        captureCalls,
        capturesSoFar,
        'the retry re-rendered nothing',
      );
      assert.strictEqual(
        retry.body.data.attributes.captures?.[0]?.url,
        `${REALM_URL}_screenshot/card-1?viewport=1280x800`,
      );
    });

    module('capture-stage telemetry', function () {
      function requestEvent(): ScreenshotRequestPerfEvent | undefined {
        return perfEvents.find(
          (event): event is ScreenshotRequestPerfEvent =>
            event.eventType === 'request',
        );
      }
      function captureEvent(): ScreenshotCapturePerfEvent | undefined {
        return perfEvents.find(
          (event): event is ScreenshotCapturePerfEvent =>
            event.eventType === 'capture',
        );
      }

      test('a rendered capture emits correlated request and capture records, and the ledger row keeps the breakdown', async function (assert) {
        await seedInstanceRow('card-1');
        await seedRealmConfigRow(true);
        await startWorker();

        let response = await get('_screenshot/card-1?format=embedded', 'GET', {
          'x-boxel-logging-correlation-id': 'corr-dsl-1',
        });
        assert.strictEqual(response.status, 200);

        let request = requestEvent();
        assert.strictEqual(request?.outcome, 'rendered');
        assert.strictEqual(request?.surface, 'get-dsl');
        assert.strictEqual(request?.correlationId, 'corr-dsl-1');
        assert.false(request?.hasTwin);
        assert.strictEqual(request?.sourceURL, `${REALM_URL}card-1`);
        assert.strictEqual(typeof request?.jobId, 'number');
        let stages = [
          'generationLookupMs',
          'ledgerLookupMs',
          'gateMs',
          'precheckMs',
          'enqueueMs',
          'jobWaitMs',
          'serveMs',
        ] as const;
        let stageSum = 0;
        for (let stage of stages) {
          let value = request?.[stage];
          assert.strictEqual(typeof value, 'number', `${stage} is recorded`);
          stageSum += value as number;
        }
        assert.ok(
          stageSum <= request!.totalMs,
          `stages (${stageSum}ms) sum to at most the wall-clock (${request!.totalMs}ms)`,
        );

        let capture = captureEvent();
        assert.strictEqual(capture?.status, 'ready');
        assert.strictEqual(
          capture?.correlationId,
          'corr-dsl-1',
          'the capture record carries the surface request correlation id',
        );
        assert.strictEqual(
          capture?.jobId,
          request?.jobId,
          'request and capture records join on the job id',
        );
        assert.strictEqual(typeof capture?.reservationId, 'number');
        assert.strictEqual(
          typeof capture?.queueWaitMs,
          'number',
          'queue wait comes from the claim clock via JobInfo',
        );
        assert.strictEqual(capture?.surface, 'get-dsl');
        assert.strictEqual(capture?.lane, 'on-demand');
        assert.strictEqual(capture?.persistOutcome, 'uploaded');
        assert.strictEqual(capture?.prerenderRequestId, 'stub-prerender-req');
        assert.strictEqual(capture?.launchMs, 5);
        assert.strictEqual(capture?.semaphoreMs, 1);
        assert.strictEqual(capture?.renderMs, 20);
        assert.strictEqual(capture?.navMs, 4);
        assert.strictEqual(capture?.settleMs, 6);
        assert.strictEqual(capture?.imagePaintMs, 7);
        assert.strictEqual(capture?.screenshotMs, 3);
        assert.true(capture?.tabReused);
        assert.strictEqual(typeof capture?.permissionsMs, 'number');
        assert.strictEqual(typeof capture?.prerenderMs, 'number');
        assert.strictEqual(typeof capture?.decodeMs, 'number');
        assert.strictEqual(typeof capture?.persistMs, 'number');

        let entry = await findMediaCacheEntry(dbAdapter, {
          realmURL: REALM_URL,
          sourceURL: `${REALM_URL}card-1`,
          captureSpecHash: await captureSpecHash({ format: 'embedded' }),
          sourceGeneration: 1,
        });
        let diagnostics = entry?.diagnostics as
          | Record<string, unknown>
          | null
          | undefined;
        assert.strictEqual(
          diagnostics?.eventType,
          'capture',
          'the ledger row persists the capture record',
        );
        assert.strictEqual(diagnostics?.persistOutcome, 'uploaded');
        assert.strictEqual(diagnostics?.correlationId, 'corr-dsl-1');
        assert.strictEqual(typeof diagnostics?.queueWaitMs, 'number');
      });

      test('a ledger hit is visibly the hit path: one request record, zero render attribution', async function (assert) {
        await seedInstanceRow('card-1');
        await putMedia(dbAdapter, adapter, {
          realmURL: REALM_URL,
          sourceURL: `${REALM_URL}card-1`,
          captureSpecHash: await captureSpecHash({ format: 'isolated' }),
          sourceGeneration: 1,
          bytes: PNG_BYTES,
          contentType: 'image/png',
          lane: 'on-demand',
        });

        let response = await get('_screenshot/card-1');
        assert.strictEqual(response.status, 200);

        assert.strictEqual(perfEvents.length, 1, 'one record for a hit');
        let request = requestEvent();
        assert.strictEqual(request?.outcome, 'hit');
        assert.strictEqual(request?.jobId, null, 'no job ran');
        assert.strictEqual(request?.jobWaitMs, undefined);
        assert.strictEqual(typeof request?.serveMs, 'number');
        assert.strictEqual(typeof request?.ledgerLookupMs, 'number');
      });

      test('a gated miss emits a gated record and stops at the gate', async function (assert) {
        await seedInstanceRow('card-1');

        let response = await get('_screenshot/card-1');
        assert.strictEqual(response.status, 403);

        let request = requestEvent();
        assert.strictEqual(request?.outcome, 'gated');
        assert.strictEqual(typeof request?.gateMs, 'number');
        assert.strictEqual(request?.precheckMs, undefined);
        assert.strictEqual(request?.enqueueMs, undefined);
      });

      test('a congested 503 emits a congested record and upholds the Retry-After contract', async function (assert) {
        await seedInstanceRow('card-1');
        await seedRealmConfigRow(true);
        await insertJob(dbAdapter, {
          job_type: 'screenshot-card',
          concurrency_group: `screenshot:${REALM_URL}`,
        });

        let response = await get('_screenshot/card-1');

        assert.strictEqual(response.status, 503);
        // The client half of this contract is the host's auth service
        // worker, which absorbs exactly a 503 whose Retry-After parses as a
        // number and which it can read cross-origin — so both properties
        // are pinned here, not just prose.
        let retryAfter = response.headers.get('retry-after');
        assert.true(
          Number.isInteger(Number(retryAfter)),
          `Retry-After is an integer (got ${retryAfter})`,
        );
        assert.true(
          Number(retryAfter) >= 1,
          `Retry-After is at least one second (got ${retryAfter})`,
        );
        assert.ok(
          (response.headers.get('access-control-expose-headers') ?? '')
            .toLowerCase()
            .includes('retry-after'),
          'Retry-After is CORS-exposed so cross-origin callers can read it',
        );

        let request = requestEvent();
        assert.strictEqual(request?.outcome, 'congested');
        assert.false(request?.hasTwin);
        assert.strictEqual(typeof request?.precheckMs, 'number');
        assert.strictEqual(request?.enqueueMs, undefined, 'nothing enqueued');
      });

      test('a timed-out sync wait emits a timeout record; the capture record follows when the job lands', async function (assert) {
        await seedInstanceRow('card-1');
        await seedRealmConfigRow(true);
        captureGate = new Deferred<void>();
        await startWorker();

        let response = await get('_screenshot/card-1');
        assert.strictEqual(response.status, 503);

        let request = requestEvent();
        assert.strictEqual(request?.outcome, 'timeout');
        assert.strictEqual(typeof request?.jobId, 'number');
        assert.ok(
          (request?.jobWaitMs ?? 0) >= SYNC_WAIT_MS - 50,
          'the wait ran the full sync budget',
        );

        captureGate.fulfill();
        captureGate = undefined;
        let deadline = Date.now() + 10_000;
        while (!captureEvent() && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        let capture = captureEvent();
        assert.strictEqual(
          capture?.jobId,
          request?.jobId,
          'the late capture record still joins the timed-out request',
        );
        assert.strictEqual(capture?.persistOutcome, 'uploaded');
      });

      test('re-capturing identical bytes records a dedupe-on-write hit', async function (assert) {
        await seedInstanceRow('card-1');
        await seedRealmConfigRow(true);
        await startWorker();

        assert.strictEqual((await get('_screenshot/card-1')).status, 200);
        // An edit bumps the generation — a new capture identity — but the
        // stub render produces the same bytes, so the store dedupes the
        // upload while the ledger gains a row.
        await query(dbAdapter, [
          `UPDATE boxel_index SET generation = 2 WHERE url = '${REALM_URL}card-1.json'`,
        ]);
        perfEvents = [];
        setScreenshotPerfSink((event) => perfEvents.push(event));

        assert.strictEqual((await get('_screenshot/card-1')).status, 200);
        assert.strictEqual(captureCalls, 2, 'the edit forced a re-render');
        assert.strictEqual(captureEvent()?.persistOutcome, 'deduped');
      });
    });
  });
});
