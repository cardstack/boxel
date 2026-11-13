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

// Postgres takes at most 65,535 bind parameters in one statement; past that
// the count wraps and the driver's statement is refused outright. A pass over
// a realm with more files than that must still read every URL's rows.
const REALM_SIZED = 70_000;

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let indexWriter: IndexWriter;
  let virtualNetwork: VirtualNetwork;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    indexWriter = new IndexWriter(adapter);
    virtualNetwork = new VirtualNetwork();
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

  // Every URL a realm-sized pass names, with the one real card last so a
  // lookup that read only the first statement's worth would miss it.
  function realmSizedURLs(name: string): string[] {
    let urls = Array.from(
      { length: REALM_SIZED - 1 },
      (_, i) => `${testRealm}Filler/${i}.json`,
    );
    urls.push(url(name));
    return urls;
  }

  test('an HTML pass seeded with a realm-sized list tombstones the rows production holds', async function (assert) {
    await indexCard('kim');
    let urls = realmSizedURLs('kim');
    let batch = await indexWriter.createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { prerenderHtmlOnly: true },
    );
    await batch.adoptIndexGenerations(urls);
    await batch.seedPrerenderedHtmlInvalidations(
      urls.map((u) => ({ url: u, operation: 'update' as const })),
    );
    let rows = (await adapter.execute(
      `SELECT type, is_deleted FROM prerendered_html_pending WHERE url = $1`,
      { bind: [url('kim')] },
    )) as { type: string; is_deleted: boolean }[];
    assert.deepEqual(
      rows.map((r) => [r.type, r.is_deleted]),
      [['instance', true]],
      'the one live row, past the first statement, is staged as a tombstone',
    );
  });

  test('seeding live types from a realm-sized list reads them all', async function (assert) {
    await indexCard('kim');
    let batch = await indexWriter.createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    await batch.seedLiveTypesFromProduction(
      realmSizedURLs('kim').map((u) => new URL(u)),
    );
    assert.deepEqual(
      batch.tombstonedLiveTypes(url('kim')),
      ['instance'],
      'the live card past the first statement is seen',
    );
  });
});
