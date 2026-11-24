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

// A pass rewrites a card's value rows only when what they derive from
// changed: its promoted `search_keys` and its type chain, fingerprinted on
// `boxel_index_value_cards.keys_fp`. A warm reindex of unchanged cards writes
// no value row, and a changed card's rows are exactly the ones a rebuild
// writes.

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
  let entry = (
    url: URL,
    title: string,
    types: string[] = [`${testRealm}note/Note`],
  ): SearchIndexEntry => ({
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
    types,
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

  // Each value row's physical place: unchanged while no pass rewrote it.
  async function placesOf(url: URL) {
    let found = (await adapter.execute(
      `SELECT v.ctid::text AS place FROM boxel_index_values v JOIN boxel_index_value_cards c ON c.id = v.card_id WHERE c.url = $1 AND c.realm_url = $2 ORDER BY 1`,
      { bind: [url.href, testRealm] },
    )) as { place: string }[];
    return found.map((r) => r.place);
  }

  async function fingerprintOf(url: URL) {
    let [row] = (await adapter.execute(
      `SELECT keys_fp FROM boxel_index_value_cards WHERE url = $1 AND realm_url = $2`,
      { bind: [url.href, testRealm] },
    )) as { keys_fp: string | null }[];
    return row?.keys_fp ?? null;
  }

  async function indexBoth(titleOne = 'One', titleTwo = 'Two') {
    await batchOf(async (batch) => {
      await batch.invalidate([one, two]);
      await batch.updateEntry(one, entry(one, titleOne));
      await batch.updateEntry(two, entry(two, titleTwo));
    });
  }

  test('a warm reindex of unchanged cards writes no value row', async function (assert) {
    await indexBoth();
    let before = [await placesOf(one), await placesOf(two)];
    assert.ok(before[0].length > 0, 'the first card has rows');
    assert.ok(before[1].length > 0, 'the second card has rows');
    assert.ok(await fingerprintOf(one), 'a card with rows has a fingerprint');
    await indexBoth();
    assert.deepEqual(
      [await placesOf(one), await placesOf(two)],
      before,
      'every value row is where it was: none was rewritten',
    );
    let found = await rows(one);
    assert.deepEqual(found.stored, found.expected, 'and they are still right');
  });

  test("a changed card's rows are a rebuild's, and its unchanged neighbor's are untouched", async function (assert) {
    await indexBoth();
    let twoBefore = await placesOf(two);
    await indexBoth('One, edited');
    let found = await rows(one);
    assert.deepEqual(
      found.stored,
      found.expected,
      'the edited card holds the rows its search keys extract to',
    );
    assert.ok(found.stored!.includes('cardTitle|s|One, edited|~|~'));
    assert.deepEqual(
      await placesOf(two),
      twoBefore,
      'the unchanged card was not rewritten',
    );
  });

  test('a card that stops being live loses its rows and its fingerprint, and gets both back', async function (assert) {
    await indexBoth();
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
    assert.strictEqual((await rows(one)).stored, null, 'no rows');
    assert.strictEqual(await fingerprintOf(one), null, 'no fingerprint');
    await indexBoth();
    let found = await rows(one);
    assert.deepEqual(found.stored, found.expected, 'live again, with its rows');
    assert.ok(await fingerprintOf(one), 'and its fingerprint');
  });

  test('a card whose type chain changed is written again', async function (assert) {
    await indexBoth();
    let before = await placesOf(one);
    await batchOf(async (batch) => {
      await batch.invalidate([one]);
      await batch.updateEntry(
        one,
        entry(one, 'One', [`${testRealm}note/Note`, `${testRealm}base/Base`]),
      );
    });
    assert.notDeepEqual(await placesOf(one), before, 'its rows were rewritten');
    let [type] = (await adapter.execute(
      `SELECT types FROM boxel_index_value_types WHERE realm_url = $1 AND type = $2`,
      { bind: [testRealm, `${testRealm}note/Note`] },
    )) as { types: string[] }[];
    assert.deepEqual(
      type.types,
      [`${testRealm}note/Note`, `${testRealm}base/Base`],
      'and its type carries the new chain',
    );
  });

  test('a card with no fingerprint is always written again', async function (assert) {
    await indexBoth();
    let before = await placesOf(one);
    await adapter.execute(
      `UPDATE boxel_index_value_cards SET keys_fp = NULL WHERE url = $1 AND realm_url = $2`,
      { bind: [one.href, testRealm] },
    );
    let twoBefore = await placesOf(two);
    await indexBoth();
    assert.notDeepEqual(await placesOf(one), before, 'its rows were rewritten');
    let found = await rows(one);
    assert.deepEqual(found.stored, found.expected, 'as a rebuild writes them');
    assert.ok(await fingerprintOf(one), 'and it has a fingerprint again');
    assert.deepEqual(
      await placesOf(two),
      twoBefore,
      'its neighbor, unchanged, was not',
    );
  });
});
