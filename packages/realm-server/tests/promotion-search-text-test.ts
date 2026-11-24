import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
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

// The render stamps a card's search text into its staged search doc
// (`_searchText`), and promotion drops it from the live doc: it lives on as
// the row's vectors and its fingerprint, `search_text_fp`. So a promotion
// telling an unchanged row from a changed one compares the staged doc without
// its search text, and the search text by its fingerprint: an unchanged card
// gets its bookkeeping alone, and a card whose search text moved, and nothing
// else, is written whole with a new vector. An audit trigger on
// `UPDATE OF search_doc` tells the two apart.

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
  let entry = (url: URL, words: string): SearchIndexEntry => ({
    type: 'instance',
    resource: {
      id: rri(url.href),
      type: 'card',
      attributes: {},
      meta: { adoptsFrom: { module: rri(`${testRealm}note`), name: 'Note' } },
    },
    lastModified: 1_000,
    resourceCreatedAt: 1_000,
    searchData: { cardTitle: 'One', _searchText: { A: 'One', C: words } },
    deps: new Set(),
    displayNames: ['Note'],
    types: [`${testRealm}note/Note`],
    isolatedHtml: `<div>One</div>`,
  });

  async function pass(words: string) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    await batch.invalidate([one]);
    await batch.updateEntry(one, entry(one, words));
    await batch.done();
  }

  async function contentWrites() {
    let rows = (await adapter.execute(
      `SELECT url FROM content_writes ORDER BY url`,
    )) as { url: string }[];
    await adapter.execute(`DELETE FROM content_writes`);
    return rows.map((r) => r.url);
  }

  async function row() {
    let [r] = (await adapter.execute(
      `SELECT generation, search_doc ? '_searchText' AS kept, search_text_fp,
         search_tsv @@ to_tsquery('boxel_english', 'pelican') AS pelican,
         search_tsv @@ to_tsquery('boxel_english', 'walrus') AS walrus
       FROM boxel_index WHERE url = $1 AND type = 'instance'`,
      { bind: [one.href] },
    )) as {
      generation: number;
      kept: boolean;
      search_text_fp: string | null;
      pelican: boolean;
      walrus: boolean;
    }[];
    return r;
  }

  test('a warm reindex of an unchanged card with search text writes its bookkeeping alone', async function (assert) {
    await pass('a pelican');
    await contentWrites();
    let before = await row();
    assert.false(before.kept, 'the live doc drops the search text');
    assert.ok(before.search_text_fp, 'the fingerprint is written');
    await pass('a pelican');
    let after = await row();
    assert.deepEqual(await contentWrites(), [], 'no content was written');
    assert.true(after.generation > before.generation, 'a new generation');
    assert.true(after.pelican, 'the vector is as it was');
    assert.strictEqual(after.search_text_fp, before.search_text_fp);
  });

  test('a card whose search text alone moved is written whole', async function (assert) {
    await pass('a pelican');
    await contentWrites();
    let before = await row();
    await pass('a walrus');
    let after = await row();
    assert.deepEqual(await contentWrites(), [one.href], 'written whole');
    assert.false(after.pelican, 'the old word is gone from the vector');
    assert.true(after.walrus, 'the new word is in it');
    assert.notStrictEqual(after.search_text_fp, before.search_text_fp);
  });

  test('a row with no fingerprint yet counts as changed', async function (assert) {
    await pass('a pelican');
    await adapter.execute(`UPDATE boxel_index SET search_text_fp = NULL`);
    await contentWrites();
    await pass('a pelican');
    assert.deepEqual(await contentWrites(), [one.href], 'written whole');
    assert.ok((await row()).search_text_fp, 'and gains its fingerprint');
  });
});
