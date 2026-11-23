import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import pg from 'pg';

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

// A staged row reuses its live row's search keys when the doc they were
// projected from is the doc being staged (add-search-keys-reuse), and
// projects the doc otherwise. The reuse must never answer differently from a
// projection, so it is keyed by a fingerprint of the projection's version and
// the exact staged doc: these tests hold that, and the shared read of staged
// docs the vector and passage syncs make in a commit.

const SENTINEL = '{"sentinel": true}';

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

  let urlOf = (name: string) => new URL(`${testRealm}Note/${name}.json`);
  let entry = (
    name: string,
    searchData: Record<string, unknown>,
  ): SearchIndexEntry => ({
    type: 'instance',
    resource: {
      id: rri(urlOf(name).href),
      type: 'card',
      attributes: {},
      meta: { adoptsFrom: { module: rri(`${testRealm}note`), name: 'Note' } },
    },
    lastModified: Date.now(),
    resourceCreatedAt: Date.now(),
    searchData,
    deps: new Set(),
    displayNames: ['Note'],
    types: [`${testRealm}note/Note`],
    isolatedHtml: `<div>${name}</div>`,
  });

  // Docs of the shapes the projection treats differently: short and long
  // strings, short and long lists, nested objects, numbers and booleans, a
  // doc over the projection's byte budget, and the render's search text.
  let fixtures: Record<string, Record<string, unknown>> = {
    plain: { cardTitle: 'Plain', count: 3, done: false },
    long: { cardTitle: 'Long', body: 'x'.repeat(400) },
    lists: {
      tags: ['a', 'b'],
      many: Array.from({ length: 200 }, (_, i) => `t${i}`),
    },
    nested: { address: { city: 'Lisbon', lines: ['1 Rua', '2 Rua'] }, n: null },
    budget: Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`f${i}`, 'y'.repeat(200)]),
    ),
    searchText: {
      cardTitle: 'Searched',
      _searchText: { A: 'Searched', B: 'short' },
    },
  };

  async function pass(
    entries: [string, Record<string, unknown>][],
    beforeDone?: () => Promise<void>,
  ) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    await batch.invalidate(entries.map(([name]) => urlOf(name)));
    for (let [name, doc] of entries) {
      await batch.updateEntry(urlOf(name), entry(name, doc));
    }
    await beforeDone?.();
    await batch.done();
  }

  // The staged rows' keys, and whether each equals a fresh projection of the
  // staged doc.
  async function staged() {
    return (await adapter.execute(
      `SELECT url, search_keys::text AS keys,
              search_keys IS NOT DISTINCT FROM search_keys_of(search_doc) AS fresh
         FROM boxel_index_pending WHERE type = 'instance' ORDER BY url`,
    )) as { url: string; keys: string; fresh: boolean }[];
  }

  async function markLiveKeys(name: string) {
    // Not an update of search_doc, so no trigger recomputes it.
    await adapter.execute(
      `UPDATE boxel_index SET search_keys = '${SENTINEL}'::jsonb WHERE url = $1 AND type = 'instance'`,
      { bind: [urlOf(name).href] },
    );
  }

  test('the version names the projection', async function (assert) {
    let [row] = (await adapter.execute(
      `SELECT search_keys_version() AS version,
              md5((SELECT prosrc FROM pg_proc WHERE proname = 'search_keys_of')
                  || (SELECT prosrc FROM pg_proc WHERE proname = 'search_keys_project')) AS sources`,
    )) as { version: string; sources: string }[];
    assert.strictEqual(
      row.version,
      row.sources,
      'search_keys_version() is the md5 of the projection functions: a migration that changes them must change it',
    );
  });

  test('an unchanged doc reuses its live keys, and they equal a fresh projection', async function (assert) {
    await pass([['plain', fixtures.plain]]);
    let [live] = (await adapter.execute(
      `SELECT search_keys_fp FROM boxel_index WHERE url = $1 AND type = 'instance'`,
      { bind: [urlOf('plain').href] },
    )) as { search_keys_fp: string | null }[];
    assert.ok(live.search_keys_fp, 'promotion writes the fingerprint');

    await pass([['plain', fixtures.plain]], async () => {
      let [row] = await staged();
      assert.true(
        row.fresh,
        'the staged keys equal a projection of the staged doc',
      );
    });

    await markLiveKeys('plain');
    await pass([['plain', fixtures.plain]], async () => {
      let [row] = await staged();
      assert.true(
        JSON.parse(row.keys).sentinel,
        'the live keys were reused, not projected again',
      );
    });
  });

  test('a changed doc projects again', async function (assert) {
    await pass([['plain', fixtures.plain]]);
    await markLiveKeys('plain');
    await pass([['plain', { ...fixtures.plain, count: 4 }]], async () => {
      let [row] = await staged();
      assert.notOk(JSON.parse(row.keys).sentinel, 'not the live keys');
      assert.true(row.fresh, 'a projection of the staged doc');
    });
  });

  test('a fingerprint from another projection version projects again', async function (assert) {
    await pass([['plain', fixtures.plain]]);
    await markLiveKeys('plain');
    let [{ version }] = (await adapter.execute(
      `SELECT search_keys_version() AS version`,
    )) as { version: string }[];
    // What a migration that changes the projection does: a new version.
    await adapter.execute(
      `CREATE OR REPLACE FUNCTION search_keys_version() RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 'bumped'::text $$`,
    );
    try {
      await pass([['plain', fixtures.plain]], async () => {
        let [row] = await staged();
        assert.notOk(JSON.parse(row.keys).sentinel, 'not the live keys');
        assert.true(row.fresh, 'a projection of the staged doc');
      });
    } finally {
      await adapter.execute(
        `CREATE OR REPLACE FUNCTION search_keys_version() RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT '${version}'::text $$`,
      );
    }
  });

  test('reused keys equal projected keys for every fixture', async function (assert) {
    let all = Object.entries(fixtures);
    await pass(all);
    let [{ n: fingerprinted }] = (await adapter.execute(
      `SELECT count(*)::int AS n FROM boxel_index WHERE type = 'instance' AND search_keys_fp IS NOT NULL`,
    )) as { n: number }[];
    assert.strictEqual(
      fingerprinted,
      all.length,
      'every row has a fingerprint',
    );
    await pass(all, async () => {
      let rows = await staged();
      assert.strictEqual(rows.length, all.length);
      for (let row of rows) {
        assert.true(
          row.fresh,
          `${row.url}: the reused keys equal a projection`,
        );
      }
      let [{ n: reusable }] = (await adapter.execute(
        `SELECT count(*)::int AS n FROM boxel_index_pending AS p JOIN boxel_index AS i
           ON i.url = p.url AND i.realm_url = p.realm_url AND i.type = p.type
          WHERE p.type = 'instance' AND i.search_keys_fp = search_keys_fp_of(p.search_doc)`,
      )) as { n: number }[];
      assert.strictEqual(reusable, all.length, 'and every one was reusable');
    });
  });

  test('the vector and passage syncs read each chunk of staged docs once', async function (assert) {
    let reads: string[] = [];
    let query = pg.Client.prototype.query;
    pg.Client.prototype.query = function (this: pg.Client, ...args: any[]) {
      let sql = typeof args[0] === 'string' ? args[0] : args[0]?.text;
      if (
        typeof sql === 'string' &&
        /^SELECT url, type, search_doc\b.*FROM boxel_index_pending/s.test(sql)
      ) {
        reads.push(sql);
      }
      return (query as any).apply(this, args);
    } as typeof query;
    try {
      await pass([
        [
          'withPassages',
          { reviews: [{ text: 'a fine pen' }], _passages: ['reviews'] },
        ],
        ['plain', fixtures.plain],
      ]);
    } finally {
      pg.Client.prototype.query = query;
    }
    let [{ vectorStore }] = (await adapter.execute(
      `SELECT to_regclass('boxel_index_vectors') IS NOT NULL AS "vectorStore"`,
    )) as { vectorStore: boolean }[];
    assert.strictEqual(
      reads.length,
      1,
      `one read for the one chunk (vector store ${vectorStore ? 'present' : 'absent'})`,
    );
    let passages = (await adapter.execute(
      `SELECT url, body FROM boxel_index_passages WHERE realm_url = $1 ORDER BY url`,
      { bind: [testRealm] },
    )) as { url: string; body: string }[];
    assert.deepEqual(
      passages.map((p) => [p.url, p.body]),
      [[urlOf('withPassages').href, 'a fine pen']],
      'the passage sync still writes the passages',
    );
  });
});
