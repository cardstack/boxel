import * as JSONTypes from 'json-typescript';
import flatten from 'lodash/flatten';
import {
  type LooseCardResource,
  type CodeRef,
  Loader,
  baseCardRef,
  loadCard,
  internalKeyFor,
  identifyCard,
} from '../index';
import {
  type PgPrimitive,
  type Expression,
  type CardExpression,
  type FieldQuery,
  type FieldValue,
  type FieldArity,
  param,
  isParam,
  tableValuedEach,
  tableValuedTree,
  separatedByCommas,
  addExplicitParens,
  asExpressions,
  every,
  fieldQuery,
  fieldValue,
  fieldArity,
} from './expression';
import {
  type Query,
  type Filter,
  type EqFilter,
  type NotFilter,
} from '../query';
import { type SerializedError } from '../error';
import { type DBAdapter } from '../db';
import { type SearchEntryWithErrors } from '../search-index';

import type { BaseDef, Field } from 'https://cardstack.com/base/card-api';
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

type GetEntryOptions = WIPOptions;
type QueryOptions = WIPOptions;
interface WIPOptions {
  useWorkInProgressIndex?: boolean;
}

interface QueryResultsMeta {
  // TODO SQLite doesn't let us use cursors in the classic sense so we need to
  // keep track of page size and index number--note it is possible for the index
  // to mutate between pages. Perhaps consider querying a specific realm version
  // (and only cleanup realm versions when making generations) so we can see
  // consistent paginated results...
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

const placeholder = '__TABLE_VALUED_FUNCTIONS__';

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
       INNER JOIN realm_versions r ON i.realm_url = r.realm_url
       WHERE i.card_url =`,
      param(`${!url.href.endsWith('.json') ? url.href + '.json' : url.href}`),
      'AND',
      ...realmVersionExpression(!!opts?.useWorkInProgressIndex),
    ] as Expression)) as unknown as IndexedCardsTable[];
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

    let rows = (await this.query([
      `SELECT card_url
       FROM
         indexed_cards as i,
         json_each(i.deps) as deps_each
       INNER JOIN realm_versions r ON i.realm_url = r.realm_url
       WHERE 
         deps_each.value =`,
      param(cardId),
      'AND',
      ...realmVersionExpression(true),
      'ORDER BY i.card_url',
    ] as Expression)) as Pick<IndexedCardsTable, 'card_url'>[];
    return rows.map((r) => r.card_url);
  }

  // we pass the loader in so there is no ambiguity which loader to use as this
  // client may be serving a live index or a WIP index that is being built up
  // which could have conflicting loaders. It is up to the caller to provide the
  // loader that we should be using.
  async search(
    { filter }: Query,
    loader: Loader,
    opts?: QueryOptions,
    // TODO this should be returning a CardCollectionDocument--handle that in
    // subsequent PR where we start storing card documents in "pristine_doc"
  ): Promise<{ cards: LooseCardResource[]; meta: QueryResultsMeta }> {
    let conditions: CardExpression[] = [
      [
        ...every([
          ['is_deleted = FALSE OR is_deleted IS NULL'],
          realmVersionExpression(!!opts?.useWorkInProgressIndex),
        ]),
      ],
    ];
    if (filter) {
      conditions.push(this.filterCondition(filter, baseCardRef));
    }

    let query = [
      'SELECT card_url, pristine_doc',
      `FROM indexed_cards as i ${placeholder}`,
      `INNER JOIN realm_versions r ON i.realm_url = r.realm_url`,
      'WHERE',
      ...every(conditions),
      // use a default sort for deterministic ordering, refactor this after
      // adding sort support to the query
      'GROUP BY card_url',
      'ORDER BY card_url',
    ];
    let queryCount = [
      'SELECT count(DISTINCT card_url) as total',
      `FROM indexed_cards as i ${placeholder}`,
      `INNER JOIN realm_versions r ON i.realm_url = r.realm_url`,
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

    if ('eq' in filter) {
      return this.eqCondition(filter, on);
    } else if ('not' in filter) {
      return this.notCondition(filter, on);
    } else if ('every' in filter) {
      // on = filter.on ?? on;
      return every(
        filter.every.map((i) => this.filterCondition(i, filter.on ?? on)),
      );
    }

    // TODO handle filters for: any, every, contains, and range
    // refer to hub v2 for a good reference:
    // https://github.dev/cardstack/cardstack/blob/d36e6d114272a9107a7315d95d2f0f415e06bf5c/packages/hub/pgsearch/pgclient.ts

    // TODO assert "notNever()" after we have implemented all the filters so we
    // get type errors if new filters are introduced
    throw new Error(`Unknown filter: ${JSON.stringify(filter)}`);
  }

  // the type condition only consumes absolute URL card refs.
  private typeCondition(ref: CodeRef): CardExpression {
    return [
      tableValuedEach('types', '$'),
      '=',
      param(internalKeyFor(ref, undefined)),
    ];
  }

  private eqCondition(filter: EqFilter, on: CodeRef): CardExpression {
    on = filter.on ?? on;
    return every([
      this.typeCondition(on),
      ...Object.entries(filter.eq).map(([key, value]) => {
        return this.fieldFilter(key, value, on);
      }),
    ]);
  }

  private notCondition(filter: NotFilter, on: CodeRef): CardExpression {
    on = filter.on ?? on;
    return every([
      this.typeCondition(on),
      ['NOT', ...addExplicitParens(this.filterCondition(filter.not, on))],
    ]);
  }

  private fieldFilter(
    key: string,
    value: JSONTypes.Value,
    onRef: CodeRef,
  ): CardExpression {
    let query = fieldQuery(key, onRef, 'filter');
    if (value === null) {
      return [query, 'IS NULL'];
    }
    let v = fieldValue(key, [param(value)], onRef, 'filter');
    return [fieldArity(onRef, key, [query, '=', v], 'filter')];
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
          if (
            isParam(element) ||
            typeof element === 'string' ||
            element.kind === 'table-valued-each' ||
            element.kind === 'table-valued-tree'
          ) {
            return Promise.resolve([element]);
          } else if (element.kind === 'field-query') {
            return this.handleFieldQuery(element, loader);
          } else if (element.kind === 'field-value') {
            return this.handleFieldValue(element, loader);
          } else if (element.kind === 'field-arity') {
            return this.handleFieldArity(element, loader);
          } else {
            throw assertNever(element);
          }
        }),
      ),
    );
  }

  // The goal of this handler is to ensure that the use of table valued
  // json_tree() function that we use for querying thru fields that are plural
  // is confined to the specific JSON path that our query should run. This means
  // that we need to determine the root path for the json_tree() function, as
  // well as the "query path" for the json_tree() function. The query path
  // predicate is AND'ed to the expression contained in the FieldArity
  // expression. Queries that do not go thru a plural field can use the normal
  // '->' and '->>' JSON operators.
  // The result is a query that looks like this:
  //
  //   SELECT card_url, pristine_doc
  //   FROM
  //     indexed_cards,
  //     json_each(types, '$') as types0_each,
  //     -- This json_tree was derived by this handler:
  //     json_tree(search_doc, '$.friends') as friends1_tree
  //   WHERE
  //     ( ( is_deleted = FALSE OR is_deleted IS NULL ) )
  //     AND (
  //       ( types0_each.value = $1 )
  //       AND (
  //         ( friends1_tree.value = $2 )
  //         AND
  //         -- This predicate was derived by this handler:
  //         ( friends1_tree.fullkey LIKE '$.friends[%].bestFriend.name' )
  //       )
  //     )
  //   GROUP BY card_url
  //   ORDER BY card_url

  private async handleFieldArity(
    fieldArity: FieldArity,
    loader: Loader,
  ): Promise<Expression> {
    let { path, value, type } = fieldArity;

    let exp: CardExpression = await this.walkFilterFieldPath(
      loader,
      await loadFieldOrCard(type, loader),
      path,
      value,
      // Leaf field handler
      async (_api, _field, expression, _fieldName, pathTraveled) => {
        if (traveledThruPlural(pathTraveled)) {
          return [
            ...every([
              expression,
              [
                tableValuedTree(
                  'search_doc',
                  trimPathAtFirstPluralField(pathTraveled),
                  'fullkey',
                ),
                `LIKE '$.${convertBracketsToWildCards(pathTraveled)}'`,
              ],
            ]),
          ];
        }
        return expression;
      },
    );
    return await this.makeExpression(exp, loader);
  }

  private async handleFieldQuery(
    fieldQuery: FieldQuery,
    loader: Loader,
  ): Promise<Expression> {
    let { path, type } = fieldQuery;
    // The rootPluralPath should line up with the tableValuedTree that was
    // used in the handleFieldArity (the multiple tableValuedTree expressions will
    // collapse into a single function)
    let rootPluralPath: string | undefined;

    let exp = await this.walkFilterFieldPath(
      loader,
      await loadFieldOrCard(type, loader),
      path,
      [],
      // Leaf field handler
      async (_api, field, expression, fieldName, pathTraveled) => {
        // TODO we should probably add a new hook in our cards to support custom
        // query expressions, like casting to a bigint for integers:
        //     return ['(', ...source, '->>', { param: fieldName }, ')::bigint'];
        if (isFieldPlural(field)) {
          rootPluralPath = trimPathAtFirstPluralField(pathTraveled);
          return [tableValuedTree('search_doc', rootPluralPath, 'value')];
        } else if (!rootPluralPath) {
          return [...expression, '->>', param(fieldName)];
        }
        return expression;
      },
      // interior field handler
      {
        enter: async (_api, field, expression, _fieldName, pathTraveled) => {
          // we work forwards determining if any interior fields are plural
          // since that requires a different style predicate
          if (isFieldPlural(field)) {
            rootPluralPath = trimPathAtFirstPluralField(pathTraveled);
            return [tableValuedTree('search_doc', rootPluralPath, 'value')];
          }
          return expression;
        },
        exit: async (_api, field, expression, fieldName, _pathTraveled) => {
          // we populate the singular fields backwards as we can only do that
          // after we are assured that we are not leveraging the plural style
          // predicate
          if (!isFieldPlural(field) && !rootPluralPath) {
            return ['->', param(fieldName), ...expression];
          }
          return expression;
        },
      },
    );
    if (!rootPluralPath) {
      exp = ['search_doc', ...exp];
    }
    return exp;
  }

  private async handleFieldValue(
    fieldValue: FieldValue,
    loader: Loader,
  ): Promise<Expression> {
    let { path, value, type } = fieldValue;
    let exp = await this.makeExpression(value, loader);

    return await this.walkFilterFieldPath(
      loader,
      await loadFieldOrCard(type, loader),
      path,
      exp,
      // Leaf field handler
      async (api, field, expression) => {
        let queryValue: any;
        let [value] = expression;
        if (isParam(value)) {
          queryValue = api.formatQueryValue(field, value.param);
        } else if (typeof value === 'string') {
          queryValue = api.formatQueryValue(field, value);
        } else {
          throw new Error(
            `Do not know how to handle field value: ${JSON.stringify(value)}`,
          );
        }
        return [param(queryValue)];
      },
    );
  }

  private async walkFilterFieldPath(
    loader: Loader,
    cardOrField: typeof BaseDef,
    path: string,
    expression: Expression,
    handleLeafField: FilterFieldHandler<Expression>,
    handleInteriorField?: FilterFieldHandlerWithEntryAndExit<Expression>,
    pathTraveled?: string[],
  ): Promise<Expression>;
  private async walkFilterFieldPath(
    loader: Loader,
    cardOrField: typeof BaseDef,
    path: string,
    expression: CardExpression,
    handleLeafField: FilterFieldHandler<CardExpression>,
    handleInteriorField?: FilterFieldHandlerWithEntryAndExit<CardExpression>,
    pathTraveled?: string[],
  ): Promise<CardExpression>;
  private async walkFilterFieldPath(
    loader: Loader,
    cardOrField: typeof BaseDef,
    path: string,
    expression: Expression,
    handleLeafField: FilterFieldHandler<any[]>,
    handleInteriorField?: FilterFieldHandlerWithEntryAndExit<any[]>,
    pathTraveled?: string[],
  ): Promise<any> {
    let pathSegments = path.split('.');
    let isLeaf = pathSegments.length === 1;
    let currentSegment = pathSegments.shift()!;
    let api = await loader.import<typeof CardAPI>(
      'https://cardstack.com/base/card-api',
    );
    if (!api) {
      throw new Error(`could not load card API`);
    }
    let fields = api.getFields(cardOrField);
    let field = fields[currentSegment];
    if (!field) {
      throw new Error(
        `Your filter refers to nonexistent field "${currentSegment}" on type ${JSON.stringify(
          identifyCard(cardOrField),
        )}`,
      );
    }
    // we use '[]' to denote plural fields as that has important ramifications
    // to how we compose our queries in the various handlers and ultimately in
    // SQL construction
    let traveled = [
      ...(pathTraveled ?? []),
      `${currentSegment}${isFieldPlural(field) ? '[]' : ''}`,
    ].join('.');
    if (isLeaf) {
      expression = await handleLeafField(
        api,
        field,
        expression,
        currentSegment,
        traveled,
      );
    } else {
      let passThru: FilterFieldHandler<any[]> = async (
        _api,
        _fc,
        e: Expression,
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
        loader,
        field.card,
        pathSegments.join('.'),
        await entranceHandler(api, field, expression, currentSegment, traveled),
        handleLeafField,
        handleInteriorField,
        traveled.split('.'),
      );
      expression = await exitHandler(
        api,
        field,
        interiorExpression,
        currentSegment,
        traveled,
      );
    }
    return expression;
  }

  private expressionToSql(query: Expression) {
    let values: PgPrimitive[] = [];
    let nonce = 0;
    let tableValuedFunctions = new Map<
      string,
      {
        name: string;
        fn: string;
      }
    >();
    let text = query
      .map((element) => {
        if (isParam(element)) {
          values.push(element.param);
          return `$${values.length}`;
        } else if (typeof element === 'string') {
          return element;
        } else if (
          element.kind === 'table-valued-each' ||
          element.kind === 'table-valued-tree'
        ) {
          let { column, path } = element;
          let virtualColumn =
            element.kind === 'table-valued-tree' ? element.treeColumn : 'value';
          let type = element.kind === 'table-valued-tree' ? 'tree' : 'each';
          let field = trimBrackets(
            path === '$' ? column : path.split('.').pop()!,
          );
          let key = `${type}_${column}_${path}`;
          let { name } = tableValuedFunctions.get(key) ?? {};
          if (!name) {
            name = `${field}${nonce++}_${type}`;
            let absolutePath = path === '$' ? '$' : `$.${path}`;

            tableValuedFunctions.set(key, {
              name,
              fn: `json_${type}(${column}, '${absolutePath}') as ${name}`,
            });
          }
          return `${name}.${virtualColumn}`;
        } else {
          throw assertNever(element);
        }
      })
      .join(' ');

    if (tableValuedFunctions.size > 0) {
      text = replace(
        text,
        placeholder,
        `, ${[...tableValuedFunctions.values()].map((fn) => fn.fn).join(', ')}`,
      );
    } else {
      text = replace(text, placeholder, '');
    }
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

async function loadFieldOrCard(
  ref: CodeRef,
  loader: Loader,
): Promise<typeof BaseDef> {
  try {
    return await loadCard(ref, { loader });
  } catch (e: any) {
    if (!('type' in ref)) {
      throw new Error(
        `Your filter refers to nonexistent type: import ${
          ref.name === 'default' ? 'default' : `{ ${ref.name} }`
        } from "${ref.module}"`,
      );
    } else {
      throw new Error(
        `Your filter refers to nonexistent type: ${JSON.stringify(
          ref,
          null,
          2,
        )}`,
      );
    }
  }
}

function realmVersionExpression(useWorkInProgressIndex: boolean) {
  return [
    'realm_version =',
    ...addExplicitParens([
      'SELECT MAX(i2.realm_version)',
      'FROM indexed_cards i2',
      'WHERE i2.card_url = i.card_url',
      ...(!useWorkInProgressIndex
        ? // if we are not using the work in progress index then we limit the max
          // version permitted to the current version for the realm
          ['AND i2.realm_version <= r.current_version']
        : // otherwise we choose the highest version in the system
          []),
    ]),
  ] as Expression;
}

function traveledThruPlural(pathTraveled: string) {
  return pathTraveled.includes('[');
}

function trimBrackets(pathTraveled: string) {
  return pathTraveled.replace(/\[\]/g, '');
}

function trimPathAtFirstPluralField(pathTraveled: string) {
  return pathTraveled.substring(0, pathTraveled.indexOf('['));
}

function convertBracketsToWildCards(pathTraveled: string) {
  return pathTraveled.replace(/\[\]/g, '[%]');
}

function isFieldPlural(field: Field): boolean {
  return (
    field.fieldType === 'containsMany' || field.fieldType === 'linksToMany'
  );
}

// i'm slicing up the text as opposed to using a 'String.replace()' since
// the ()'s in the SQL query are treated like regex matches when using
// String.replace()
function replace(text: string, placeholder: string, replacement: string) {
  let index = text.indexOf(placeholder);
  if (index === -1) {
    return text;
  }
  return `${text.substring(0, index)}${replacement}${text.substring(
    index + placeholder.length,
  )}`;
}

function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}

type FilterFieldHandler<T> = (
  api: typeof CardAPI,
  field: Field,
  expression: T,
  fieldName: string,
  pathTraveled: string,
) => Promise<T>;

interface FilterFieldHandlerWithEntryAndExit<T> {
  enter?: FilterFieldHandler<T>;
  exit?: FilterFieldHandler<T>;
}
