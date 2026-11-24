import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { createRequire } from 'module';

import {
  IndexWriter,
  VirtualNetwork,
  rri,
  type ResolvedCodeRef,
  type SearchIndexEntry,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';
import { seedIndexRows } from './helpers/seed-index-rows.ts';

// `search_keys` is an ordinary column on `boxel_index` and on
// `boxel_index_pending`, filled from `search_keys_of(search_doc)` when a row
// is staged (by a trigger on each table) and copied by promotion, so the
// realm's commit lock no longer computes it. A wrong one makes searches
// silently wrong, so every writer of `boxel_index.search_doc` in the repo is
// held to `search_keys = search_keys_of(search_doc)` here:
// - the index writer: its staging insert into `boxel_index_pending`, its
//   promotion (`INSERT INTO boxel_index … ON CONFLICT … DO UPDATE`), the
//   write buffer, error rows and tombstones (runtime-common/index-writer.ts);
// - a direct INSERT that names no `search_keys`, as the realm-server test
//   helper `seedIndexRows` and query-verification's `engine-fixture.ts` write;
// - a direct UPDATE of `search_doc` that leaves `search_keys` out, which
//   would otherwise carry the old value over.
// (`jobs/reindex-realm.ts` updates only `last_modified`.)
// And the migration turns a generated column into an ordinary one without
// changing its values or rewriting the table.

const require = createRequire(import.meta.url);
const SEARCH_KEYS_MIGRATION = join(
  dirname(require.resolve('@cardstack/postgres/package.json')),
  'migrations',
  '1795300001005_search-keys.js',
);

const noteRef: ResolvedCodeRef = {
  module: `${testRealm}note` as ResolvedCodeRef['module'],
  name: 'Note',
};

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  let cardURL = new URL(`${testRealm}Note/one.json`);
  let entry = (title: string): SearchIndexEntry => ({
    type: 'instance',
    resource: {
      id: rri(cardURL.href),
      type: 'card',
      attributes: {},
      meta: { adoptsFrom: { module: rri(`${testRealm}note`), name: 'Note' } },
    },
    lastModified: Date.now(),
    resourceCreatedAt: Date.now(),
    searchData: { cardTitle: title, body: 'x'.repeat(400) },
    deps: new Set(),
    displayNames: ['Note'],
    types: [`${testRealm}note/Note`],
    isolatedHtml: `<div>${title}</div>`,
  });

  // Rows of `table` whose search_keys is not their search doc's.
  async function drifted(table: 'boxel_index' | 'boxel_index_pending') {
    let [row] = (await adapter.execute(
      `SELECT count(*)::int AS n FROM ${table} WHERE search_doc IS NOT NULL AND search_keys IS DISTINCT FROM search_keys_of(search_doc)`,
    )) as { n: number }[];
    return row.n;
  }

  test('a staged row carries its search keys, and promotion copies them', async function (assert) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    await batch.invalidate([cardURL]);
    await batch.updateEntry(cardURL, entry('Staged'));
    let [staged] = (await adapter.execute(
      `SELECT search_keys ->> 'cardTitle' AS title FROM boxel_index_pending WHERE url = $1 AND type = 'instance'`,
      { bind: [cardURL.href] },
    )) as { title: string | null }[];
    assert.strictEqual(staged?.title, 'Staged', 'filled when it was staged');
    assert.strictEqual(await drifted('boxel_index_pending'), 0);
    await batch.done();
    let [promoted] = (await adapter.execute(
      `SELECT search_keys ->> 'cardTitle' AS title FROM boxel_index WHERE url = $1 AND type = 'instance'`,
      { bind: [cardURL.href] },
    )) as { title: string | null }[];
    assert.strictEqual(promoted?.title, 'Staged', 'and promoted');
    assert.strictEqual(await drifted('boxel_index'), 0);
  });

  test('a direct INSERT that names no search keys gets them', async function (assert) {
    await seedIndexRows(adapter, virtualNetwork, testRealm, [
      {
        url: `${testRealm}Note/seeded.json`,
        searchDoc: { cardTitle: 'Seeded' },
        types: [noteRef],
      },
    ]);
    let [row] = (await adapter.execute(
      `SELECT search_keys ->> 'cardTitle' AS title FROM boxel_index WHERE url = $1`,
      { bind: [`${testRealm}Note/seeded.json`] },
    )) as { title: string | null }[];
    assert.strictEqual(row?.title, 'Seeded');
    assert.strictEqual(await drifted('boxel_index'), 0);
  });

  test('a direct UPDATE of the search doc that leaves search keys out gets them again', async function (assert) {
    await seedIndexRows(adapter, virtualNetwork, testRealm, [
      {
        url: `${testRealm}Note/seeded.json`,
        searchDoc: { cardTitle: 'Before' },
        types: [noteRef],
      },
    ]);
    await adapter.execute(
      `UPDATE boxel_index SET search_doc = '{"cardTitle": "After"}'::jsonb WHERE url = $1`,
      { bind: [`${testRealm}Note/seeded.json`] },
    );
    let [row] = (await adapter.execute(
      `SELECT search_keys ->> 'cardTitle' AS title FROM boxel_index WHERE url = $1`,
      { bind: [`${testRealm}Note/seeded.json`] },
    )) as { title: string | null }[];
    assert.strictEqual(row?.title, 'After', 'the old value is not kept');
    assert.strictEqual(await drifted('boxel_index'), 0);
  });

  test('every write path of the index writer leaves search keys equal to their search doc', async function (assert) {
    let pass = async (write: (batch: any) => Promise<void>) => {
      let batch = await new IndexWriter(adapter).createBatch(
        new URL(testRealm),
        virtualNetwork,
        undefined,
        { splitPrerenderHtml: false },
      );
      await write(batch);
      await batch.done();
    };
    await pass(async (b) => {
      await b.invalidate([cardURL]);
      await b.updateEntry(cardURL, entry('First'));
    });
    assert.strictEqual(await drifted('boxel_index'), 0, 'written');
    await pass(async (b) => {
      await b.invalidate([cardURL]);
      await b.bufferEntry(cardURL, entry('Second'));
      await b.flushWriteBuffer();
    });
    assert.strictEqual(
      await drifted('boxel_index'),
      0,
      'written again, buffered',
    );
    await pass(async (b) => {
      await b.invalidate([cardURL]);
      await b.updateEntry(cardURL, {
        type: 'instance-error',
        error: {
          id: cardURL.href,
          status: 500,
          title: 'broken',
          message: 'a render that failed',
          additionalErrors: null,
          deps: [],
        },
      });
    });
    assert.strictEqual(await drifted('boxel_index'), 0, 'an error row');
    await pass(async (b) => {
      await b.invalidate([cardURL]);
    });
    assert.strictEqual(await drifted('boxel_index'), 0, 'a tombstone');
  });

  test('the migration turns a generated search_keys into an ordinary one, keeping its values and its table', async function (assert) {
    let { SEARCH_KEYS_TO_ORDINARY_COLUMN } = require(SEARCH_KEYS_MIGRATION);
    await seedIndexRows(adapter, virtualNetwork, testRealm, [
      {
        url: `${testRealm}Note/a.json`,
        searchDoc: { cardTitle: 'A', body: 'y'.repeat(4000) },
        types: [noteRef],
      },
      {
        url: `${testRealm}Note/b.json`,
        searchDoc: { cardTitle: 'B' },
        types: [noteRef],
      },
    ]);
    await adapter.withTransaction(async (q) => {
      // What a database that ran the earlier version of this migration holds.
      await q([
        'DROP TRIGGER IF EXISTS boxel_index_fill_search_keys ON boxel_index',
      ]);
      await q(['ALTER TABLE boxel_index DROP COLUMN search_keys CASCADE']);
      await q([
        'ALTER TABLE boxel_index ADD COLUMN search_keys JSONB STORAGE PLAIN GENERATED ALWAYS AS (search_keys_of(search_doc)) STORED',
      ]);
      let [before] = (await q([
        "SELECT pg_relation_filenode('boxel_index') AS node, (SELECT attgenerated FROM pg_attribute WHERE attrelid = 'boxel_index'::regclass AND attname = 'search_keys') AS generated, (SELECT jsonb_agg(search_keys ORDER BY url) FROM boxel_index) AS keys",
      ])) as { node: string; generated: string; keys: unknown }[];
      assert.strictEqual(before.generated, 's', 'the column starts generated');
      await q([SEARCH_KEYS_TO_ORDINARY_COLUMN]);
      let [after] = (await q([
        "SELECT pg_relation_filenode('boxel_index') AS node, (SELECT attgenerated FROM pg_attribute WHERE attrelid = 'boxel_index'::regclass AND attname = 'search_keys') AS generated, (SELECT jsonb_agg(search_keys ORDER BY url) FROM boxel_index) AS keys",
      ])) as { node: string; generated: string; keys: unknown }[];
      assert.strictEqual(after.generated, '', 'an ordinary column');
      assert.strictEqual(
        after.node,
        before.node,
        'the table was not rewritten',
      );
      assert.deepEqual(after.keys, before.keys, 'its values are unchanged');
    });
  });
});
