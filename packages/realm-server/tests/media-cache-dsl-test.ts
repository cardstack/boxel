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
  ScreenshotPrerenderResponse,
  VirtualNetwork as VirtualNetworkType,
} from '@cardstack/runtime-common';
import {
  Deferred,
  VirtualNetwork,
  asExpressions,
  canonicalCaptureSpecString,
  captureSpecHash,
  findMediaCacheEntry,
  insert,
  logger,
  parseCaptureSpecParams,
  putMedia,
  query,
  screenshotCard,
} from '@cardstack/runtime-common';

import { FakeMediaCacheAdapter } from './helpers/fake-media-cache-adapter.ts';
import { createRealm, insertJob, setupDB } from './helpers/index.ts';
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

    test('errors name the offending field', function (assert) {
      let unknown = parseCaptureSpecParams(params('sparkle=true'));
      assert.deepEqual(unknown, {
        error: { field: 'sparkle', message: 'unsupported parameter "sparkle"' },
      });

      let reserved = parseCaptureSpecParams(params('viewport=1280x800'));
      assert.strictEqual(
        'error' in reserved ? reserved.error.field : undefined,
        'viewport',
      );

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
  });

  module('GET _screenshot capture flow', function (hooks) {
    let dbAdapter: PgAdapter;
    let publisher: QueuePublisher;
    let runner: QueueRunner;
    let realm: Realm;
    let adapter: FakeMediaCacheAdapter;
    let virtualNetwork: VirtualNetworkType;
    let captureCalls: number;
    // When set, in-flight captures park on it — the lever for the sync-wait
    // timeout test.
    let captureGate: Deferred<void> | undefined;

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
    // jobs unclaimed on purpose.
    async function startWorker() {
      let prerenderer = {
        prerenderScreenshot: async (): Promise<ScreenshotPrerenderResponse> => {
          captureCalls++;
          if (captureGate) {
            await captureGate.promise;
          }
          return {
            status: 'ready',
            base64: PNG_BASE64,
            width: 8,
            height: 6,
            contentType: 'image/png',
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

    async function get(pathAndQuery: string, method = 'GET') {
      let response = await realm.handle(
        new Request(`${REALM_URL}${pathAndQuery}`, { method }),
      );
      return response!;
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
    });
  });
});
