import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  IndexWriter,
  VirtualNetwork,
  rri,
  type Batch,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

const cardDefKey = 'https://cardstack.com/base/card-api/CardDef';
const personKey = `${testRealm}person/Person`;

// During a rolling deploy the migrations run first, so the previous revision
// keeps committing index passes against a schema whose production tables
// have columns it has never heard of, and that its pending tables do not
// stage. Its swaps must still commit.
module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let indexWriter: IndexWriter;
  let virtualNetwork: VirtualNetwork;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    indexWriter = new IndexWriter(adapter);
    virtualNetwork = new VirtualNetwork();
    // What a later release's migration adds: a production column on each
    // table that neither pending table stages.
    await adapter.execute(
      `ALTER TABLE boxel_index ADD COLUMN derived_later TEXT`,
    );
    await adapter.execute(
      `ALTER TABLE prerendered_html ADD COLUMN derived_later TEXT`,
    );
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  const url = (name: string) => `${testRealm}${name}.json`;

  async function indexCard(name: string) {
    let batch: Batch = await indexWriter.createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    let cardURL = new URL(url(name));
    await batch.updateEntry(cardURL, {
      type: 'instance',
      resource: {
        id: rri(cardURL.href),
        type: 'card',
        attributes: { name },
        meta: { adoptsFrom: { module: rri(`${testRealm}person`), name } },
      },
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: { name },
      deps: new Set(),
      displayNames: [name],
      types: [personKey, cardDefKey],
      isolatedHtml: `<div>${name}</div>`,
    });
    await batch.done();
  }

  async function derivedLater(
    table: 'boxel_index' | 'prerendered_html',
    name: string,
  ): Promise<(string | null)[]> {
    let rows = (await adapter.execute(
      `SELECT derived_later FROM ${table} WHERE url = $1`,
      { bind: [url(name)] },
    )) as { derived_later: string | null }[];
    return rows.map((row) => row.derived_later);
  }

  test('a pass commits when production has a column its pending table does not stage', async function (assert) {
    await indexCard('mango');

    let [index] = (await adapter.execute(
      `SELECT search_doc FROM boxel_index WHERE url = $1 AND type = 'instance'`,
      { bind: [url('mango')] },
    )) as { search_doc: Record<string, unknown> }[];
    assert.deepEqual(
      index?.search_doc,
      { name: 'mango' },
      'the row is published',
    );
    assert.deepEqual(
      await derivedLater('boxel_index', 'mango'),
      [null],
      'the column the writer does not know is left empty',
    );
    let html = await derivedLater('prerendered_html', 'mango');
    assert.ok(html.length > 0, 'the HTML row is published');
    assert.ok(
      html.every((value) => value === null),
      'and leaves the unknown column empty',
    );
  });

  test('re-indexing clears a value a newer writer derived for the row', async function (assert) {
    await indexCard('mango');
    // A newer revision's pass filled the column from the document it
    // published.
    await adapter.execute(
      `UPDATE boxel_index SET derived_later = 'from the old document' WHERE url = $1`,
      { bind: [url('mango')] },
    );
    await adapter.execute(
      `UPDATE prerendered_html SET derived_later = 'from the old markup' WHERE url = $1`,
      { bind: [url('mango')] },
    );

    await indexCard('mango');

    assert.deepEqual(
      await derivedLater('boxel_index', 'mango'),
      [null],
      'the index row does not keep a value derived from the document it replaced',
    );
    assert.ok(
      (await derivedLater('prerendered_html', 'mango')).every(
        (value) => value === null,
      ),
      'nor does the HTML row',
    );
  });
});
