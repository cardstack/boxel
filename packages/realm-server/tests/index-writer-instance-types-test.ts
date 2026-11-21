import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  VirtualNetwork,
  internalKeyFor,
  rri,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// An instance row that is not an error row holds its types as a list. A
// counts-only search finds the rows the value store does not hold by their
// errors alone (boxel_index_non_live_rows_idx), so the index writer refuses
// an instance row whose types are not a list; an error row, which that index
// holds, may still have none.

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

  async function write(url: URL, entry: unknown) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    await batch.updateEntry(url, entry as never);
    await batch.done();
  }

  const instance = (url: URL, types: unknown) => ({
    type: 'instance',
    resource: {
      id: rri(url.href.replace(/\.json$/, '')),
      type: 'card',
      attributes: {},
      meta: {
        adoptsFrom: { module: rri(noteRef.module), name: noteRef.name },
      },
    },
    lastModified: Date.now(),
    resourceCreatedAt: Date.now(),
    searchData: { cardTitle: 'A note' },
    deps: new Set(),
    displayNames: ['Note'],
    types,
    isolatedHtml: '<div></div>',
  });

  async function instanceRows() {
    return (await adapter.execute(
      `SELECT url, has_error, jsonb_typeof(types) AS kind FROM boxel_index WHERE type = 'instance' ORDER BY url`,
    )) as { url: string; has_error: boolean | null; kind: string | null }[];
  }

  test('an instance row is written with its types as a list', async function (assert) {
    let url = new URL(`${testRealm}Note/one.json`);
    await write(
      url,
      instance(url, [internalKeyFor(noteRef, undefined, virtualNetwork)]),
    );
    let rows = await instanceRows();
    assert.deepEqual(
      rows.map((r) => [r.url, Boolean(r.has_error), r.kind]),
      [[url.href, false, 'array']],
    );
  });

  test('an instance row whose types are not a list is refused', async function (assert) {
    for (let [name, types] of [
      ['no types', undefined],
      ['null', null],
      ['a string', 'Note'],
    ] as const) {
      let url = new URL(`${testRealm}Note/${name.replace(/ /g, '-')}.json`);
      try {
        await write(url, instance(url, types));
        assert.ok(false, `${name}: written`);
      } catch (e: any) {
        assert.true(
          /an instance row's types must be a list/.test(e.message),
          `${name}: refused (${e.message})`,
        );
      }
    }
    assert.deepEqual(await instanceRows(), [], 'no such row was written');
  });

  test("a new card's error row is still written, without types", async function (assert) {
    let url = new URL(`${testRealm}Note/broken.json`);
    await write(url, {
      type: 'instance-error',
      error: {
        id: url.href,
        status: 500,
        title: 'broken',
        message: 'a render that failed',
        additionalErrors: null,
        deps: [],
      },
    });
    let rows = await instanceRows();
    assert.strictEqual(rows.length, 1);
    assert.true(Boolean(rows[0].has_error), 'an error row');
  });
});
