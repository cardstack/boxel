import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  GENERATED_INDEX_COLUMNS,
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

// `boxel_index` has columns Postgres generates from `search_doc`
// (`title_sort`), which no statement may write and the pending table does not
// have; `search_keys` is an ordinary column filled when a row is staged
// (search-keys-staging-test). These tests hold the writer to that on every write
// path a migrated schema sees: a card written, written again (incrementally,
// through the write buffer), turned into an error row (which carries the
// last good production row forward), and deleted; and hold the list of
// generated columns the writer leaves out to the table's own.

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
    virtualNetwork.addRealmMapping(
      '@cardstack/base/',
      'http://localhost:4201/base/',
    );
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
    searchData: {
      cardTitle: title,
      score: title.length,
      tags: ['a', 'b'],
      body: 'x'.repeat(400),
    },
    deps: new Set(),
    displayNames: ['Note'],
    types: [`${testRealm}note/Note`],
    isolatedHtml: `<div>${title}</div>`,
  });

  async function batchOf(write: (batch: any) => Promise<void>) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    await write(batch);
    await batch.done();
  }

  async function row() {
    let [found] = (await adapter.execute(
      `SELECT has_error, is_deleted, search_keys, search_keys_of(search_doc) AS expected
         FROM boxel_index WHERE url = $1 AND type = 'instance'`,
      { bind: [cardURL.href] },
    )) as {
      has_error: boolean;
      is_deleted: boolean | null;
      search_keys: unknown;
      expected: unknown;
    }[];
    return found;
  }

  test('every write path leaves the generated columns to Postgres', async function (assert) {
    await batchOf(async (batch) => {
      await batch.invalidate([cardURL]);
      await batch.updateEntry(cardURL, entry('First'));
    });
    let first = await row();
    assert.false(first.has_error, 'written');
    assert.deepEqual(
      first.search_keys,
      first.expected,
      'search_keys generated',
    );
    assert.strictEqual((first.search_keys as any).cardTitle, 'First');

    // incrementally, through the write buffer
    await batchOf(async (batch) => {
      await batch.invalidate([cardURL]);
      await batch.bufferEntry(cardURL, entry('Second'));
      await batch.flushWriteBuffer();
    });
    let second = await row();
    assert.deepEqual(second.search_keys, second.expected);
    assert.strictEqual((second.search_keys as any).cardTitle, 'Second');

    // an error row, which carries the last good production row forward
    await batchOf(async (batch) => {
      await batch.invalidate([cardURL]);
      await batch.updateEntry(cardURL, {
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
    let errored = await row();
    assert.true(errored.has_error, 'the error row is written');
    assert.deepEqual(errored.search_keys, errored.expected);

    // deleted
    await batchOf(async (batch) => {
      await batch.invalidate([cardURL]);
    });
    let deleted = await row();
    let gone = !deleted || Boolean(deleted.is_deleted);
    assert.true(gone, 'the card is gone or tombstoned');
  });

  test("the writer's generated columns are the table's", async function (assert) {
    let rows = (await adapter.execute(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_name IN ('boxel_index', 'boxel_index_pending')
          AND is_generated <> 'NEVER'
        ORDER BY column_name`,
    )) as { table_name: string; column_name: string }[];
    assert.deepEqual(
      rows
        .filter((r) => r.table_name === 'boxel_index')
        .map((r) => r.column_name),
      [...GENERATED_INDEX_COLUMNS].sort(),
      'GENERATED_INDEX_COLUMNS lists every generated column of boxel_index',
    );
    assert.deepEqual(
      rows.filter((r) => r.table_name === 'boxel_index_pending'),
      [],
      'the pending table generates none',
    );
    let pending = (await adapter.execute(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'boxel_index_pending'`,
    )) as { column_name: string }[];
    for (let column of GENERATED_INDEX_COLUMNS) {
      assert.notOk(
        pending.some((p) => p.column_name === column),
        `boxel_index_pending has no ${column}`,
      );
    }
    let written = await adapter.getColumnNames('boxel_index');
    for (let column of GENERATED_INDEX_COLUMNS) {
      assert.notOk(
        written.includes(column),
        `the promotion's column list leaves out ${column}`,
      );
    }
  });
});
