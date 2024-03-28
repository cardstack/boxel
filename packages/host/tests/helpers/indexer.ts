import isEqual from 'lodash/isEqual';

import {
  IndexerDBClient,
  asExpressions,
  addExplicitParens,
  separatedByCommas,
  loaderFor,
  internalKeyFor,
  Deferred,
  identifyCard,
  apiFor,
  loadCard,
  baseCardRef,
  type CodeRef,
  type CardResource,
  type Expression,
  type IndexedCardsTable,
  type RealmVersionsTable,
} from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { testRealmURL } from './const';

let defaultIndexEntry = {
  realm_version: 1,
  realm_url: testRealmURL,
};

let typesCache = new WeakMap<typeof CardDef, Promise<string[]>>();

// this leverages the logic from current-run.ts to generate the types for a card
// that are serialized in the same manner as they appear in the index
export async function getTypes(instance: CardDef): Promise<string[]> {
  let loader = loaderFor(instance);
  let card = Reflect.getPrototypeOf(instance)!.constructor as typeof CardDef;
  let cached = typesCache.get(card);
  if (cached) {
    return await cached;
  }
  let ref = identifyCard(card);
  if (!ref) {
    throw new Error(`could not identify card ${card.name}`);
  }
  let deferred = new Deferred<string[]>();
  typesCache.set(card, deferred.promise);
  let types: string[] = [];
  let fullRef: CodeRef = ref;
  while (fullRef) {
    let loadedCard, loadedCardRef;
    loadedCard = await loadCard(fullRef, { loader });
    loadedCardRef = identifyCard(loadedCard);
    if (!loadedCardRef) {
      throw new Error(`could not identify card ${loadedCard.name}`);
    }
    types.push(internalKeyFor(loadedCardRef, undefined));
    if (!isEqual(loadedCardRef, baseCardRef)) {
      fullRef = {
        type: 'ancestorOf',
        card: loadedCardRef,
      };
    } else {
      break;
    }
  }
  deferred.fulfill(types);
  return types;
}

export async function serializeCard(card: CardDef): Promise<CardResource> {
  let api = await apiFor(card);
  return api.serializeCard(card).data as CardResource;
}

type TestIndexRow =
  | (Pick<IndexedCardsTable, 'card_url'> &
      Partial<Omit<IndexedCardsTable, 'card_url'>>)
  | CardDef
  | {
      card: CardDef;
      data: Partial<
        Omit<IndexedCardsTable, 'card_url' | 'pristine_doc' | 'types'>
      >;
    };

// There are 3 ways to setup an index:
// 1. provide the raw data for each row in the indexed_cards table
// 2. provide a card instance for each row in the indexed_cards table
// 3. provide an object { card, data } where the card instance is used for each
//    row in the indexed_cards table, as well as any additional fields that you
//    will to set from the `data` object.
//
// the realm version table will default to version 1 of the testRealmURL if no
// value is supplied
export async function setupIndex(
  client: IndexerDBClient,
  indexRows: TestIndexRow[],
): Promise<void>;
export async function setupIndex(
  client: IndexerDBClient,
  versionRows: RealmVersionsTable[],
  indexRows: TestIndexRow[],
): Promise<void>;
export async function setupIndex(
  client: IndexerDBClient,
  maybeVersionRows: RealmVersionsTable[] | TestIndexRow[],
  indexRows?: TestIndexRow[],
): Promise<void> {
  let versionRows: RealmVersionsTable[];
  if (!indexRows) {
    versionRows = [{ realm_url: testRealmURL, current_version: 1 }];
    indexRows = maybeVersionRows as TestIndexRow[];
  } else {
    versionRows = maybeVersionRows as RealmVersionsTable[];
  }
  let indexedCardsExpressions = await Promise.all(
    indexRows.map(async (r) => {
      let row: Pick<IndexedCardsTable, 'card_url'> &
        Partial<Omit<IndexedCardsTable, 'card_url'>>;
      if ('card_url' in r) {
        row = r;
      } else if ('card' in r) {
        row = {
          card_url: r.card.id,
          pristine_doc: await serializeCard(r.card),
          types: await getTypes(r.card),
          ...r.data,
        };
      } else {
        row = {
          card_url: r.id,
          pristine_doc: await serializeCard(r),
          types: await getTypes(r),
        };
      }
      return asExpressions(
        { ...defaultIndexEntry, ...row },
        {
          jsonFields: [
            'deps',
            'types',
            'pristine_doc',
            'error_doc',
            'search_doc',
          ],
        },
      );
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
    ] as Expression);
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
    ] as Expression);
  }
}
