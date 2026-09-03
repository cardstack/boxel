import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import type {
  DeclaredScreenshotCaptureResult,
  QueuePublisher,
} from '@cardstack/runtime-common';
import {
  canonicalDeclaredCaptureString,
  computeMediaCacheKey,
  declaredCaptureSpecHash,
  logger,
  query,
  shouldCarryForwardDeclaredEntry,
  type ScreenshotManifest,
} from '@cardstack/runtime-common';
import { persistDeclaredScreenshots } from '@cardstack/runtime-common/index-runner/prerender-html-visit';

import { FakeMediaCacheAdapter } from './helpers/fake-media-cache-adapter.ts';
import { setupDB } from './helpers/index.ts';

const realmURL = new URL('http://example.test/realm/');
const sourceURL = `${realmURL.href}mango`;
const jobInfo = {
  jobId: 1,
  reservationId: 1,
  priority: 0,
  queueWaitMs: null,
};
const log = logger('declared-screenshot-persist-test');

// A tiny valid-enough payload; the persist path treats bytes as opaque.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const PNG_BASE64 = Buffer.from(PNG_BYTES).toString('base64');

function captureResult(
  overrides: Partial<DeclaredScreenshotCaptureResult> = {},
): DeclaredScreenshotCaptureResult {
  return {
    name: 'card',
    specHash: 'a'.repeat(64),
    width: 400,
    height: 300,
    deviceScaleFactor: 2,
    contentType: 'image/png',
    imageType: 'png',
    keyBy: 'generation',
    base64: PNG_BASE64,
    ...overrides,
  };
}

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;
  let adapter: FakeMediaCacheAdapter;

  setupDB(hooks, {
    beforeEach: async (
      _dbAdapter: PgAdapter,
      _publisher: QueuePublisher,
    ): Promise<void> => {
      dbAdapter = _dbAdapter;
      adapter = new FakeMediaCacheAdapter();
    },
  });

  function persist(args: {
    result: Parameters<typeof persistDeclaredScreenshots>[0]['result'];
    priorManifest?: ScreenshotManifest | null;
    contentHash?: string;
    sourceGeneration?: number;
  }) {
    return persistDeclaredScreenshots({
      result: args.result,
      priorManifest: args.priorManifest ?? null,
      dbAdapter,
      mediaCacheAdapter: adapter,
      realmURL,
      sourceURL,
      sourceGeneration: args.sourceGeneration ?? 7,
      contentHash: args.contentHash,
      jobInfo,
      log,
    });
  }

  async function ledgerRows() {
    return (await query(dbAdapter, [
      `SELECT source_url, capture_spec_hash, source_generation, object_key, source_content_hash, lane, content_type, width, height FROM media_cache_ledger ORDER BY capture_spec_hash`,
    ])) as unknown as Record<string, unknown>[];
  }

  test('the declared capture identity applies defaults and keys the slot name', async function (assert) {
    let base = { width: 400, height: 300, format: 'fitted' as const };
    assert.strictEqual(
      await declaredCaptureSpecHash('card', base),
      await declaredCaptureSpecHash('card', {
        ...base,
        deviceScaleFactor: 2,
        background: 'white',
        type: 'png',
      }),
      'implicit and explicit default spellings share one identity',
    );
    assert.notStrictEqual(
      await declaredCaptureSpecHash('card', base),
      await declaredCaptureSpecHash('poster', base),
      'the slot name is part of the identity',
    );
    assert.notStrictEqual(
      await declaredCaptureSpecHash('card', base),
      await declaredCaptureSpecHash('card', { ...base, render: true }),
      'a render-based slot never aliases a format-based one',
    );
    assert.strictEqual(
      await declaredCaptureSpecHash('card', base),
      await declaredCaptureSpecHash('card', {
        ...base,
        keyBy: 'generation',
        useAsThumbnail: true,
      }),
      'invalidation and consumption knobs are not pixel identity',
    );
    let canonical = canonicalDeclaredCaptureString('card', base);
    assert.deepEqual(
      Object.keys(JSON.parse(canonical)),
      [
        'background',
        'declared',
        'deviceScaleFactor',
        'height',
        'source',
        'type',
        'width',
      ],
      'the canonical form is fully-applied and key-sorted',
    );
  });

  test('a fresh capture lands an object, a declared-lane ledger row, and a manifest entry', async function (assert) {
    let specHash = await declaredCaptureSpecHash('card', {
      width: 400,
      height: 300,
      format: 'fitted',
      useAsThumbnail: true,
    });
    let { manifest, errors } = await persist({
      result: {
        entries: [
          captureResult({ specHash, useAsThumbnail: true }),
          captureResult({
            name: 'hero',
            specHash: 'b'.repeat(64),
            contentType: 'image/webp',
            imageType: 'webp',
            width: 640,
            height: 360,
          }),
        ],
      },
    });
    assert.deepEqual(errors, [], 'no per-slot errors');
    let expectedObjectKey = await computeMediaCacheKey(PNG_BYTES);
    assert.deepEqual(Object.keys(manifest!).sort(), ['card', 'hero']);
    assert.deepEqual(manifest!.card, {
      specHash,
      objectKey: expectedObjectKey,
      contentType: 'image/png',
      width: 400,
      height: 300,
      deviceScaleFactor: 2,
      useAsThumbnail: true,
    });
    assert.strictEqual(manifest!.hero.contentType, 'image/webp');
    assert.notOk(
      'sourceContentHash' in manifest!.card,
      'generation-keyed slots record no source hash',
    );

    let rows = await ledgerRows();
    assert.strictEqual(rows.length, 2, 'one ledger row per slot');
    let cardRow = rows.find((r) => r.capture_spec_hash === specHash)!;
    assert.strictEqual(cardRow.lane, 'declared');
    assert.strictEqual(cardRow.source_url, sourceURL, 'extensionless id form');
    assert.strictEqual(cardRow.source_generation, 7);
    assert.strictEqual(cardRow.object_key, expectedObjectKey);
    assert.strictEqual(cardRow.source_content_hash, null);
    assert.strictEqual(cardRow.width, 400);
    assert.strictEqual(cardRow.height, 300);
    assert.ok(
      adapter.objects.has(expectedObjectKey),
      'the bytes landed in the object store',
    );
  });

  test('a file-content-keyed capture records the source hash on ledger and manifest', async function (assert) {
    let { manifest, errors } = await persist({
      result: {
        entries: [captureResult({ keyBy: 'file-content' })],
      },
      contentHash: 'abc123',
    });
    assert.deepEqual(errors, []);
    assert.strictEqual(manifest!.card.sourceContentHash, 'abc123');
    let [row] = await ledgerRows();
    assert.strictEqual(row.source_content_hash, 'abc123');
  });

  test('a carried-forward slot copies the prior manifest entry and persists nothing', async function (assert) {
    let prior: ScreenshotManifest = {
      card: {
        specHash: 'a'.repeat(64),
        objectKey: 'f'.repeat(64),
        contentType: 'image/png',
        width: 400,
        height: 300,
        deviceScaleFactor: 2,
        sourceContentHash: 'abc123',
      },
    };
    let { manifest, errors } = await persist({
      result: {
        entries: [
          captureResult({
            keyBy: 'file-content',
            carriedForward: true,
            base64: undefined,
          }),
        ],
      },
      priorManifest: prior,
      contentHash: 'abc123',
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(manifest!.card, prior.card, 'the prior entry rides along');
    assert.deepEqual(await ledgerRows(), [], 'no new ledger row');
    assert.strictEqual(adapter.objects.size, 0, 'no object written');
  });

  test('per-slot failures land in errors and the manifest omits the name', async function (assert) {
    adapter.failNextPut = true;
    let { manifest, errors } = await persist({
      result: {
        entries: [
          captureResult(),
          // A carry-forward whose prior entry vanished is a per-slot error
          // too, not a crash.
          captureResult({
            name: 'poster',
            carriedForward: true,
            base64: undefined,
          }),
        ],
        errors: [{ name: 'hero', message: 'render never painted' }],
      },
    });
    assert.strictEqual(manifest, null, 'nothing persisted, no manifest');
    assert.deepEqual(errors.map((e) => e.name).sort(), [
      'card',
      'hero',
      'poster',
    ]);
    assert.deepEqual(await ledgerRows(), [], 'the failed put left no row');
  });

  test('an absent capture result means no manifest and no errors', async function (assert) {
    let { manifest, errors } = await persist({ result: undefined });
    assert.strictEqual(manifest, null);
    assert.deepEqual(errors, []);
  });

  // The engine-side carry-forward decision (`captureDeclaredScreenshots`
  // consults this before rendering a slot). Pinned as a unit because the
  // eager pass cannot yet reach it end-to-end: capture runs only for `.json`
  // card instances, and `keyBy: 'file-content'` is only legal on file-backed
  // defs, whose files don't capture in this pass yet.
  module('shouldCarryForwardDeclaredEntry', function () {
    const specHash = 'a'.repeat(64);
    const priorEntry = {
      specHash,
      objectKey: 'f'.repeat(64),
      contentType: 'image/png',
      width: 400,
      height: 300,
      deviceScaleFactor: 2,
      sourceContentHash: 'abc123',
    };

    test('carries forward when spec hash and content hash both match the prior entry', function (assert) {
      assert.true(
        shouldCarryForwardDeclaredEntry({
          keyBy: 'file-content',
          specHash,
          prior: priorEntry,
          contentHash: 'abc123',
        }),
      );
    });

    test('a generation-keyed slot always re-captures', function (assert) {
      assert.false(
        shouldCarryForwardDeclaredEntry({
          keyBy: 'generation',
          specHash,
          prior: priorEntry,
          contentHash: 'abc123',
        }),
      );
    });

    test('a spec change re-captures', function (assert) {
      assert.false(
        shouldCarryForwardDeclaredEntry({
          keyBy: 'file-content',
          specHash: 'b'.repeat(64),
          prior: priorEntry,
          contentHash: 'abc123',
        }),
      );
    });

    test('a source-content change re-captures', function (assert) {
      assert.false(
        shouldCarryForwardDeclaredEntry({
          keyBy: 'file-content',
          specHash,
          prior: priorEntry,
          contentHash: 'def456',
        }),
      );
    });

    test('no prior entry or no content hash re-captures', function (assert) {
      assert.false(
        shouldCarryForwardDeclaredEntry({
          keyBy: 'file-content',
          specHash,
          prior: undefined,
          contentHash: 'abc123',
        }),
      );
      assert.false(
        shouldCarryForwardDeclaredEntry({
          keyBy: 'file-content',
          specHash,
          prior: priorEntry,
          contentHash: undefined,
        }),
      );
      assert.false(
        shouldCarryForwardDeclaredEntry({
          keyBy: 'file-content',
          specHash,
          prior: { ...priorEntry, sourceContentHash: undefined },
          contentHash: 'abc123',
        }),
        'a prior entry that recorded no source hash never matches',
      );
    });
  });
});
