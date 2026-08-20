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

import { setupDB } from './helpers/index.ts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// In-memory MediaCacheAdapter: enough store to observe what the sweep
// deletes, plus scriptable per-key delete failures.
class FakeMediaCacheAdapter implements MediaCacheAdapter {
  objects = new Map<string, Uint8Array>();
  deleted: string[] = [];
  failDeletesFor = new Set<string>();

  async put(key: string, bytes: Uint8Array, _opts: { contentType: string }) {
    if (!this.objects.has(key)) {
      this.objects.set(key, bytes);
    }
  }
  async head(key: string) {
    let bytes = this.objects.get(key);
    return bytes ? { size: bytes.length } : undefined;
  }
  async getStream(key: string) {
    let bytes = this.objects.get(key);
    if (!bytes) {
      return undefined;
    }
    return (async function* () {
      yield bytes;
    })();
  }
  async delete(key: string) {
    if (this.failDeletesFor.has(key)) {
      throw new Error(`simulated delete failure for ${key}`);
    }
    this.deleted.push(key);
    this.objects.delete(key);
  }
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

  async function seedTombstone(sourceURL: string, realmURL: string) {
    let { nameExpressions, valueExpressions } = asExpressions({
      url: sourceURL,
      file_alias: sourceURL,
      realm_url: realmURL,
      type: 'instance',
      generation: 1,
      is_deleted: true,
    });
    await query(
      dbAdapter,
      insert('boxel_index', nameExpressions, valueExpressions),
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
