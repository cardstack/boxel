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

// The value store (`boxel_index_values`) holds, for every live card, exactly
// the rows the one extraction (`boxel_value_rows`) reads out of its promoted
// `search_keys`: these tests hold the writer to that after a card is
// created, written again (incrementally, through the write buffer), turned
// into an error row, and deleted, and across a pass that touches one card of
// two, which leaves the other's rows and card id as they were.

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
    lastModified: Date.now(),
    resourceCreatedAt: Date.now(),
    searchData: {
      cardTitle: title,
      score: title.length,
      tags: ['a', 'b', 'a'],
      publishedOn: '2026-11-01',
      author: { id: `${testRealm}Person/p`, name: 'P' },
      body: 'x'.repeat(400),
      empty: null,
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

  // The card's stored rows, and the rows its promoted search_keys extract
  // to (none when the card is not live), in one order.
  async function rows(url: URL) {
    let line = `path || '|' || kind::text || '|' || coalesce(txt, '~') || '|' || coalesce(num::text, '~') || '|' || coalesce((ts AT TIME ZONE 'UTC')::text, '~')`;
    let [found] = (await adapter.execute(
      `SELECT
         (SELECT array_agg(${line}) FROM (
            SELECT p.path, v.kind, v.txt, v.num, v.ts FROM boxel_index_values v
              JOIN boxel_index_value_cards c ON c.id = v.card_id
              JOIN boxel_index_value_paths p ON p.id = v.path_id
              JOIN boxel_index_value_types t ON t.id = v.type_id
              JOIN boxel_index_value_realms r ON r.id = v.realm_id
             WHERE c.url = $1 AND c.realm_url = $2
               AND t.realm_url = $2 AND t.type = $3 AND r.realm_url = $2) s) AS stored,
         (SELECT array_agg(${line}) FROM (
            SELECT e.* FROM boxel_index i CROSS JOIN LATERAL boxel_value_rows(i.search_keys) e
             WHERE i.url = $1 AND i.type = 'instance'
               AND NOT i.has_error AND (i.is_deleted IS NULL OR NOT i.is_deleted)) s) AS expected,
         (SELECT id FROM boxel_index_value_cards WHERE url = $1 AND realm_url = $2) AS card_id`,
      { bind: [url.href, testRealm, `${testRealm}note/Note`] },
    )) as {
      stored: string[] | null;
      expected: string[] | null;
      card_id: number | null;
    }[];
    found.stored = found.stored ? [...found.stored].sort() : null;
    found.expected = found.expected ? [...found.expected].sort() : null;
    return found;
  }

  test('the store follows every write path', async function (assert) {
    await batchOf(async (batch) => {
      await batch.invalidate([one]);
      await batch.updateEntry(one, entry(one, 'First'));
    });
    let first = await rows(one);
    assert.ok(first.expected?.length, 'the card extracts to rows');
    assert.deepEqual(first.stored, first.expected, 'created');
    assert.ok(first.stored!.includes('|c||~|~'), 'one card row');
    assert.ok(
      first.stored!.includes('body|m|~|~|~'),
      'a long string is a marker',
    );
    assert.ok(
      first.stored!.includes('author.id|s|' + `${testRealm}Person/p` + '|~|~'),
      'a link holds its id',
    );
    assert.strictEqual(
      first.stored!.filter((r) => r.startsWith('tags|')).length,
      2,
      'a list element once per value',
    );
    assert.notOk(
      first.stored!.some((r) => r.startsWith('empty|')),
      'a null is no row',
    );
    assert.ok(
      first.stored!.some((r) =>
        r.startsWith('publishedOn|s|2026-11-01|~|2026-11-01 00:00:00'),
      ),
      'a date is an instant',
    );

    await batchOf(async (batch) => {
      await batch.invalidate([one]);
      await batch.bufferEntry(one, entry(one, 'Second'));
      await batch.flushWriteBuffer();
    });
    let second = await rows(one);
    assert.deepEqual(
      second.stored,
      second.expected,
      'written again, incrementally',
    );
    assert.ok(second.stored!.includes('cardTitle|s|Second|~|~'));
    assert.strictEqual(second.card_id, first.card_id, 'the card keeps its id');

    await batchOf(async (batch) => {
      await batch.invalidate([one]);
      await batch.updateEntry(one, {
        type: 'instance-error',
        error: {
          id: one.href,
          status: 500,
          title: 'broken',
          message: 'a render that failed',
          additionalErrors: null,
          deps: [],
        },
      });
    });
    let errored = await rows(one);
    assert.strictEqual(errored.expected, null, 'an error row is not live');
    assert.strictEqual(errored.stored, null, 'an error row has no value rows');

    await batchOf(async (batch) => {
      await batch.invalidate([one]);
      await batch.updateEntry(one, entry(one, 'Third'));
    });
    let recovered = await rows(one);
    assert.deepEqual(recovered.stored, recovered.expected, 'live again');

    await batchOf(async (batch) => {
      await batch.invalidate([one]);
    });
    let deleted = await rows(one);
    assert.strictEqual(
      deleted.stored,
      null,
      'a deleted card has no value rows',
    );
  });

  test('a pass replaces only the cards it promoted', async function (assert) {
    await batchOf(async (batch) => {
      await batch.invalidate([one, two]);
      await batch.updateEntry(one, entry(one, 'One'));
      await batch.updateEntry(two, entry(two, 'Two'));
    });
    let before = await rows(two);
    assert.deepEqual(before.stored, before.expected);
    await batchOf(async (batch) => {
      await batch.invalidate([one]);
      await batch.updateEntry(one, entry(one, 'One again'));
    });
    let after = await rows(two);
    assert.deepEqual(
      after.stored,
      before.stored,
      'the other card is untouched',
    );
    assert.strictEqual(after.card_id, before.card_id);
    let changed = await rows(one);
    assert.deepEqual(changed.stored, changed.expected);
    let [{ n }] = (await adapter.execute(
      `SELECT count(*)::int AS n FROM boxel_index_values v JOIN boxel_index_value_paths p ON p.id = v.path_id
        WHERE p.path = '' AND v.kind = 'c'`,
    )) as { n: number }[];
    assert.strictEqual(n, 2, 'one card row per live card');
  });
});
