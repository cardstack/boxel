import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  INDEX_COLUMN_CLASSES,
  IndexWriter,
  VirtualNetwork,
  rri,
  type SearchIndexEntry,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// A promotion writes a row whose content is unchanged by its bookkeeping
// columns alone (the commit's generation, `indexed_at`, diagnostics), so a
// warm reindex of unchanged cards leaves their content, and every index over
// it, as it was; a changed or new row is written whole. An audit trigger on
// `UPDATE OF search_doc` tells the two apart. And every column of the table
// is classified, so a column added later fails here until someone says
// whether it is content or bookkeeping.

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
    await adapter.execute(`
      CREATE TABLE content_writes (url TEXT);
      CREATE FUNCTION record_content_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO content_writes VALUES (NEW.url); RETURN NEW; END $$;
      CREATE TRIGGER record_content_write AFTER UPDATE OF search_doc ON boxel_index
        FOR EACH ROW EXECUTE FUNCTION record_content_write();
    `);
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  let one = new URL(`${testRealm}Note/one.json`);
  let two = new URL(`${testRealm}Note/two.json`);
  let entry = (url: URL, title: string): SearchIndexEntry => ({
    type: 'instance',
    resource: {
      id: rri(url.href),
      type: 'card',
      attributes: {},
      meta: { adoptsFrom: { module: rri(`${testRealm}note`), name: 'Note' } },
    },
    lastModified: 1_000,
    resourceCreatedAt: 1_000,
    searchData: { cardTitle: title },
    deps: new Set(),
    displayNames: ['Note'],
    types: [`${testRealm}note/Note`],
    isolatedHtml: `<div>${title}</div>`,
  });

  async function pass(cards: [URL, string][]) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    await batch.invalidate(cards.map(([url]) => url));
    for (let [url, title] of cards) {
      await batch.updateEntry(url, entry(url, title));
    }
    await batch.done();
  }

  async function contentWrites() {
    let rows = (await adapter.execute(
      `SELECT url FROM content_writes ORDER BY url`,
    )) as { url: string }[];
    await adapter.execute(`DELETE FROM content_writes`);
    return rows.map((r) => r.url);
  }

  async function rowOf(url: URL) {
    let [row] = (await adapter.execute(
      `SELECT generation, indexed_at, search_doc ->> 'cardTitle' AS title FROM boxel_index WHERE url = $1 AND type = 'instance'`,
      { bind: [url.href] },
    )) as { generation: number; indexed_at: string; title: string }[];
    return row;
  }

  test('every column of boxel_index is classified', async function (assert) {
    let rows = (await adapter.execute(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'boxel_index' ORDER BY column_name`,
    )) as { column_name: string }[];
    assert.deepEqual(
      rows.map((r) => r.column_name),
      Object.keys(INDEX_COLUMN_CLASSES).sort(),
      'INDEX_COLUMN_CLASSES names exactly the columns of boxel_index: classify a new column as content or bookkeeping',
    );
  });

  test('a warm reindex of an unchanged card writes its bookkeeping alone', async function (assert) {
    await pass([[one, 'One']]);
    await contentWrites();
    let before = await rowOf(one);
    await pass([[one, 'One']]);
    let after = await rowOf(one);
    assert.deepEqual(await contentWrites(), [], 'no content was written');
    assert.true(after.generation > before.generation, 'a new generation');
    assert.strictEqual(after.title, 'One', 'the content is as it was');
  });

  test('a changed card is written whole, beside an unchanged one', async function (assert) {
    await pass([
      [one, 'One'],
      [two, 'Two'],
    ]);
    await contentWrites();
    await pass([
      [one, 'One, edited'],
      [two, 'Two'],
    ]);
    assert.deepEqual(
      await contentWrites(),
      [one.href],
      'only the changed card was written whole',
    );
    assert.strictEqual((await rowOf(one)).title, 'One, edited');
    assert.strictEqual((await rowOf(two)).title, 'Two');
    assert.strictEqual(
      (await rowOf(one)).generation,
      (await rowOf(two)).generation,
      'both carry the commit generation',
    );
  });

  test('a new card is inserted', async function (assert) {
    await pass([[one, 'One']]);
    await pass([
      [one, 'One'],
      [two, 'Two'],
    ]);
    assert.strictEqual((await rowOf(two)).title, 'Two');
  });
});
