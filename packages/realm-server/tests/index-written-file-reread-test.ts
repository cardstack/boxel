import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  IndexWriter,
  VirtualNetwork,
  type DefinitionLookup,
  type Prerenderer,
  type Reader,
  type RenderVisitResponse,
} from '@cardstack/runtime-common';
import { IndexRunner } from '@cardstack/runtime-common/index-runner';
import { WrittenFileRereads } from '@cardstack/runtime-common/index-runner/written-file-rereads';
import type { PgAdapter } from '@cardstack/postgres';
import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

module(basename(import.meta.filename), function () {
  module('an incremental pass', function (hooks) {
    let adapter: PgAdapter;

    hooks.beforeEach(async function () {
      prepareTestDB();
      adapter = await createTestPgAdapter();
    });

    hooks.afterEach(async function () {
      await closeTestPgAdapter(adapter);
    });

    const url = (name: string) => `${testRealm}${name}`;

    // A realm whose reads of a file come back missing a set number of times
    // before the file is served, the way a realm-server instance with a stale
    // view of the directory answers until its view catches up.
    function realmReader(files: Record<string, { missFor?: number }>) {
      let reads = new Map<string, number>();
      let reader: Reader = {
        async readFile(fileURL: URL) {
          let count = (reads.get(fileURL.href) ?? 0) + 1;
          reads.set(fileURL.href, count);
          let name = fileURL.href.slice(testRealm.length);
          let file = files[name];
          if (!file || count <= (file.missFor ?? 0)) {
            return undefined;
          }
          return {
            content: `the contents of ${name}`,
            lastModified: 1,
            path: name,
          };
        },
        async readStream() {
          return undefined;
        },
        async mtimes() {
          return {};
        },
      };
      return { reader, readsOf: (name: string) => reads.get(url(name)) ?? 0 };
    }

    // Renders every visit as a plain text file.
    const prerenderer = {
      async prerenderVisit(): Promise<RenderVisitResponse> {
        return {
          fileExtract: {
            id: 'extract',
            nonce: 'nonce',
            status: 'ready',
            searchDoc: {},
            resource: null,
            deps: [],
            types: ['https://cardstack.com/base/file-api/FileDef'],
          },
        };
      },
      async releaseBatch() {},
      async prerenderModule() {
        throw new Error('this pass renders no modules');
      },
      async runCommand() {
        throw new Error('this pass runs no commands');
      },
    } as unknown as Prerenderer;

    // Job ids for passes with no `jobs` row, well clear of the ids the table
    // hands out, and one per pass so no pass reads another's staged rows as
    // its own earlier attempt.
    let jobCounter = 2_000_000;

    async function runIncremental(
      reader: Reader,
      changes: { name: string; operation: 'update' | 'delete' }[],
      writtenFileRereadDelaysMs: readonly number[],
    ) {
      let virtualNetwork = new VirtualNetwork();
      let runner = new IndexRunner({
        realmURL: new URL(testRealm),
        jobInfo: {
          jobId: jobCounter++,
          reservationId: 1,
          priority: 0,
          queueWaitMs: null,
          concurrencyGroup: null,
          laneFamily: null,
        },
        reader,
        indexWriter: new IndexWriter(adapter),
        definitionLookup: {} as DefinitionLookup,
        virtualNetwork,
        prerenderer,
        auth: 'auth',
        fetch: (async () => {
          throw new Error('this pass fetches nothing');
        }) as unknown as typeof globalThis.fetch,
        realmOwnerUserId: 'test_realm',
        writtenFileRereadDelaysMs,
      });
      return await IndexRunner.incremental(runner, {
        changes: changes.map(({ name, operation }) => ({
          url: new URL(url(name)),
          operation,
        })),
      });
    }

    async function fileRow(name: string) {
      let [row] = (await adapter.execute(
        `SELECT is_deleted FROM boxel_index WHERE url = $1 AND type = 'file'`,
        { bind: [url(name)] },
      )) as { is_deleted: boolean | null }[];
      return row;
    }

    // The record the realm keeps of a file it wrote, which it removes when it
    // removes the file.
    async function realmRecordsFile(name: string) {
      await adapter.execute(
        `INSERT INTO realm_file_meta (realm_url, file_path, created_at) VALUES ($1, $2, 1)`,
        { bind: [testRealm, name] },
      );
    }

    test('indexes a written file that reads as missing at first', async function (assert) {
      await realmRecordsFile('notes.txt');
      // The visit reads the file under both of its URL forms before it gives
      // up, so two misses are one failed attempt.
      let { reader, readsOf } = realmReader({ 'notes.txt': { missFor: 2 } });

      await runIncremental(
        reader,
        [{ name: 'notes.txt', operation: 'update' }],
        [5, 5, 5],
      );

      let row = await fileRow('notes.txt');
      assert.ok(row, 'the file has an index row');
      assert.false(Boolean(row?.is_deleted), 'and the row is live');
      assert.strictEqual(
        readsOf('notes.txt'),
        3,
        'the visit read the file again once it read as missing',
      );
    });

    test('takes a written file that stays missing as removed once the window closes', async function (assert) {
      await realmRecordsFile('notes.txt');
      let { reader, readsOf } = realmReader({});

      await runIncremental(
        reader,
        [{ name: 'notes.txt', operation: 'update' }],
        [20, 20],
      );

      assert.strictEqual(
        await fileRow('notes.txt'),
        undefined,
        'the pass writes no row for a file it never read',
      );
      // Each attempt reads both URL forms: the first attempt, then one per
      // delay that still fits in the window.
      let reads = readsOf('notes.txt');
      let rereadWithinWindow = reads >= 4 && reads <= 6;
      assert.true(
        rereadWithinWindow,
        `the file was re-read within the window and then given up on (${reads} reads)`,
      );
    });

    test('does not wait on a written file the realm has since removed', async function (assert) {
      // The write's pass runs after a later delete removed the file and the
      // realm's record of it.
      let { reader, readsOf } = realmReader({});
      let start = Date.now();

      // Any re-read would hold the pass for a minute.
      await runIncremental(
        reader,
        [{ name: 'notes.txt', operation: 'update' }],
        [60_000],
      );

      assert.true(
        Date.now() - start < 30_000,
        'the pass finishes without sleeping through a re-read delay',
      );
      assert.strictEqual(
        readsOf('notes.txt'),
        2,
        'one attempt, under both URL forms',
      );
      assert.strictEqual(await fileRow('notes.txt'), undefined);
    });

    test('removes a deleted file without waiting on the re-read window', async function (assert) {
      let { reader: writing } = realmReader({ 'notes.txt': {} });
      await runIncremental(
        writing,
        [{ name: 'notes.txt', operation: 'update' }],
        [],
      );
      let indexed = await fileRow('notes.txt');
      assert.ok(indexed, 'the file is indexed before it is deleted');
      assert.false(Boolean(indexed?.is_deleted), 'and its row is live');

      let { reader: deleted, readsOf } = realmReader({});
      let start = Date.now();
      // Any re-read would hold the pass for a minute.
      await runIncremental(
        deleted,
        [{ name: 'notes.txt', operation: 'delete' }],
        [60_000],
      );

      assert.true(
        Date.now() - start < 30_000,
        'the pass finishes without sleeping through a re-read delay',
      );
      assert.strictEqual(
        readsOf('notes.txt'),
        1,
        'the removal is checked against the realm once',
      );
      let row = await fileRow('notes.txt');
      let live = Boolean(row) && !row?.is_deleted;
      assert.false(live, 'the deleted file no longer has a live index row');
    });
  });

  module('the re-read window', function () {
    // A clock that advances only when the window sleeps, so the test reads
    // how much of the window each re-read used.
    function fakeClock() {
      let now = 0;
      let slept: number[] = [];
      return {
        now: () => now,
        sleep: async (ms: number) => {
          slept.push(ms);
          now += ms;
        },
        slept,
      };
    }

    const recorded = async () => true;

    test('re-reads after each delay until the file is read', async function (assert) {
      let clock = fakeClock();
      let rereads = new WrittenFileRereads({
        delaysMs: [10, 20, 40],
        ...clock,
      });
      let reads = 0;
      let result = await rereads.reread(
        async () => (++reads === 2 ? 'file' : undefined),
        recorded,
      );
      assert.deepEqual(result, {
        value: 'file',
        rereads: 2,
        waitedMs: 30,
        removed: false,
      });
      assert.deepEqual(clock.slept, [10, 20]);
    });

    test('stops as soon as the realm no longer records the file', async function (assert) {
      let clock = fakeClock();
      let rereads = new WrittenFileRereads({
        delaysMs: [10, 20, 40],
        ...clock,
      });
      let checks = 0;
      let result = await rereads.reread(
        async () => undefined,
        async () => ++checks === 1,
      );
      assert.deepEqual(
        result,
        { value: undefined, rereads: 1, waitedMs: 10, removed: true },
        'the file is re-read once, then reported removed when the record is gone',
      );
      assert.deepEqual(clock.slept, [10]);
    });

    test('is shared by every re-read of the pass', async function (assert) {
      let clock = fakeClock();
      let rereads = new WrittenFileRereads({
        delaysMs: [10, 20, 40],
        ...clock,
      });
      let first = await rereads.reread(async () => undefined, recorded);
      assert.deepEqual(
        first,
        { value: undefined, rereads: 3, waitedMs: 70, removed: false },
        'the first missing file uses the whole window',
      );
      let second = await rereads.reread(async () => undefined, recorded);
      assert.deepEqual(
        second,
        { value: undefined, rereads: 0, waitedMs: 0, removed: false },
        'a later file in the pass is not re-read once the window has closed',
      );
      let third = await rereads.reread(
        async () => undefined,
        async () => false,
      );
      assert.true(
        third.removed,
        'a file the realm removed reads as a removal after the window has closed too',
      );
      assert.deepEqual(clock.slept, [10, 20, 40]);
    });

    test('a later file re-reads only for what is left of the window', async function (assert) {
      let clock = fakeClock();
      let rereads = new WrittenFileRereads({
        delaysMs: [10, 20, 40],
        ...clock,
      });
      await rereads.reread(async () => 'file', recorded);
      let second = await rereads.reread(async () => undefined, recorded);
      assert.deepEqual(
        clock.slept,
        [10, 10, 20, 30],
        'the second file sleeps through the rest of the window and stops at its close',
      );
      assert.deepEqual(second, {
        value: undefined,
        rereads: 3,
        waitedMs: 60,
        removed: false,
      });
    });
  });
});
