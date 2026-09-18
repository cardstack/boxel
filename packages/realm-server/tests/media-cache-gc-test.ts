import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import type {
  DefinitionLookup,
  IndexWriter,
  MediaCacheAdapter,
  MediaCacheLane,
  Prerenderer,
  QueuePublisher,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  asExpressions,
  computeMediaCacheKey,
  insert,
  logger,
  mediaCacheGc,
  putMedia,
  query,
  touchMediaCacheEntry,
} from '@cardstack/runtime-common';

import { FakeMediaCacheAdapter } from './helpers/fake-media-cache-adapter.ts';
import { setupDB } from './helpers/index.ts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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

  function runGc(
    opts: { mediaCacheAdapter: MediaCacheAdapter | undefined } = {
      mediaCacheAdapter: adapter,
    },
  ) {
    return mediaCacheGc({
      reportStatus: () => {},
      log: logger('media-cache-gc-test'),
      dbAdapter,
      mediaCacheAdapter: opts.mediaCacheAdapter,
      queuePublisher: null as unknown as QueuePublisher,
      indexWriter: null as unknown as IndexWriter,
      prerenderer: null as unknown as Prerenderer,
      definitionLookup: null as unknown as DefinitionLookup,
      virtualNetwork: null as unknown as VirtualNetwork,
      matrixURL: 'http://localhost:8008',
      getReader: () => {
        throw new Error('getReader is not used by media-cache-gc');
      },
      getAuthedFetch: async () => globalThis.fetch,
      createPrerenderAuth: () => '',
    })({});
  }

  async function seedLedgerRow({
    realmURL = 'http://test-realm/a/',
    sourceURL = 'http://test-realm/a/card-1',
    captureSpecHash = 'spec-1',
    sourceGeneration,
    objectKey,
    lane = 'declared' as MediaCacheLane,
    createdAt,
    lastAccessedAt = createdAt,
  }: {
    realmURL?: string;
    sourceURL?: string;
    captureSpecHash?: string;
    sourceGeneration: number;
    objectKey: string;
    lane?: MediaCacheLane;
    createdAt: number;
    lastAccessedAt?: number;
  }) {
    let { nameExpressions, valueExpressions } = asExpressions({
      realm_url: realmURL,
      source_url: sourceURL,
      capture_spec_hash: captureSpecHash,
      source_generation: sourceGeneration,
      object_key: objectKey,
      lane,
      content_type: 'image/png',
      size_bytes: 3,
      created_at: createdAt,
      last_accessed_at: lastAccessedAt,
    });
    await query(
      dbAdapter,
      insert('media_cache_ledger', nameExpressions, valueExpressions),
    );
    adapter.objects.set(objectKey, new Uint8Array([1, 2, 3]));
  }

  async function seedIndexRow({
    url,
    fileAlias = url,
    realmURL,
    type = 'instance',
    isDeleted,
  }: {
    url: string;
    fileAlias?: string;
    realmURL: string;
    type?: 'instance' | 'file';
    isDeleted: boolean;
  }) {
    let { nameExpressions, valueExpressions } = asExpressions({
      url,
      file_alias: fileAlias,
      realm_url: realmURL,
      type,
      generation: 1,
      is_deleted: isDeleted,
    });
    await query(
      dbAdapter,
      insert('boxel_index', nameExpressions, valueExpressions),
    );
  }

  async function seedTombstone(sourceURL: string, realmURL: string) {
    await seedIndexRow({ url: sourceURL, realmURL, isDeleted: true });
  }

  // A live production prerendered row whose `screenshots` manifest is the
  // unreferenced arm's liveness set. `manifestSpecHashes` seeds one entry per
  // hash (names are irrelevant to the arm); null seeds a manifest-less row.
  async function seedPrerenderedRow({
    url,
    fileAlias = url,
    realmURL = 'http://test-realm/a/',
    type = 'instance',
    manifestSpecHashes,
    renderedAt,
  }: {
    url: string;
    fileAlias?: string;
    realmURL?: string;
    type?: 'instance' | 'file';
    manifestSpecHashes: string[] | null;
    renderedAt: number;
  }) {
    let screenshots =
      manifestSpecHashes === null
        ? null
        : Object.fromEntries(
            manifestSpecHashes.map((specHash, i) => [
              `slot-${i}`,
              {
                specHash,
                objectKey: `object-for-${specHash}`,
                contentType: 'image/png',
                width: 170,
                height: 250,
                deviceScaleFactor: 2,
              },
            ]),
          );
    let { nameExpressions, valueExpressions } = asExpressions(
      {
        url,
        file_alias: fileAlias,
        realm_url: realmURL,
        type,
        generation: 1,
        is_deleted: false,
        rendered_at: renderedAt,
        screenshots,
      },
      { jsonFields: ['screenshots'] },
    );
    await query(
      dbAdapter,
      insert('prerendered_html', nameExpressions, valueExpressions),
    );
  }

  async function ledgerRows(): Promise<
    { source_generation: number; object_key: string }[]
  > {
    return (await query(dbAdapter, [
      `SELECT source_generation, object_key FROM media_cache_ledger ORDER BY source_generation`,
    ])) as { source_generation: number; object_key: string }[];
  }

  test('reclaims a superseded generation and its orphaned object', async function (assert) {
    let now = Date.now();
    await seedLedgerRow({
      sourceGeneration: 1,
      objectKey: 'old-object',
      createdAt: now - 3 * DAY,
    });
    await seedLedgerRow({
      sourceGeneration: 2,
      objectKey: 'new-object',
      createdAt: now - 2 * DAY,
    });

    let result = await runGc();

    assert.strictEqual(result.rowsDeleted, 1);
    assert.strictEqual(result.objectsDeleted, 1);
    assert.deepEqual(adapter.deleted, ['old-object']);
    assert.deepEqual(
      (await ledgerRows()).map((row) => Number(row.source_generation)),
      [2],
      'only the superseding row survives',
    );
  });

  test('a row is not superseded until its successor has aged past min-age', async function (assert) {
    let now = Date.now();
    await seedLedgerRow({
      sourceGeneration: 1,
      objectKey: 'old-object',
      createdAt: now - 3 * DAY,
    });
    // The gen-2 capture just landed: a serve that resolved gen 1 moments ago
    // may still be streaming, so gen 1 lingers for the min-age window.
    await seedLedgerRow({
      sourceGeneration: 2,
      objectKey: 'new-object',
      createdAt: now - 1 * HOUR,
    });

    let result = await runGc();

    assert.strictEqual(result.rowsDeleted, 0, 'nothing reclaimed yet');
    assert.deepEqual(adapter.deleted, []);
  });

  test('a young row is never collected, whatever its lane', async function (assert) {
    let now = Date.now();
    await seedLedgerRow({
      sourceGeneration: 1,
      objectKey: 'young-object',
      lane: 'on-demand',
      createdAt: now - 1 * HOUR,
      // Nonsense on purpose: even an ancient last-access cannot reclaim a
      // row younger than min-age.
      lastAccessedAt: now - 400 * DAY,
    });

    let result = await runGc();

    assert.strictEqual(result.rowsDeleted, 0);
  });

  test('reclaims captures of a tombstoned source instance', async function (assert) {
    let now = Date.now();
    await seedLedgerRow({
      sourceURL: 'http://test-realm/a/deleted-card',
      sourceGeneration: 5,
      objectKey: 'tombstoned-object',
      createdAt: now - 2 * DAY,
    });
    await seedTombstone(
      'http://test-realm/a/deleted-card',
      'http://test-realm/a/',
    );

    let result = await runGc();

    assert.strictEqual(result.rowsDeleted, 1);
    assert.deepEqual(adapter.deleted, ['tombstoned-object']);
  });

  test('reclaims captures of a tombstoned source file', async function (assert) {
    let now = Date.now();
    // A file capture's ledger spelling keeps the extension
    // (`screenshotLedgerSourceURL`), and a non-`.json` file has only a
    // type-'file' index row — the tombstone arm must match it or these
    // captures leak forever.
    await seedLedgerRow({
      sourceURL: 'http://test-realm/a/poster.pdf',
      sourceGeneration: 5,
      objectKey: 'tombstoned-file-object',
      createdAt: now - 2 * DAY,
    });
    await seedIndexRow({
      url: 'http://test-realm/a/poster.pdf',
      realmURL: 'http://test-realm/a/',
      type: 'file',
      isDeleted: true,
    });

    let result = await runGc();

    assert.strictEqual(result.rowsDeleted, 1);
    assert.deepEqual(adapter.deleted, ['tombstoned-file-object']);
  });

  test('a tombstone matching only by alias never reclaims a live source', async function (assert) {
    let now = Date.now();
    // A live extensionless file `foo` whose alias a deleted `foo.json`
    // instance shares: the tombstone matches the ledger spelling on
    // `file_alias`, but the live row must veto the reclaim.
    await seedLedgerRow({
      sourceURL: 'http://test-realm/a/foo',
      sourceGeneration: 3,
      objectKey: 'live-file-object',
      createdAt: now - 2 * DAY,
    });
    await seedIndexRow({
      url: 'http://test-realm/a/foo',
      realmURL: 'http://test-realm/a/',
      type: 'file',
      isDeleted: false,
    });
    await seedIndexRow({
      url: 'http://test-realm/a/foo.json',
      fileAlias: 'http://test-realm/a/foo',
      realmURL: 'http://test-realm/a/',
      type: 'instance',
      isDeleted: true,
    });

    let result = await runGc();

    assert.strictEqual(result.rowsDeleted, 0, 'the live source vetoes GC');
    assert.deepEqual(adapter.deleted, []);
    assert.ok(adapter.objects.has('live-file-object'));
  });

  test('ages out idle on-demand captures but never declared ones', async function (assert) {
    let now = Date.now();
    await seedLedgerRow({
      captureSpecHash: 'spec-on-demand',
      sourceGeneration: 1,
      objectKey: 'idle-on-demand',
      lane: 'on-demand',
      createdAt: now - 60 * DAY,
      lastAccessedAt: now - 45 * DAY,
    });
    await seedLedgerRow({
      captureSpecHash: 'spec-on-demand-active',
      sourceGeneration: 1,
      objectKey: 'active-on-demand',
      lane: 'on-demand',
      createdAt: now - 60 * DAY,
      lastAccessedAt: now - 1 * DAY,
    });
    await seedLedgerRow({
      captureSpecHash: 'spec-declared',
      sourceGeneration: 1,
      objectKey: 'idle-declared',
      lane: 'declared',
      createdAt: now - 60 * DAY,
      lastAccessedAt: now - 45 * DAY,
    });

    let result = await runGc();

    assert.strictEqual(result.rowsDeleted, 1);
    assert.deepEqual(
      adapter.deleted,
      ['idle-on-demand'],
      'only the idle on-demand capture is reclaimed',
    );
  });

  test('reclaims a declared row the current manifest no longer references', async function (assert) {
    let now = Date.now();
    // The slot was re-specced: the current manifest carries only the new
    // hash, so nothing ever supersedes the old row (a new hash is a new
    // capture identity) and this arm is its only reclamation path.
    await seedLedgerRow({
      captureSpecHash: 'spec-old',
      sourceGeneration: 1,
      objectKey: 'old-spec-object',
      createdAt: now - 3 * DAY,
    });
    await seedLedgerRow({
      captureSpecHash: 'spec-new',
      sourceGeneration: 2,
      objectKey: 'new-spec-object',
      createdAt: now - 2 * DAY,
    });
    await seedPrerenderedRow({
      url: 'http://test-realm/a/card-1.json',
      fileAlias: 'http://test-realm/a/card-1',
      manifestSpecHashes: ['spec-new'],
      renderedAt: now - 2 * DAY,
    });

    let result = await runGc();

    assert.strictEqual(result.rowsDeleted, 1);
    assert.deepEqual(adapter.deleted, ['old-spec-object']);
    assert.deepEqual(
      (await ledgerRows()).map((row) => row.object_key),
      ['new-spec-object'],
      'the manifest-referenced capture survives',
    );
  });

  test('a manifest-less live row reclaims all declared captures of its source', async function (assert) {
    let now = Date.now();
    // Every slot was deleted from the declaration: the source's current row
    // publishes no manifest at all, so nothing references the old capture.
    await seedLedgerRow({
      captureSpecHash: 'spec-deleted-slot',
      sourceGeneration: 1,
      objectKey: 'deleted-slot-object',
      createdAt: now - 3 * DAY,
    });
    await seedPrerenderedRow({
      url: 'http://test-realm/a/card-1.json',
      fileAlias: 'http://test-realm/a/card-1',
      manifestSpecHashes: null,
      renderedAt: now - 2 * DAY,
    });

    let result = await runGc();

    assert.strictEqual(result.rowsDeleted, 1);
    assert.deepEqual(adapter.deleted, ['deleted-slot-object']);
  });

  test('a freshly published manifest collects nothing until it has held for min-age', async function (assert) {
    let now = Date.now();
    // The manifest dropped the hash moments ago — an author mid-iteration,
    // or a capture failure the retry lane is still working. The stability
    // guard waits a full min-age window before believing it.
    await seedLedgerRow({
      captureSpecHash: 'spec-old',
      sourceGeneration: 1,
      objectKey: 'maybe-orphaned-object',
      createdAt: now - 3 * DAY,
    });
    await seedPrerenderedRow({
      url: 'http://test-realm/a/card-1.json',
      fileAlias: 'http://test-realm/a/card-1',
      manifestSpecHashes: ['spec-new'],
      renderedAt: now - 1 * HOUR,
    });

    let result = await runGc();

    assert.strictEqual(result.rowsDeleted, 0, 'nothing reclaimed yet');
    assert.deepEqual(adapter.deleted, []);
  });

  test('a carried-forward capture survives: its hash stays in the manifest across generations', async function (assert) {
    let now = Date.now();
    // A file-content-keyed capture is never re-persisted while the bytes are
    // unchanged: its ledger row stays at the old generation while the
    // manifest (republished at each new generation) keeps naming its hash.
    // No newer ledger row exists, so the superseded arm can't touch it — and
    // the manifest reference is exactly what keeps this arm off it too.
    await seedLedgerRow({
      captureSpecHash: 'spec-carried',
      sourceGeneration: 1,
      objectKey: 'carried-forward-object',
      createdAt: now - 60 * DAY,
    });
    await seedPrerenderedRow({
      url: 'http://test-realm/a/card-1.json',
      fileAlias: 'http://test-realm/a/card-1',
      manifestSpecHashes: ['spec-carried'],
      renderedAt: now - 2 * DAY,
    });

    let result = await runGc();

    assert.strictEqual(result.rowsDeleted, 0);
    assert.ok(adapter.objects.has('carried-forward-object'));
  });

  test('a source with no prerendered row keeps its declared captures', async function (assert) {
    let now = Date.now();
    // No live row means no manifest to consult — a source mid-first-index,
    // or a realm whose prerender pass hasn't landed. Absence of evidence
    // must not read as an empty roster.
    await seedLedgerRow({
      captureSpecHash: 'spec-1',
      sourceGeneration: 1,
      objectKey: 'unjudgeable-object',
      createdAt: now - 60 * DAY,
    });

    let result = await runGc();

    assert.strictEqual(result.rowsDeleted, 0);
    assert.ok(adapter.objects.has('unjudgeable-object'));
  });

  test('each realm-copied capture answers to its own realm manifest', async function (assert) {
    let now = Date.now();
    // The capture was realm-copied along with its prerendered row; the
    // source realm then re-specced the slot while the destination kept it.
    // Only the source realm's copy is reclaimed.
    for (let realmURL of ['http://test-realm/a/', 'http://test-realm/b/']) {
      await seedLedgerRow({
        realmURL,
        sourceURL: `${realmURL}card-1`,
        captureSpecHash: 'spec-shared',
        sourceGeneration: 1,
        objectKey: `object-${realmURL.endsWith('a/') ? 'a' : 'b'}`,
        createdAt: now - 3 * DAY,
      });
    }
    await seedPrerenderedRow({
      url: 'http://test-realm/a/card-1.json',
      fileAlias: 'http://test-realm/a/card-1',
      realmURL: 'http://test-realm/a/',
      manifestSpecHashes: ['spec-respecced'],
      renderedAt: now - 2 * DAY,
    });
    await seedPrerenderedRow({
      url: 'http://test-realm/b/card-1.json',
      fileAlias: 'http://test-realm/b/card-1',
      realmURL: 'http://test-realm/b/',
      manifestSpecHashes: ['spec-shared'],
      renderedAt: now - 2 * DAY,
    });

    let result = await runGc();

    assert.strictEqual(result.rowsDeleted, 1);
    assert.deepEqual(adapter.deleted, ['object-a']);
    assert.ok(adapter.objects.has('object-b'));
  });

  test('the manifest arm never touches on-demand captures', async function (assert) {
    let now = Date.now();
    // An on-demand capture's spec hash is naturally absent from any declared
    // manifest — that lane lives and dies by its access TTL alone.
    await seedLedgerRow({
      captureSpecHash: 'spec-dsl',
      sourceGeneration: 1,
      objectKey: 'active-dsl-object',
      lane: 'on-demand',
      createdAt: now - 60 * DAY,
      lastAccessedAt: now - 1 * DAY,
    });
    await seedPrerenderedRow({
      url: 'http://test-realm/a/card-1.json',
      fileAlias: 'http://test-realm/a/card-1',
      manifestSpecHashes: ['spec-declared'],
      renderedAt: now - 2 * DAY,
    });

    let result = await runGc();

    assert.strictEqual(result.rowsDeleted, 0);
    assert.ok(adapter.objects.has('active-dsl-object'));
  });

  test('an object still referenced by a surviving row keeps its bytes', async function (assert) {
    let now = Date.now();
    // Two captures produced identical bytes (dedupe): the superseded row is
    // pruned, but the object stays because another capture still points at it.
    await seedLedgerRow({
      captureSpecHash: 'spec-a',
      sourceGeneration: 1,
      objectKey: 'shared-object',
      createdAt: now - 3 * DAY,
    });
    await seedLedgerRow({
      captureSpecHash: 'spec-a',
      sourceGeneration: 2,
      objectKey: 'spec-a-gen2',
      createdAt: now - 2 * DAY,
    });
    await seedLedgerRow({
      captureSpecHash: 'spec-b',
      sourceGeneration: 1,
      objectKey: 'shared-object',
      createdAt: now - 3 * DAY,
    });

    let result = await runGc();

    assert.strictEqual(result.rowsDeleted, 1, 'the superseded row is pruned');
    assert.strictEqual(result.objectsDeleted, 0, 'but its object survives');
    assert.ok(adapter.objects.has('shared-object'));
  });

  test('a failed object delete keeps the rows for the next sweep', async function (assert) {
    let now = Date.now();
    await seedLedgerRow({
      sourceGeneration: 1,
      objectKey: 'stubborn-object',
      createdAt: now - 3 * DAY,
    });
    await seedLedgerRow({
      sourceGeneration: 2,
      objectKey: 'new-object',
      createdAt: now - 2 * DAY,
    });
    adapter.failDeletesFor.add('stubborn-object');

    let result = await runGc();

    assert.strictEqual(result.objectDeleteFailures, 1);
    assert.strictEqual(result.rowsDeleted, 0);
    assert.strictEqual(
      (await ledgerRows()).length,
      2,
      'the failed object keeps its ledger row as the retry path',
    );

    // The failure clears (transient S3 trouble): the next sweep re-finds the
    // same candidate and completes the reclaim.
    adapter.failDeletesFor.clear();
    let retry = await runGc();
    assert.strictEqual(retry.rowsDeleted, 1);
    assert.deepEqual(adapter.deleted, ['stubborn-object']);
  });

  test('no-ops without a configured adapter', async function (assert) {
    let now = Date.now();
    await seedLedgerRow({
      sourceGeneration: 1,
      objectKey: 'old-object',
      createdAt: now - 3 * DAY,
    });
    await seedLedgerRow({
      sourceGeneration: 2,
      objectKey: 'new-object',
      createdAt: now - 2 * DAY,
    });

    let result = await runGc({ mediaCacheAdapter: undefined });

    assert.deepEqual(result, {
      rowsDeleted: 0,
      objectsDeleted: 0,
      objectDeleteFailures: 0,
    });
    assert.strictEqual((await ledgerRows()).length, 2, 'nothing was touched');
  });

  module('putMedia and touchMediaCacheEntry', function () {
    let entryKey = {
      realmURL: 'http://test-realm/a/',
      sourceURL: 'http://test-realm/a/card-1',
      captureSpecHash: 'spec-1',
      sourceGeneration: 1,
    };

    test('stores the object under its content address and records the ledger row', async function (assert) {
      let bytes = new Uint8Array([1, 2, 3, 4]);
      let { objectKey, sizeBytes } = await putMedia(dbAdapter, adapter, {
        ...entryKey,
        bytes,
        contentType: 'image/png',
        lane: 'on-demand',
      });

      assert.strictEqual(objectKey, await computeMediaCacheKey(bytes));
      assert.strictEqual(sizeBytes, 4);
      assert.deepEqual([...adapter.objects.get(objectKey)!], [...bytes]);
      let rows = await ledgerRows();
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].object_key, objectKey);
    });

    test('a re-capture upserts its row, repointing at the new bytes', async function (assert) {
      let first = await putMedia(dbAdapter, adapter, {
        ...entryKey,
        bytes: new Uint8Array([1]),
        contentType: 'image/png',
        lane: 'on-demand',
      });
      let second = await putMedia(dbAdapter, adapter, {
        ...entryKey,
        bytes: new Uint8Array([2]),
        contentType: 'image/png',
        lane: 'on-demand',
      });

      assert.notStrictEqual(first.objectKey, second.objectKey);
      let rows = await ledgerRows();
      assert.strictEqual(rows.length, 1, 'still one row for the capture');
      assert.strictEqual(
        rows[0].object_key,
        second.objectKey,
        'the row points at the latest bytes',
      );
      assert.notOk(
        adapter.objects.has(first.objectKey),
        'the repointed-away object is reclaimed inline — the GC sweep could never find it',
      );
      assert.deepEqual(adapter.deleted, [first.objectKey]);
    });

    test('a repoint keeps the prior object when another capture still names it', async function (assert) {
      let sharedBytes = new Uint8Array([1]);
      await putMedia(dbAdapter, adapter, {
        ...entryKey,
        bytes: sharedBytes,
        contentType: 'image/png',
        lane: 'on-demand',
      });
      // A second capture identity produced identical bytes (dedupe), so the
      // object is shared.
      let other = await putMedia(dbAdapter, adapter, {
        ...entryKey,
        captureSpecHash: 'spec-2',
        bytes: sharedBytes,
        contentType: 'image/png',
        lane: 'on-demand',
      });
      await putMedia(dbAdapter, adapter, {
        ...entryKey,
        bytes: new Uint8Array([2]),
        contentType: 'image/png',
        lane: 'on-demand',
      });

      assert.ok(
        adapter.objects.has(other.objectKey),
        'the shared object survives the repoint',
      );
      assert.deepEqual(adapter.deleted, []);
    });

    test('a failed repoint reclaim does not fail the put', async function (assert) {
      let first = await putMedia(dbAdapter, adapter, {
        ...entryKey,
        bytes: new Uint8Array([1]),
        contentType: 'image/png',
        lane: 'on-demand',
      });
      adapter.failDeletesFor.add(first.objectKey);

      let second = await putMedia(dbAdapter, adapter, {
        ...entryKey,
        bytes: new Uint8Array([2]),
        contentType: 'image/png',
        lane: 'on-demand',
      });

      let rows = await ledgerRows();
      assert.strictEqual(
        rows[0].object_key,
        second.objectKey,
        'the new capture is recorded despite the failed reclaim',
      );
    });

    test('touch bumps last_accessed_at', async function (assert) {
      await putMedia(dbAdapter, adapter, {
        ...entryKey,
        bytes: new Uint8Array([1]),
        contentType: 'image/png',
        lane: 'on-demand',
      });
      let later = Date.now() + 5000;
      await touchMediaCacheEntry(dbAdapter, entryKey, later);

      let [row] = (await query(dbAdapter, [
        `SELECT last_accessed_at FROM media_cache_ledger`,
      ])) as { last_accessed_at: number | string }[];
      assert.strictEqual(Number(row.last_accessed_at), later);
    });
  });
});
