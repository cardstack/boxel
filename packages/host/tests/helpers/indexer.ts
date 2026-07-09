import { isEqual } from 'lodash-es';

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
  type RealmGenerationsTable,
  trimExecutableExtension,
  query,
  coerceTypes,
  rri,
} from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { testRealmURL } from './index';

const defaultIndexEntry = {
  generation: 1,
  realm_url: testRealmURL,
  has_error: false,
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
    types.push(
      internalKeyFor(loadedCardRef, undefined, loader.getVirtualNetwork()!),
    );
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
  return api.serializeCard(card, {}).data as CardResource;
}

// we can relax the resource here since we will be asserting an ID when we
// setup the index
type RelaxedBoxelIndexTable = Omit<BoxelIndexTable, 'pristine_doc'> & {
  pristine_doc: LooseCardResource | null;
};

// `loader_epoch` has a database default, so fixture rows may omit it;
// setupIndex fills in the no-epoch-yet sentinel at insert time.
export type TestRealmGenerationsRow = Omit<
  RealmGenerationsTable,
  'loader_epoch'
> & { loader_epoch?: string };

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

export interface SetupIndexOptions {
  // When `false`, `setupIndex` seeds only `boxel_index(_working)` and leaves
  // `prerendered_html(_working)` empty. The default projects the HTML/markdown
  // columns and generation onto `prerendered_html(_working)` — mirroring the
  // production backfill + dual-write — so tests read HTML/markdown through the
  // real `prerendered_html` path rather than the transitional `boxel_index`
  // fallback. Only a test that manages `prerendered_html` rows itself (to
  // exercise the fallback vs the mirror) needs to opt out.
  prerenderedHtml?: boolean;
}

// There are 3 ways to setup an index:
// 1. provide the raw data for each row in the boxel_index table
// 2. provide a card instance for each row in the boxel_index table
// 3. provide an object { card, data } where the card instance is used for each
//    row in the boxel_index table, as well as any additional fields that you
//    wish to set from the `data` object.
//
// the realm generations table will default to generation 1 of the testRealmURL
// if no value is supplied
export async function setupIndex(client: DBAdapter): Promise<void>;
export async function setupIndex(
  client: DBAdapter,
  indexRows: TestIndexRow[],
  options?: SetupIndexOptions,
): Promise<void>;
export async function setupIndex(
  client: DBAdapter,
  versionRows: TestRealmGenerationsRow[],
  indexRows: { working: TestIndexRow[]; production: TestIndexRow[] },
  options?: SetupIndexOptions,
): Promise<void>;
export async function setupIndex(
  client: DBAdapter,
  versionRows: TestRealmGenerationsRow[],
  indexRows: TestIndexRow[],
  options?: SetupIndexOptions,
): Promise<void>;
export async function setupIndex(
  client: DBAdapter,
  maybeVersionRows: TestRealmGenerationsRow[] | TestIndexRow[] = [],
  maybeRowsOrOptions?:
    | TestIndexRow[]
    | { working: TestIndexRow[]; production: TestIndexRow[] }
    | SetupIndexOptions,
  maybeOptions: SetupIndexOptions = {},
): Promise<void> {
  // The two-arg form `setupIndex(client, indexRows, options?)` passes options in
  // the third position; the versionRows forms pass rows there and options
  // fourth. Options are the only third-arg shape that is neither an array nor a
  // `{ working, production }` object, so disambiguate on that.
  let maybeWorkingProductionRows:
    | TestIndexRow[]
    | { working: TestIndexRow[]; production: TestIndexRow[] }
    | undefined;
  let options: SetupIndexOptions;
  if (
    maybeRowsOrOptions != null &&
    !Array.isArray(maybeRowsOrOptions) &&
    !('working' in maybeRowsOrOptions)
  ) {
    maybeWorkingProductionRows = undefined;
    options = maybeRowsOrOptions;
  } else {
    maybeWorkingProductionRows = maybeRowsOrOptions as
      | TestIndexRow[]
      | { working: TestIndexRow[]; production: TestIndexRow[] }
      | undefined;
    options = maybeOptions;
  }

  let versionRows: TestRealmGenerationsRow[];
  let workingRows: TestIndexRow[] = [];
  let productionRows: TestIndexRow[] = [];
  if (!maybeWorkingProductionRows) {
    versionRows = [{ realm_url: testRealmURL, current_generation: 1 }];
    workingRows = maybeVersionRows as TestIndexRow[];
    productionRows = maybeVersionRows as TestIndexRow[];
  } else {
    versionRows = maybeVersionRows as TestRealmGenerationsRow[];
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
    columnSourceTable: 'boxel_index_working',
  });
  let productionIndexedCardsExpressions = await indexedCardsExpressions({
    indexRows: productionRows,
    now,
    client,
    columnSourceTable: 'boxel_index',
  });
  let versionExpressions = versionRows.map((r) =>
    asExpressions({
      loader_epoch: '0',
      ...r,
    } satisfies RealmGenerationsTable),
  );

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
        `INSERT INTO realm_generations`,
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

  if (options.prerenderedHtml !== false) {
    if (workingIndexedCardsExpressions.length > 0) {
      await projectPrerenderedHtml(client, 'working');
    }
    if (productionIndexedCardsExpressions.length > 0) {
      await projectPrerenderedHtml(client, 'production');
    }
  }
}

// Project the HTML/markdown columns (and generation) of the `boxel_index(_working)`
// rows onto `prerendered_html(_working)`, matching the production backfill +
// dual-write (`IndexWriter.syncPrerenderedHtmlFromWorking`): same column mapping,
// `indexed_at` seeds `rendered_at`, and `icon_html` stays on `boxel_index`. The
// SELECT covers every row in the source table — in a freshly-seeded test DB
// those are exactly the rows `setupIndex` just wrote — and the upsert keeps the
// projection idempotent. This lets tests read HTML/markdown through the real
// `prerendered_html` path — the path that remains once the `boxel_index` HTML
// columns and the dual-read fallback are dropped.
async function projectPrerenderedHtml(
  client: DBAdapter,
  table: 'working' | 'production',
) {
  let source = table === 'working' ? 'boxel_index_working' : 'boxel_index';
  let target =
    table === 'working' ? 'prerendered_html_working' : 'prerendered_html';
  // `job_id` exists only on the working tables.
  let jobIdColumn = table === 'working' ? ', job_id' : '';
  let mutableColumns = [
    'file_alias',
    'fitted_html',
    'embedded_html',
    'atom_html',
    'head_html',
    'isolated_html',
    'markdown',
    'deps',
    'last_known_good_deps',
    'generation',
    'is_deleted',
    'error_doc',
    'diagnostics',
    'rendered_at',
    ...(table === 'working' ? ['job_id'] : []),
  ];
  await query(
    client,
    [
      `INSERT INTO ${target} (
         url, file_alias, realm_url, type,
         fitted_html, embedded_html, atom_html, head_html, isolated_html,
         markdown, deps, last_known_good_deps,
         generation, is_deleted, error_doc, diagnostics, rendered_at${jobIdColumn}
       )
       SELECT
         url, file_alias, realm_url, type,
         fitted_html, embedded_html, atom_html, head_html, isolated_html,
         markdown, deps, last_known_good_deps,
         generation, is_deleted, error_doc, diagnostics, indexed_at${jobIdColumn}
       FROM ${source}
       WHERE 1=1
       ON CONFLICT ON CONSTRAINT ${target}_pkey DO UPDATE SET ` +
        mutableColumns.map((name) => `${name}=EXCLUDED.${name}`).join(', '),
    ] as Expression,
    coerceTypes,
  );
}

async function indexedCardsExpressions({
  indexRows,
  now,
  client,
  columnSourceTable,
}: {
  indexRows: TestIndexRow[];
  now: number;
  client: DBAdapter;
  // Which table's column list to drive the dataObject projection. The
  // default `boxel_index` is missing columns that exist only on
  // `boxel_index_working` (e.g. `job_id`); when the caller is building
  // expressions for a working-table insert, those columns must be
  // preserved.
  columnSourceTable?: 'boxel_index' | 'boxel_index_working';
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
      row.file_alias = trimExecutableExtension(rri(row.url)).replace(
        /\.json$/,
        '',
      );
      row.type = row.type ?? 'instance';
      row.last_modified = String(row.last_modified ?? now);

      let valuesToInsert: { [key: string]: unknown } = {
        ...defaultIndexEntry,
        ...row,
      };
      let columnNames = await client.getColumnNames(
        columnSourceTable ?? 'boxel_index',
      );

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
