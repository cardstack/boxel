import flatten from 'lodash/flatten';
import {
  type LooseCardResource,
  type CodeRef,
  Loader,
  apiFor,
  baseCardRef,
  loadCard,
  internalKeyFor,
} from '../index';
import {
  type PgPrimitive,
  type Expression,
  type CardExpression,
  type FieldQuery,
  type FieldValue,
  type TableValuedFunction,
  param,
  isParam,
  tableValuedFunction,
  separatedByCommas,
  addExplicitParens,
  asExpressions,
  every,
} from './expression';
import { type Query, type Filter } from '../query';
import { type SerializedError } from '../error';
import { type DBAdapter } from '../db';
import { type SearchEntryWithErrors } from '../search-index';

import type { BaseDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

export interface IndexedCardsTable {
  card_url: string;
  realm_version: number;
  realm_url: string;
  // TODO in followup PR update this to be a document not a resource
  pristine_doc: LooseCardResource | null;
  error_doc: SerializedError | null;
  search_doc: Record<string, PgPrimitive> | null;
  // `deps` is a list of URLs that the card depends on, either card URL's or
  // module URL's
  deps: string[] | null;
  // `types` is the adoption chain for card where each code ref is serialized
  // using `internalKeyFor()`
  types: string[] | null;
  embedded_html: string | null;
  isolated_html: string | null;
  indexed_at: number | null;
  is_deleted: boolean | null;
}

export interface RealmVersionsTable {
  realm_url: string;
  current_version: number;
}

interface GetEntryOptions {
  useWorkInProgressIndex?: boolean;
}

interface QueryResultsMeta {
  // TODO SQLite doesn't let us use cursors in the classic sense so we need to
  // keep track of page size and index number--note it is possible for mutate
  // between pages. Perhaps consider querying a specific realm version (and only
  // cleanup realm versions when making generations) so we can see consistent
  // paginated results...
  page: {
    total: number;
    realmVersion?: number;
    startIndex?: number;
    pageSize?: number;
  };
}

const coerceTypes = Object.freeze({
  deps: 'JSON',
  types: 'JSON',
  pristine_doc: 'JSON',
  error_doc: 'JSON',
  search_doc: 'JSON',
  is_deleted: 'BOOLEAN',
});

export class IndexerDBClient {
  #ready: Promise<void>;
  constructor(private dbAdapter: DBAdapter) {
    this.#ready = this.dbAdapter.startClient();
  }

  async ready() {
    return this.#ready;
  }

  async teardown() {
    await this.dbAdapter.close();
  }

  async query(query: Expression) {
    let sql = await this.expressionToSql(query);
    // set chrome console to "Verbose" to see these queries in the console
    console.debug(`sql: ${sql.text} bindings: ${sql.values}`);
    return await this.dbAdapter.execute(sql.text, {
      coerceTypes,
      bind: sql.values,
    });
  }

  async queryCards(query: CardExpression, loader: Loader) {
    let sql = await this.cardQueryToSQL(query, loader);
    // set chrome console to "Verbose" to see these queries in the console
    console.debug(`sql: ${sql.text} bindings: ${sql.values}`);
    return await this.dbAdapter.execute(sql.text, {
      coerceTypes,
      bind: sql.values,
    });
  }

  // TODO handle getting error document
  async getIndexEntry(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<IndexedCardsTable | undefined> {
    let result = (await this.query([
      `SELECT i.* 
         FROM indexed_cards as i
         JOIN realm_versions r ON i.realm_url = r.realm_url
         WHERE i.card_url =`,
      param(`${!url.href.endsWith('.json') ? url.href + '.json' : url.href}`),
      ...(!opts?.useWorkInProgressIndex
        ? // if we are not using the work in progress index then we limit the max
          // version permitted to the current version for the realm
          ['AND i.realm_version <= r.current_version']
        : // otherwise we choose the highest version in the system
          []),
      'ORDER BY i.realm_version DESC',
      'LIMIT 1',
    ])) as unknown as IndexedCardsTable[];
    let maybeResult: IndexedCardsTable | undefined = result[0];
    if (!maybeResult) {
      return undefined;
    }
    if (maybeResult.is_deleted) {
      return undefined;
    }

    return maybeResult;
  }

  async createBatch(realmURL: URL) {
    let batch = new Batch(this, realmURL);
    await batch.ready;
    return batch;
  }

  async cardsThatReference(cardId: string): Promise<string[]> {
    // TODO we really need a cursor based solution to iterate through
    // this--pervious implementations ran into a bug that necessitated a cursor
    // for large invalidations. But beware, cursor support for SQLite in worker
    // mode is very limited. This will likely require some custom work...

    // TODO rewrite this using the TableValuedFunction expression
    let rows = (await this.query([
      `SELECT indexed_cards.card_url
         FROM
           indexed_cards,
           json_each(indexed_cards.deps) as deps_each
         WHERE 
           deps_each.value =`,
      // WARNING!!! SQLite doesn't support arrays, and the json_each() and
      // json_tree() functions that it does support are table-valued functions
      // meaning that we can only use them like tables. unsure if there is a
      // postgres equivalent. Need to research this.
      param(cardId),
    ])) as Pick<IndexedCardsTable, 'card_url'>[];
    return rows.map((r) => r.card_url);
  }

  // we pass the loader in so there is no ambiguity which loader to use as this
  // client may be serving a live index or a WIP index that is being built up
  // which could have conflicting loaders. It is up to the caller to provide the
  // loader that we should be using.
  async search(
    { filter }: Query,
    loader: Loader,
    // TODO this should be returning a CardCollectionDocument--handle that in
    // subsequent PR where we start storing card documents in "pristine_doc"
  ): Promise<{ cards: LooseCardResource[]; meta: QueryResultsMeta }> {
    let conditions: CardExpression[] = [];
    if (filter) {
      conditions.push(this.filterCondition(filter, baseCardRef));
    }

    // need to pluck out the functions to add as tables from the
    // tabledValuedFunctions
    let tableValuedFunctions = [
      ...conditions
        .reduce((tableValuedFunctions, i) => {
          let fns = i.filter(
            (i) => typeof i === 'object' && i.kind === 'table-valued',
          ) as TableValuedFunction[];
          for (let fn of fns) {
            tableValuedFunctions.set(fn.as, fn);
          }
          return tableValuedFunctions;
        }, new Map<string, TableValuedFunction>())
        .values(),
    ].map((t) => [`${t.fn} as ${t.as}`]);

    let query = [
      'SELECT card_url, pristine_doc',
      'FROM',
      ...separatedByCommas([['indexed_cards'], ...tableValuedFunctions]),
      'WHERE',
      ...every(conditions),
      // use a default sort for deterministic ordering, refactor this after
      // adding sort support to the query
      'ORDER BY card_url',
    ];
    let queryCount = [
      'SELECT count(*) as total',
      'FROM',
      ...separatedByCommas([['indexed_cards'], ...tableValuedFunctions]),
      'WHERE',
      ...every(conditions),
    ];

    let [totalResults, results] = await Promise.all([
      this.queryCards(queryCount, loader) as Promise<{ total: number }[]>,
      this.queryCards(query, loader) as Promise<
        Pick<IndexedCardsTable, 'pristine_doc' | 'card_url'>[]
      >,
    ]);

    let cards = results
      .map((r) => r.pristine_doc)
      .filter(Boolean) as LooseCardResource[];
    let meta = { page: { total: totalResults[0].total } };
    return { cards, meta };
  }

  private filterCondition(filter: Filter, onRef: CodeRef): CardExpression {
    if ('type' in filter) {
      return this.typeCondition(filter.type);
    }

    let on = filter.on ?? onRef;

    // TODO: any, every, not, eq, contains, range

    throw new Error(`Unknown filter: ${JSON.stringify(filter)}`);
  }

  // the type condition only consumes absolute URL card refs.
  private typeCondition(ref: CodeRef): CardExpression {
    return [
      tableValuedFunction('json_each(indexed_cards.types)', 'types_each', [
        'types_each.value =',
        param(internalKeyFor(ref, undefined)),
      ]),
    ];
  }

  private async cardQueryToSQL(query: CardExpression, loader: Loader) {
    return this.expressionToSql(await this.makeExpression(query, loader));
  }

  private async makeExpression(
    query: CardExpression,
    loader: Loader,
  ): Promise<Expression> {
    return flatten(
      await Promise.all(
        query.map((element) => {
          if (isParam(element) || typeof element === 'string') {
            return Promise.resolve([element]);
          } else if (element.kind === 'table-valued') {
            return this.makeExpression(element.value, loader);
          } else if (element.kind === 'field-query') {
            return this.handleFieldQuery(element, loader);
          } else if (element.kind === 'field-value') {
            return this.handleFieldValue(element, loader);
          } else {
            throw assertNever(element);
          }
        }),
      ),
    );
  }

  // TODO need to handle plural fields
  private async handleFieldQuery(
    fieldQuery: FieldQuery,
    loader: Loader,
  ): Promise<Expression> {
    let { path } = fieldQuery;

    return await this.walkFilterFieldPath(
      await loadCard(fieldQuery.type, { loader }),
      path,
      ['search_doc'],
      // Leaf field handler
      async (_api, _fieldCard, expression, fieldName) => {
        // TODO we should probably add a new hook in our cards to support custom
        // query expressions, like casting to a bigint for integers:
        //     return ['(', ...source, '->>', { param: fieldName }, ')::bigint'];
        return [...expression, '->>', param(fieldName)];
      },
      // interior field handler
      {
        enter: async (_api, _fieldCard, expression, fieldName) => {
          return [...expression, '->', param(fieldName)];
        },
      },
    );
  }

  // TODO need to handle plural fields
  private async handleFieldValue(
    fieldValue: FieldValue,
    loader: Loader,
  ): Promise<Expression> {
    let { path, value } = fieldValue;
    let exp = await this.makeExpression(value, loader);

    return await this.walkFilterFieldPath(
      await loadCard(fieldValue.type, { loader }),
      path,
      exp,
      // Leaf field handler
      async (api, fieldCard, expression) => {
        return fieldCard[api.queryableValue](expression);
      },
    );
  }

  private async walkFilterFieldPath(
    cardOrField: typeof BaseDef,
    path: string,
    expression: Expression,
    handleLeafField: FilterFieldHandler<Expression>,
    handleInteriorField?: FilterFieldHandlerWithEntryAndExit<Expression>,
  ): Promise<Expression>;
  private async walkFilterFieldPath(
    cardOrField: typeof BaseDef,
    path: string,
    expression: CardExpression,
    handleLeafField: FilterFieldHandler<CardExpression>,
    handleInteriorField?: FilterFieldHandlerWithEntryAndExit<CardExpression>,
  ): Promise<CardExpression>;
  private async walkFilterFieldPath(
    cardOrField: typeof BaseDef,
    path: string,
    expression: Expression,
    handleLeafField: FilterFieldHandler<any[]>,
    handleInteriorField?: FilterFieldHandlerWithEntryAndExit<any[]>,
  ): Promise<any> {
    let pathSegments = path.split('.');
    let isLeaf = pathSegments.length === 1;
    let currentSegment = pathSegments.shift()!;
    let api = await apiFor(cardOrField);
    let fields = api.getFields(cardOrField);
    let fieldCard = fields[currentSegment].card;
    if (isLeaf) {
      expression = await handleLeafField(
        api,
        fieldCard,
        expression,
        currentSegment,
      );
    } else {
      let passThru: FilterFieldHandler<any[]> = async (
        _api,
        _fc,
        e: Expression,
        _f,
      ) => e;
      // when dealing with an interior field that is not a leaf path segment,
      // the entrance and exit hooks allow you to decorate the expression for
      // the interior field before the interior's antecedant segment's
      // expression is processed and after the interior field's antecedant
      // segment's expression has been processed (i.e. recursing into the
      // antecedant field and recursing out of the antecedant field).
      let entranceHandler = handleInteriorField
        ? handleInteriorField.enter || passThru
        : passThru;
      let exitHandler = handleInteriorField
        ? handleInteriorField.exit || passThru
        : passThru;

      let interiorExpression = await this.walkFilterFieldPath(
        fieldCard,
        pathSegments.join('.'),
        await entranceHandler(api, fieldCard, expression, currentSegment),
        handleLeafField,
        handleInteriorField,
      );
      expression = await exitHandler(
        api,
        fieldCard,
        interiorExpression,
        currentSegment,
      );
    }
    return expression;
  }

  private expressionToSql(query: Expression) {
    let values: PgPrimitive[] = [];
    let text = query
      .map((element) => {
        if (isParam(element)) {
          values.push(element.param);
          return `$${values.length}`;
        } else if (typeof element === 'string') {
          return element;
        } else {
          throw new Error(`should never happen ${element}`);
        }
      })
      .join(' ');
    return {
      text,
      values,
    };
  }
}

export class Batch {
  readonly ready: Promise<void>;
  private touched = new Set<string>();
  private isNewGeneration = false;
  private declare realmVersion: number;

  constructor(
    private client: IndexerDBClient,
    private realmURL: URL, // this assumes that we only index cards in our own realm...
  ) {
    this.ready = this.setNextRealmVersion();
  }

  async updateEntry(url: URL, entry: SearchEntryWithErrors): Promise<void> {
    this.touched.add(url.href);
    let { nameExpressions, valueExpressions } = asExpressions(
      {
        card_url: url.href,
        realm_version: this.realmVersion,
        realm_url: this.realmURL.href,
        is_deleted: false,
        indexed_at: Date.now(),
        ...(entry.type === 'entry'
          ? {
              // TODO in followup PR we need to alter the SearchEntry type to use
              // a document instead of a resource
              pristine_doc: entry.entry.resource,
              search_doc: entry.entry.searchData,
              isolated_html: entry.entry.html,
              deps: [...entry.entry.deps],
              types: entry.entry.types,
            }
          : {
              error_doc: entry.error,
              deps: entry.error.deps,
            }),
      } as IndexedCardsTable,
      {
        jsonFields: [
          'pristine_doc',
          'search_doc',
          'deps',
          'types',
          'error_doc',
        ],
      },
    );

    await this.client.query([
      `INSERT OR REPLACE INTO indexed_cards`,
      ...addExplicitParens(separatedByCommas(nameExpressions)),
      'VALUES',
      ...addExplicitParens(separatedByCommas(valueExpressions)),
    ] as Expression);
  }

  async deleteEntry(url: URL): Promise<void> {
    this.touched.add(url.href);
    let { nameExpressions, valueExpressions } = asExpressions({
      card_url: url.href,
      realm_version: this.realmVersion,
      realm_url: this.realmURL.href,
      is_deleted: true,
      indexed_at: Date.now(),
    } as IndexedCardsTable);

    await this.client.query([
      `INSERT OR REPLACE INTO indexed_cards`,
      ...addExplicitParens(separatedByCommas(nameExpressions)),
      'VALUES',
      ...addExplicitParens(separatedByCommas(valueExpressions)),
    ] as Expression);
  }

  async makeNewGeneration() {
    this.isNewGeneration = true;
    let cols = ['card_url', 'realm_url', 'realm_version', 'is_deleted'].map(
      (c) => [c],
    );
    await this.detectUniqueConstraintError(
      () =>
        // create tombstones for all card URLs
        this.client.query([
          `INSERT INTO indexed_cards`,
          ...addExplicitParens(separatedByCommas(cols)),
          `SELECT card_url, realm_url, 2 as realm_version, true as is_deleted`,
          'FROM indexed_cards WHERE realm_url =',
          param(this.realmURL.href),
          'GROUP BY card_url',
        ] as Expression),
      { isMakingNewGeneration: true },
    );
  }

  async done(): Promise<void> {
    let { nameExpressions, valueExpressions } = asExpressions({
      realm_url: this.realmURL.href,
      current_version: this.realmVersion,
    } as RealmVersionsTable);
    // Make the batch updates live
    await this.client.query([
      `INSERT OR REPLACE INTO realm_versions`,
      ...addExplicitParens(separatedByCommas(nameExpressions)),
      'VALUES',
      ...addExplicitParens(separatedByCommas(valueExpressions)),
    ] as Expression);

    // prune obsolete index entries
    if (this.isNewGeneration) {
      await this.client.query([
        `DELETE FROM indexed_cards`,
        'WHERE realm_version <',
        param(this.realmVersion),
      ]);
    } else {
      await this.client.query([
        `DELETE FROM indexed_cards`,
        `WHERE card_url IN`,
        ...addExplicitParens(
          separatedByCommas([...this.touched].map((i) => [param(i)])),
        ),
        'AND realm_version <',
        param(this.realmVersion),
      ] as Expression);
    }
  }

  private async setNextRealmVersion() {
    let [row] = (await this.client.query([
      'SELECT current_version FROM realm_versions WHERE realm_url =',
      param(this.realmURL.href),
    ])) as Pick<RealmVersionsTable, 'current_version'>[];
    if (!row) {
      this.realmVersion = 1;
    } else {
      this.realmVersion = row.current_version + 1;
    }
  }

  async invalidate(
    url: URL /* this can be a card or module URL. This must include .json extension for cards */,
  ): Promise<string[]> {
    await this.ready;

    let invalidations = await this.calculateInvalidations(url.href);

    if (url.href.endsWith('.json')) {
      // insert tombstone into next version of the realm index
      let columns = [
        'card_url',
        'realm_version',
        'realm_url',
        'is_deleted',
      ].map((c) => [c]);
      let rows = invalidations
        // don't add module URLs to indexed_cards table--we use
        // '.json' extension as heuristic to identify card instances
        .filter((i) => i.endsWith('.json'))
        .map((id) =>
          [id, this.realmVersion, this.realmURL.href, true].map((v) => [
            param(v),
          ]),
        );

      await this.detectUniqueConstraintError(
        () =>
          this.client.query([
            `INSERT INTO indexed_cards`,
            ...addExplicitParens(separatedByCommas(columns)),
            'VALUES',
            ...separatedByCommas(
              rows.map((value) => addExplicitParens(separatedByCommas(value))),
            ),
          ] as Expression),
        { url, invalidations },
      );
    }

    // FYI: these invalidations may include modules...
    this.touched = new Set([...this.touched, ...invalidations]);
    return invalidations;
  }

  // invalidate will throw if 2 batches try to insert intersecting invalidation
  // graph. If this happens we should cancel the job that threw because of
  // primary key constraint violation and re-add it to the job queue with the
  // original notifier to try again
  private async detectUniqueConstraintError(
    fn: () => Promise<unknown>,
    opts?: {
      url?: URL;
      invalidations?: string[];
      isMakingNewGeneration?: boolean;
    },
  ) {
    try {
      return await fn();
    } catch (e: any) {
      // TODO need to also catch the pg form of this error
      // which would be great to bake into the adapter layer
      if (e.result?.message?.includes('UNIQUE constraint failed')) {
        let message = `Invalidation conflict error in realm ${this.realmURL.href} version ${this.realmVersion}`;
        if (opts?.url && opts?.invalidations) {
          message = `${message}: the invalidation ${
            opts.url.href
          } resulted in invalidation graph: ${JSON.stringify(
            opts.invalidations,
          )} that collides with unfinished indexing`;
        } else if (opts?.isMakingNewGeneration) {
          message = `${message}. created a new generation while there was still unfinished indexing`;
        }
        throw new Error(message);
      }
      throw e;
    }
  }

  private async calculateInvalidations(id: string): Promise<string[]> {
    let invalidations = [id];
    let childInvalidations = await this.client.cardsThatReference(id);
    invalidations = [
      ...invalidations,
      ...flatten(
        await Promise.all(
          childInvalidations.map((id) => this.calculateInvalidations(id)),
        ),
      ),
    ];
    return [...new Set(invalidations)];
  }
}

function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}

type FilterFieldHandler<T> = (
  api: typeof CardAPI,
  fieldCard: typeof BaseDef,
  expression: T,
  fieldName: string,
) => Promise<T>;

interface FilterFieldHandlerWithEntryAndExit<T> {
  enter?: FilterFieldHandler<T>;
  exit?: FilterFieldHandler<T>;
}
