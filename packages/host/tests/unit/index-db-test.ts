import { module, test, skip } from 'qunit';

import {
  IndexerDBClient,
  asExpressions,
  addExplicitParens,
  separatedByCommas,
  type IndexedCardsTable,
  type RealmVersionsTable,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import SQLiteAdapter from '@cardstack/host/lib/SQLiteAdapter';

import { testRealmURL } from '../helpers';
const testRealmURL2 = `http://test-realm/test2/`;

let { sqlSchema } = ENV;

async function setupIndex(
  client: IndexerDBClient,
  versionRows: RealmVersionsTable[],
  // only assert that the non-null columns need to be present in rows objects
  indexRows: (Pick<
    IndexedCardsTable,
    'card_url' | 'realm_version' | 'realm_url'
  > &
    Partial<
      Omit<IndexedCardsTable, 'card_url' | 'realm_version' | 'realm_url'>
    >)[],
) {
  let indexedCardsExpressions = indexRows.map((r) =>
    asExpressions(r, {
      jsonFields: ['deps', 'pristine_doc', 'error_doc', 'search_doc'],
    }),
  );
  let versionExpressions = versionRows.map((r) => asExpressions(r));

  if (indexedCardsExpressions.length > 0) {
    await client.query([
      `INSERT INTO indexed_cards`,
      ...addExplicitParens(
        separatedByCommas(indexedCardsExpressions[0].nameExpressions),
      ),
      'VALUES',
      ...separatedByCommas(
        indexedCardsExpressions.map((row) =>
          addExplicitParens(separatedByCommas(row.valueExpressions)),
        ),
      ),
    ]);
  }

  if (versionExpressions.length > 0) {
    await client.query([
      `INSERT INTO realm_versions`,
      ...addExplicitParens(
        separatedByCommas(versionExpressions[0].nameExpressions),
      ),
      'VALUES',
      ...separatedByCommas(
        versionExpressions.map((row) =>
          addExplicitParens(separatedByCommas(row.valueExpressions)),
        ),
      ),
    ]);
  }
}

module('Unit | index-db', function (hooks) {
  let adapter: SQLiteAdapter;
  let client: IndexerDBClient;

  hooks.beforeEach(async function () {
    adapter = new SQLiteAdapter(sqlSchema);
    client = new IndexerDBClient(adapter);
    await client.ready();
  });

  hooks.afterEach(async function () {
    await client.teardown();
  });

  test('can perform invalidations for an index entry', async function (assert) {
    await setupIndex(
      client,
      [
        { realm_url: testRealmURL, current_version: 1 },
        { realm_url: testRealmURL2, current_version: 5 },
      ],
      [
        {
          card_url: `${testRealmURL}1.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}2.json`],
        },
        {
          card_url: `${testRealmURL}2.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}4.json`],
        },
        {
          card_url: `${testRealmURL}3.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}2.json`],
        },
        {
          card_url: `${testRealmURL}4.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [],
        },
        {
          card_url: `${testRealmURL}5.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [],
        },
        {
          card_url: `${testRealmURL2}A.json`,
          realm_version: 5,
          realm_url: testRealmURL2,
          deps: [],
        },
      ],
    );

    let batch = await client.createBatch(new URL(testRealmURL));
    let invalidations = await batch.invalidate(
      new URL(`${testRealmURL}4.json`),
    );

    assert.deepEqual(invalidations.sort(), [
      `${testRealmURL}1.json`,
      `${testRealmURL}2.json`,
      `${testRealmURL}3.json`,
      `${testRealmURL}4.json`,
    ]);

    let originalEntries = await adapter.execute(
      'SELECT card_url, realm_url, is_deleted FROM indexed_cards WHERE realm_version = 1 ORDER BY card_url',
      { coerceTypes: { is_deleted: 'BOOLEAN' } },
    );
    assert.deepEqual(
      originalEntries,
      [1, 2, 3, 4, 5].map((i) => ({
        card_url: `${testRealmURL}${i}.json`,
        realm_url: testRealmURL,
        is_deleted: null,
      })),
      'the "production" version of the index entries are unchanged',
    );
    let invalidatedEntries = await adapter.execute(
      'SELECT card_url, realm_url, is_deleted FROM indexed_cards WHERE realm_version = 2 ORDER BY card_url',
      { coerceTypes: { is_deleted: 'BOOLEAN' } },
    );
    assert.deepEqual(
      invalidatedEntries,
      [1, 2, 3, 4].map((i) => ({
        card_url: `${testRealmURL}${i}.json`,
        realm_url: testRealmURL,
        is_deleted: true,
      })),
      'the "work-in-progress" version of the index entries have been marked as deleted',
    );
    let otherRealms = await adapter.execute(
      `SELECT card_url, realm_url, realm_version, is_deleted FROM indexed_cards WHERE realm_url != '${testRealmURL}'`,
      { coerceTypes: { is_deleted: 'BOOLEAN' } },
    );
    assert.deepEqual(
      otherRealms,
      [
        {
          card_url: `${testRealmURL2}A.json`,
          realm_url: testRealmURL2,
          realm_version: 5,
          is_deleted: null,
        },
      ],
      'the index entries from other realms are unchanged',
    );
    let realmVersions = await adapter.execute(
      'select * from realm_versions ORDER BY realm_url',
    );
    assert.deepEqual(
      realmVersions,
      [
        {
          realm_url: `${testRealmURL}`,
          current_version: 1,
        },
        {
          realm_url: `${testRealmURL2}`,
          current_version: 5,
        },
      ],
      'the "production" realm versions are correct',
    );
  });

  skip('does not create invalidation record for non-JSON invalidation', async function (_assert) {});

  skip('can prevent concurrent batch invalidations from colliding', async function (_assert) {});

  skip('can update an index entry', async function (_assert) {
    // test before and after the Batch.done ?
  });

  skip('can remove an index entry', async function (_assert) {
    // test before and after the Batch.done ?
  });

  skip('can create a new generation of index entries', async function (_assert) {});

  skip('can get "production" index entry', async function (_assert) {});

  skip('can get work in progress index entry', async function (_assert) {});

  skip('returns undefined when getting a deleted entry', async function (_assert) {});
});
