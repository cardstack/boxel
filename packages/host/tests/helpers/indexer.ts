import {
  IndexerDBClient,
  asExpressions,
  addExplicitParens,
  separatedByCommas,
  type IndexedCardsTable,
  type RealmVersionsTable,
} from '@cardstack/runtime-common';

export async function setupIndex(
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
      jsonFields: ['deps', 'types', 'pristine_doc', 'error_doc', 'search_doc'],
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
