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
  type PrerenderedHtmlTable,
  type RealmGenerationsTable,
  trimExecutableExtension,
  query,
  coerceTypes,
  rri,
} from '@cardstack/runtime-common';

import { testRealmURL } from './index';

import type { CardDef } from '@cardstack/base/card-api';

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
// setup the index. A fixture row carries both channels' data in one flat
// object: the index half lands on `boxel_index(_pending)` and the HTML half
// (the prerendered_html columns picked in below) lands on
// `prerendered_html(_pending)` — setupIndex splits them by each table's
// column list.
type RelaxedBoxelIndexTable = Omit<BoxelIndexTable, 'pristine_doc'> & {
  pristine_doc: LooseCardResource | null;
} & Pick<
    PrerenderedHtmlTable,
    | 'isolated_html'
    | 'head_html'
    | 'embedded_html'
    | 'fitted_html'
    | 'atom_html'
    | 'markdown'
    | 'screenshots'
  >;

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
  // When `false`, `setupIndex` seeds only `boxel_index(_pending)` and leaves
  // `prerendered_html(_pending)` empty — the "indexed but not yet rendered"
  // state. The default seeds a `prerendered_html(_pending)` row per fixture
  // row carrying the fixture's HTML/markdown half, so tests read HTML through
  // the real `prerendered_html` path. Only a test that manages
  // `prerendered_html` rows itself needs to opt out.
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
// if no value is supplied.
//
// Rows given as a plain array are committed rows. The `{ working, production }`
// form also stages its `working` rows the way an index pass stages them: in the
// pending tables, under the staging id of the job the row names (`job_id`), or
// the one it names itself (`staging_id`). A pass reads only its own staging, so
// a working row naming neither would be staged where no batch reads it, and is
// refused.
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
    productionRows = maybeVersionRows as TestIndexRow[];
  } else {
    versionRows = maybeVersionRows as TestRealmGenerationsRow[];
    if (Array.isArray(maybeWorkingProductionRows)) {
      productionRows = maybeWorkingProductionRows as TestIndexRow[];
    } else {
      workingRows = maybeWorkingProductionRows.working;
      productionRows = maybeWorkingProductionRows.production;
    }
  }
  let now = Date.now();
  let normalizedWorkingRows = (await normalizeIndexRows(workingRows, now)).map(
    (row) => {
      let stagingId =
        (row.staging_id as string | undefined) ??
        (row.job_id != null ? `job:${String(row.job_id)}` : undefined);
      if (stagingId === undefined) {
        throw new Error(
          `working row ${String(row.url)} names neither a job_id nor a staging_id, so no batch would read it`,
        );
      }
      return { ...row, staging_id: stagingId };
    },
  );
  let normalizedProductionRows = await normalizeIndexRows(productionRows, now);
  let workingIndexedCardsExpressions = await tableExpressions(
    client,
    'boxel_index_pending',
    normalizedWorkingRows,
  );
  let productionIndexedCardsExpressions = await tableExpressions(
    client,
    'boxel_index',
    normalizedProductionRows,
  );
  let versionExpressions = versionRows.map((r) =>
    asExpressions({
      loader_epoch: '0',
      ...r,
    } satisfies RealmGenerationsTable),
  );

  await insertRows(
    client,
    'boxel_index_pending',
    workingIndexedCardsExpressions,
  );
  await insertRows(client, 'boxel_index', productionIndexedCardsExpressions);

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

  // Each fixture row's HTML/markdown half lands on `prerendered_html(_pending)`
  // — the sole home of rendered output — with `rendered_at` seeded from the
  // row's `indexed_at` (or the shared insert time). A row that carries no
  // rendering fields gets no `prerendered_html` row: it is indexed but not
  // yet rendered, exactly as a row awaiting its render job reads in
  // production. `icon_html` stays on `boxel_index`.
  if (options.prerenderedHtml !== false) {
    let renderingFields = [
      'isolated_html',
      'head_html',
      'embedded_html',
      'fitted_html',
      'atom_html',
      'markdown',
    ];
    let renderedRows = (rows: Record<string, unknown>[]) =>
      rows
        .filter((row) =>
          renderingFields.some((field) => row[field] !== undefined),
        )
        .map((row) => ({
          ...row,
          rendered_at: row.rendered_at ?? row.indexed_at ?? now,
        }));
    await insertRows(
      client,
      'prerendered_html_pending',
      await tableExpressions(
        client,
        'prerendered_html_pending',
        renderedRows(normalizedWorkingRows),
      ),
    );
    await insertRows(
      client,
      'prerendered_html',
      await tableExpressions(
        client,
        'prerendered_html',
        renderedRows(normalizedProductionRows),
      ),
    );
  }
}

async function insertRows(
  client: DBAdapter,
  table: string,
  rows: ReturnType<typeof asExpressions>[],
) {
  if (rows.length === 0) {
    return;
  }
  // One multi-row INSERT binds `rows * columns` parameters and every driver
  // caps a statement's parameter count (sqlite-wasm at 32,766, Postgres at
  // 65,535). A fixture big enough to exercise the writer's own chunking would
  // otherwise blow that ceiling here, during setup, before the code under test
  // ever runs — and a seed row carries more columns than a tombstone does, so
  // setup would always fail first. Chunk against the same conservative budget
  // the writer uses for sqlite.
  let columnCount = rows[0].nameExpressions.length;
  let rowsPerInsert = Math.max(1, Math.floor(900 / columnCount));
  for (let i = 0; i < rows.length; i += rowsPerInsert) {
    let slice = rows.slice(i, i + rowsPerInsert);
    await query(
      client,
      [
        `INSERT INTO ${table}`,
        ...addExplicitParens(separatedByCommas(rows[0].nameExpressions)),
        'VALUES',
        ...separatedByCommas(
          slice.map((row) =>
            addExplicitParens(separatedByCommas(row.valueExpressions)),
          ),
        ),
      ] as Expression,
      coerceTypes,
    );
  }
}

// Normalize the fixture shapes (raw row / card / {card, data}) into flat row
// objects carrying both channels' data. `tableExpressions` projects a table's
// own columns out of a normalized row, so one row seeds its
// `boxel_index(_pending)` half and its `prerendered_html(_pending)` half.
async function normalizeIndexRows(
  indexRows: TestIndexRow[],
  now: number,
): Promise<Record<string, unknown>[]> {
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

      return {
        ...defaultIndexEntry,
        ...row,
      };
    }),
  );
}

async function tableExpressions(
  client: DBAdapter,
  table:
    | 'boxel_index'
    | 'boxel_index_pending'
    | 'prerendered_html'
    | 'prerendered_html_pending',
  rows: Record<string, unknown>[],
) {
  let columnNames = await client.getColumnNames(table);
  return rows.map((row) => {
    // Make sure all table columns are present in the data object, even if
    // their value is undefined. This is to assure that the order of the
    // columns in the insert statement is consistent for all types of
    // resources that get passed into setupIndex.
    let dataObject = Object.fromEntries(
      columnNames.map((column) => [column, row[column]]),
    );
    return asExpressions(dataObject, {
      jsonFields: [...Object.entries(coerceTypes)]
        .filter(([_, type]) => type === 'JSON')
        .map(([column]) => column),
    });
  });
}
