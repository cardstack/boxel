import isEqual from 'lodash/isEqual';

import type { LooseCardResource, DBAdapter } from '@cardstack/runtime-common';
import {
  asExpressions,
  addExplicitParens,
  separatedByCommas,
  loaderFor,
  internalKeyFor,
  Deferred,
  identifyCard,
  apiFor,
  loadCardDef,
  baseCardRef,
  type CodeRef,
  type CardResource,
  type Expression,
  type BoxelIndexTable,
  type RealmVersionsTable,
  trimExecutableExtension,
  query,
  isDefinitionId,
  trimExportNameFromDefinitionId,
  coerceTypes,
} from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { testRealmURL } from './index';

const defaultIndexEntry = {
  realm_version: 1,
  realm_url: testRealmURL,
};

let typesCache = new WeakMap<typeof CardDef, Promise<string[]>>();

// this leverages the logic from index-runner.ts to generate the types for a card
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
    loadedCard = await loadCardDef(fullRef, { loader });
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

// we can relax the resource here since we will be asserting an ID when we
// setup the index
type RelaxedBoxelIndexTable = Omit<BoxelIndexTable, 'pristine_doc'> & {
  pristine_doc: LooseCardResource | null;
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
export async function setupIndex(client: DBAdapter): Promise<void>;
export async function setupIndex(
  client: DBAdapter,
  indexRows: TestIndexRow[],
): Promise<void>;
export async function setupIndex(
  client: DBAdapter,
  versionRows: RealmVersionsTable[],
  indexRows: { working: TestIndexRow[]; production: TestIndexRow[] },
): Promise<void>;
export async function setupIndex(
  client: DBAdapter,
  versionRows: RealmVersionsTable[],
  indexRows: TestIndexRow[],
): Promise<void>;
export async function setupIndex(
  client: DBAdapter,
  maybeVersionRows: RealmVersionsTable[] | TestIndexRow[] = [],
  maybeWorkingProductionRows?:
    | TestIndexRow[]
    | { working: TestIndexRow[]; production: TestIndexRow[] },
): Promise<void> {
  let versionRows: RealmVersionsTable[];
  let workingRows: TestIndexRow[] = [];
  let productionRows: TestIndexRow[] = [];
  if (!maybeWorkingProductionRows) {
    versionRows = [{ realm_url: testRealmURL, current_version: 1 }];
    workingRows = maybeVersionRows as TestIndexRow[];
    productionRows = maybeVersionRows as TestIndexRow[];
  } else {
    versionRows = maybeVersionRows as RealmVersionsTable[];
    if (Array.isArray(maybeWorkingProductionRows)) {
      workingRows = maybeWorkingProductionRows as TestIndexRow[];
      productionRows = maybeWorkingProductionRows as TestIndexRow[];
    } else {
      workingRows = maybeWorkingProductionRows.working;
      productionRows = maybeWorkingProductionRows.production;
    }
  }
  let now = Date.now();
  let workingIndexedCardsExpressions = await indexedCardsExpressions({
    indexRows: workingRows,
    now,
    client,
  });
  let productionIndexedCardsExpressions = await indexedCardsExpressions({
    indexRows: productionRows,
    now,
    client,
  });
  let versionExpressions = versionRows.map((r) => asExpressions(r));

  if (workingIndexedCardsExpressions.length > 0) {
    await query(
      client,
      [
        `INSERT INTO boxel_index_working`,
        ...addExplicitParens(
          separatedByCommas(workingIndexedCardsExpressions[0].nameExpressions),
        ),
        'VALUES',
        ...separatedByCommas(
          workingIndexedCardsExpressions.map((row) =>
            addExplicitParens(separatedByCommas(row.valueExpressions)),
          ),
        ),
      ] as Expression,
      coerceTypes,
    );
  }
  if (productionIndexedCardsExpressions.length > 0) {
    await query(
      client,
      [
        `INSERT INTO boxel_index`,
        ...addExplicitParens(
          separatedByCommas(
            productionIndexedCardsExpressions[0].nameExpressions,
          ),
        ),
        'VALUES',
        ...separatedByCommas(
          productionIndexedCardsExpressions.map((row) =>
            addExplicitParens(separatedByCommas(row.valueExpressions)),
          ),
        ),
      ] as Expression,
      coerceTypes,
    );
  }

  if (versionExpressions.length > 0) {
    await query(
      client,
      [
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
      ] as Expression,
      coerceTypes,
    );
  }
}

async function indexedCardsExpressions({
  indexRows,
  now,
  client,
}: {
  indexRows: TestIndexRow[];
  now: number;
  client: DBAdapter;
}) {
  return await Promise.all(
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
      row.file_alias = isDefinitionId(row.url)
        ? trimExportNameFromDefinitionId(row.url)
        : trimExecutableExtension(new URL(row.url)).href.replace(/\.json$/, '');
      row.type = row.type ?? 'instance';
      row.last_modified = String(row.last_modified ?? now);

      let valuesToInsert: { [key: string]: unknown } = {
        ...defaultIndexEntry,
        ...row,
      };
      let columnNames = await client.getColumnNames('boxel_index');

      // Make sure all table columns are present in the data object, even if their value is undefined. This is to assure
      // that the order of the columns in the insert statement is consistent for all types of resources
      // that get passed into setupIndex.
      let dataObject = Object.fromEntries(
        columnNames.map((column) => [column, valuesToInsert[column]]),
      );

      return asExpressions(dataObject, {
        jsonFields: [...Object.entries(coerceTypes)]
          .filter(([_, type]) => type === 'JSON')
          .map(([column]) => column),
      });
    }),
  );
}
