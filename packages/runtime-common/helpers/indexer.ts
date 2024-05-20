import {
  Indexer,
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
  type BoxelIndexTable,
  type RealmVersionsTable,
  LooseCardResource,
  trimExecutableExtension,
  isRootCardDef,
} from '../index';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { testRealmURL } from './const';
import { logger } from '../log';

const log = logger('indexer');

const defaultIndexEntry = {
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

    log.debug(
      `comparing ${JSON.stringify(loadedCardRef)} to ${JSON.stringify(
        baseCardRef,
      )}`,
    );
    console.log(
      `comparing ${JSON.stringify(loadedCardRef)} to ${JSON.stringify(
        baseCardRef,
      )}`,
    );
    if (!isRootCardDef(loadedCardRef)) {
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

// we can relax the resource here since we will be asserting an ID when we
// setup the index
type RelaxedBoxelIndexTable = Omit<BoxelIndexTable, 'pristine_doc'> & {
  pristine_doc: LooseCardResource;
};

export type TestIndexRow =
  | (Pick<RelaxedBoxelIndexTable, 'url'> &
      Partial<Omit<RelaxedBoxelIndexTable, 'url'>>)
  | CardDef
  | {
      card: CardDef;
      data: Partial<
        Omit<RelaxedBoxelIndexTable, 'url' | 'pristine_doc' | 'types'>
      >;
    };

// There are 3 ways to setup an index:
// 1. provide the raw data for each row in the boxel_index table
// 2. provide a card instance for each row in the boxel_index table
// 3. provide an object { card, data } where the card instance is used for each
//    row in the boxel_index table, as well as any additional fields that you
//    wish to set from the `data` object.
//
// the realm version table will default to version 1 of the testRealmURL if no
// value is supplied
export async function setupIndex(
  client: Indexer,
  indexRows: TestIndexRow[],
): Promise<void>;
export async function setupIndex(
  client: Indexer,
  versionRows: RealmVersionsTable[],
  indexRows: TestIndexRow[],
): Promise<void>;
export async function setupIndex(
  client: Indexer,
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
      let row: Pick<RelaxedBoxelIndexTable, 'url'> &
        Partial<Omit<RelaxedBoxelIndexTable, 'url'>>;
      if ('url' in r) {
        row = r;
      } else if ('card' in r) {
        row = {
          url: r.card.id,
          type: 'instance',
          pristine_doc: await serializeCard(r.card),
          types: await getTypes(r.card),
          ...r.data,
        };
      } else {
        row = {
          url: r.id,
          type: 'instance',
          pristine_doc: await serializeCard(r),
          types: await getTypes(r),
        };
      }
      row.url =
        row.type === 'instance'
          ? !row.url.endsWith('.json')
            ? `${row.url}.json`
            : row.url
          : row.url;
      row.file_alias = trimExecutableExtension(new URL(row.url)).href;
      row.type = row.type ?? 'instance';
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
      `INSERT INTO boxel_index`,
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
