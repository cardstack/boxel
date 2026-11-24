import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  VirtualNetwork,
  rri,
  type SearchIndexEntry,
} from '@cardstack/runtime-common';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// A rebuild of the whole realm takes out the vectors, vector sidecars and
// passages of a card the index no longer has, which no tombstone reaches when
// the card vanished while the index held nothing for it (an index emptied by
// a crash). A card the index still has keeps them.

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

  let one = new URL(`${testRealm}Note/one.json`);
  // In the index, but not promoted again by the rebuild below.
  let two = new URL(`${testRealm}Note/two.json`);
  let gone = `${testRealm}Note/gone.json`;
  let entry = (url: URL): SearchIndexEntry => ({
    type: 'instance',
    resource: {
      id: rri(url.href),
      type: 'card',
      attributes: {},
      meta: { adoptsFrom: { module: rri(`${testRealm}note`), name: 'Note' } },
    },
    lastModified: Date.now(),
    resourceCreatedAt: Date.now(),
    searchData: { cardTitle: 'One' },
    deps: new Set(),
    displayNames: ['Note'],
    types: [`${testRealm}note/Note`],
    isolatedHtml: '<div>One</div>',
  });

  async function pass(fullRealm: boolean, urls: URL[] = [one]) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    for (let url of urls) {
      await batch.updateEntry(url, entry(url));
    }
    await batch.done(fullRealm ? { fullRealm: true } : undefined);
  }

  async function vectorsPresent() {
    let [row] = (await adapter.execute(
      `SELECT to_regclass('boxel_index_vectors') IS NOT NULL AS present`,
    )) as { present: boolean }[];
    return row.present;
  }

  // Side rows for a URL, as the vector and passage writers leave them.
  async function sideRows(url: string, vectors: boolean) {
    if (vectors) {
      await adapter.execute(
        `INSERT INTO boxel_index_vectors (realm_url, url, type, field_path, dims, embedding) VALUES ($1, $2, 'instance', 'body', 2, '[0.1,0.2]')`,
        { bind: [testRealm, url] },
      );
      await adapter.execute(
        `INSERT INTO boxel_index_vector_sidecars (realm_url, url, type, sidecar_hash) VALUES ($1, $2, 'instance', 'h')`,
        { bind: [testRealm, url] },
      );
    }
    await adapter.execute(
      `INSERT INTO boxel_index_passages (realm_url, url, type, field_path, ordinal, body, tsv) VALUES ($1, $2, 'instance', 'body', 0, 'a passage', to_tsvector('a passage'))`,
      { bind: [testRealm, url] },
    );
  }

  async function counts(url: string, vectors: boolean) {
    let tables = [
      ...(vectors
        ? ['boxel_index_vectors', 'boxel_index_vector_sidecars']
        : []),
      'boxel_index_passages',
    ];
    let out: Record<string, number> = {};
    for (let table of tables) {
      let [row] = (await adapter.execute(
        `SELECT count(*)::int AS n FROM ${table} WHERE realm_url = $1 AND url = $2`,
        { bind: [testRealm, url] },
      )) as { n: number }[];
      out[table] = row.n;
    }
    return out;
  }

  test("a rebuild of the whole realm takes out the side rows of a card the index doesn't have, and keeps a live card's", async function (assert) {
    await pass(false, [one, two]);
    let vectors = await vectorsPresent();
    await sideRows(two.href, vectors);
    await sideRows(gone, vectors);
    assert.true(
      Object.values(await counts(gone, vectors)).every((n) => n === 1),
      'the vanished card has side rows before the rebuild',
    );

    await pass(true);

    assert.true(
      Object.values(await counts(gone, vectors)).every((n) => n === 0),
      'they are gone after it',
    );
    assert.true(
      Object.values(await counts(two.href, vectors)).every((n) => n === 1),
      'a card the index still has keeps its own',
    );
  });

  test('an incremental pass leaves side rows alone', async function (assert) {
    await pass(false);
    let vectors = await vectorsPresent();
    await sideRows(gone, vectors);
    await pass(false);
    assert.true(
      Object.values(await counts(gone, vectors)).every((n) => n === 1),
      'only a rebuild of the whole realm takes them out',
    );
  });
});
