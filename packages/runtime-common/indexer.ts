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
} from './index';
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
  any,
  every,
  fieldQuery,
  fieldValue,
  fieldArity,
  upsert,
  tableValuedFunctionsPlaceholder,
  query,
} from './expression';
import {
  type Query,
  type Filter,
  type EqFilter,
  type NotFilter,
  type ContainsFilter,
  type Sort,
  type RangeFilter,
  RANGE_OPERATORS,
  RangeOperator,
} from './query';
import { type SerializedError } from './error';
import { type DBAdapter } from './db';
import { type SearchEntryWithErrors } from './search-index';

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
    realmVersion: number;
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

export class Indexer {
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

  async query(expression: Expression) {
    return await query(this.dbAdapter, expression, coerceTypes);
  }

  private async queryCards(query: CardExpression, loader: Loader) {
    return this.query(await this.makeExpression(query, loader));
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
      ...realmVersionExpression(opts),
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
    // TODO we really need a solution to iterate through large invalidation
    // result sets for this--pervious implementations ran into a bug that
    // necessitated a cursor for large invalidations. But beware, there is no
    // cursor support for SQLite in worker mode. Instead, implement paging for
    // this query. we can probably do something similar to how we are paging the
    // search() method using realm_version for stability between pages.
    let rows = (await this.query([
      `SELECT card_url
       FROM
         indexed_cards as i
       CROSS JOIN LATERAL jsonb_array_elements_text(i.deps) as deps_array_element
       INNER JOIN realm_versions r ON i.realm_url = r.realm_url
       WHERE deps_array_element =`,
      param(cardId),
      'AND',
      ...realmVersionExpression({ useWorkInProgressIndex: true }),
      'ORDER BY i.card_url COLLATE "POSIX"',
    ] as Expression)) as Pick<IndexedCardsTable, 'card_url'>[];
    return rows.map((r) => r.card_url);
  }

  // we pass the loader in so there is no ambiguity which loader to use as this
  // client may be serving a live index or a WIP index that is being built up
  // which could have conflicting loaders. It is up to the caller to provide the
  // loader that we should be using.
  async search(
    realmURL: URL,
    { filter, sort, page }: Query,
    loader: Loader,
    opts?: QueryOptions,
    // TODO this should be returning a CardCollectionDocument--handle that in
    // subsequent PR where we start storing card documents in "pristine_doc"
  ): Promise<{ cards: LooseCardResource[]; meta: QueryResultsMeta }> {
    let version: number;
    if (page?.realmVersion) {
      version = page.realmVersion;
    } else {
      let [{ current_version }] = (await this.query([
        'SELECT current_version FROM realm_versions WHERE realm_url =',
        param(realmURL.href),
      ])) as Pick<RealmVersionsTable, 'current_version'>[];
      if (current_version == null) {
        throw new Error(`No current version found for realm ${realmURL.href}`);
      }
      version = opts?.useWorkInProgressIndex
        ? current_version + 1
        : current_version;
    }
    let conditions: CardExpression[] = [
      ['i.realm_url = ', param(realmURL.href)],
      ['is_deleted = FALSE OR is_deleted IS NULL'],
      realmVersionExpression({ withMaxVersion: version }),
    ];
    if (filter) {
      conditions.push(this.filterCondition(filter, baseCardRef));
    }

    let everyCondition = every(conditions);
    let query = [
      `SELECT card_url, ANY_VALUE(pristine_doc) AS pristine_doc`,
      `FROM indexed_cards AS i ${tableValuedFunctionsPlaceholder}`,
      `INNER JOIN realm_versions r ON i.realm_url = r.realm_url`,
      'WHERE',
      ...everyCondition,
      'GROUP BY card_url',
      ...this.orderExpression(sort),
      ...(page ? [`LIMIT ${page.size} OFFSET ${page.number * page.size}`] : []),
    ];
    let queryCount = [
      'SELECT COUNT(DISTINCT card_url) AS total',
      `FROM indexed_cards AS i ${tableValuedFunctionsPlaceholder}`,
      `INNER JOIN realm_versions r ON i.realm_url = r.realm_url`,
      'WHERE',
      ...everyCondition,
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
    let meta: QueryResultsMeta = {
      // postgres returns the `COUNT()` aggregate function as a string
      page: { total: Number(totalResults[0].total), realmVersion: version },
    };
    return { cards, meta };
  }

  private orderExpression(sort: Sort | undefined): CardExpression {
    if (!sort) {
      return ['ORDER BY card_url COLLATE "POSIX"'];
    }
    return [
      'ORDER BY',
      ...separatedByCommas([
        ...sort.map((s) => [
          // intentionally not using field arity here--not sure what it means to
          // sort via a plural field
          'ANY_VALUE(',
          fieldQuery(s.by, s.on, false, 'sort'),
          ')',
          s.direction ?? 'asc',
        ]),
        // we include 'card_url' as the final sort key for deterministic results
        ['card_url COLLATE "POSIX"'],
      ]),
    ];
  }

  private filterCondition(filter: Filter, onRef: CodeRef): CardExpression {
    if ('type' in filter) {
      return this.typeCondition(filter.type);
    }

    let on = filter.on ?? onRef;

    if ('eq' in filter) {
      return this.eqCondition(filter, on);
    } else if ('contains' in filter) {
      return this.containsCondition(filter, on);
    } else if ('not' in filter) {
      return this.notCondition(filter, on);
    } else if ('range' in filter) {
      return this.rangeCondition(filter, on);
    } else if ('every' in filter) {
      return every(
        filter.every.map((i) => this.filterCondition(i, filter.on ?? on)),
      );
    } else if ('any' in filter) {
      return any(
        filter.any.map((i) => this.filterCondition(i, filter.on ?? on)),
      );
    }

    // TODO handle filter for range
    // refer to hub v2 for a good reference:
    // https://github.dev/cardstack/cardstack/blob/d36e6d114272a9107a7315d95d2f0f415e06bf5c/packages/hub/pgsearch/pgclient.ts

    // TODO assert "notNever()" after we have implemented the "range" filter so we
    // get type errors if new filters are introduced
    throw new Error(`Unknown filter: ${JSON.stringify(filter)}`);
  }

  // the type condition only consumes absolute URL card refs.
  private typeCondition(ref: CodeRef): CardExpression {
    return [
      tableValuedEach('types'),
      '=',
      param(internalKeyFor(ref, undefined)),
    ];
  }

  private eqCondition(filter: EqFilter, on: CodeRef): CardExpression {
    on = filter.on ?? on;
    return every([
      this.typeCondition(on),
      ...Object.entries(filter.eq).map(([key, value]) => {
        return this.fieldEqFilter(key, value, on);
      }),
    ]);
  }

  private containsCondition(
    filter: ContainsFilter,
    on: CodeRef,
  ): CardExpression {
    on = filter.on ?? on;
    return every([
      this.typeCondition(on),
      ...Object.entries(filter.contains).map(([key, value]) => {
        return this.fieldLikeFilter(key, value, on);
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

  private rangeCondition(filter: RangeFilter, on: CodeRef): CardExpression {
    on = filter.on ?? on;
    return every([
      this.typeCondition(on),
      ...flatten(Object.entries(filter.range).map(([path, range]) => {
        let query = fieldQuery(path, on, false, 'filter');
        let cardExpression: FieldArity[][] = [];
        Object.entries(range).forEach(([operator, value]) => {
          if (value != null) {
            let v = fieldValue(path, [param(value)], on, 'filter');
            cardExpression.push([
              fieldArity({
              type: on,
              path,
              value: [query, RANGE_OPERATORS[operator as RangeOperator], v],
              errorHint: 'filter',
              })]
            );
          }
          
        });
        return cardExpression;
      })),
    ]);
  }

  private fieldEqFilter(
    key: string,
    value: JSONTypes.Value,
    onRef: CodeRef,
  ): CardExpression {
    if (value === null) {
      let query = fieldQuery(key, onRef, true, 'filter');
      return [
        fieldArity({
          type: onRef,
          path: key,
          value: [query, 'IS NULL'],
          pluralValue: [query, "= 'null'::jsonb"],
          usePluralContainer: true,
          errorHint: 'filter',
        }),
      ];
    }
    let query = fieldQuery(key, onRef, false, 'filter');
    let v = fieldValue(key, [param(value)], onRef, 'filter');
    return [
      fieldArity({
        type: onRef,
        path: key,
        value: [query, '=', v],
        errorHint: 'filter',
      }),
    ];
  }

  private fieldLikeFilter(
    key: string,
    value: JSONTypes.Value,
    onRef: CodeRef,
  ): CardExpression {
    if (value === null) {
      let query = fieldQuery(key, onRef, true, 'filter');
      return [
        fieldArity({
          type: onRef,
          path: key,
          value: [query, 'IS NULL'],
          pluralValue: [query, "= 'null'::jsonb"],
          usePluralContainer: true,
          errorHint: 'filter',
        }),
      ];
    }
    let query = fieldQuery(key, onRef, false, 'filter');
    let v = fieldValue(key, [param(`%${value}%`)], onRef, 'filter');
    return [
      fieldArity({
        type: onRef,
        path: key,
        value: [query, 'LIKE', v],
        errorHint: 'filter',
      }),
    ];
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
  //   CROSS JOIN LATERAL jsonb_array_elements_text(types) as types0_array_element
  //     -- This json_tree was derived by this handler:
  //   CROSS JOIN LATERAL jsonb_tree(search_doc, '$.friends') as friends1_tree
  //   WHERE
  //     ( ( is_deleted = FALSE OR is_deleted IS NULL ) )
  //     AND (
  //       ( types0_array_element = $1 )
  //       AND (
  //         ( friends1_tree.text_value = $2 )
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
    let { path, value, type, pluralValue, usePluralContainer } = fieldArity;

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
              pluralValue ?? expression,
              [
                tableValuedTree(
                  'search_doc',
                  trimPathAtFirstPluralField(pathTraveled),
                  'fullkey',
                ),
                `LIKE '$.${
                  usePluralContainer
                    ? convertBracketsToWildCards(
                        trimTrailingBrackets(pathTraveled),
                      )
                    : convertBracketsToWildCards(pathTraveled)
                }'`,
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
    let { path, type, useJsonBValue } = fieldQuery;
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
          return [
            tableValuedTree(
              'search_doc',
              rootPluralPath,
              useJsonBValue ? 'jsonb_value' : 'text_value',
            ),
          ];
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
            return [
              tableValuedTree('search_doc', rootPluralPath, 'text_value'),
            ];
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
}

export class Batch {
  readonly ready: Promise<void>;
  private touched = new Set<string>();
  private isNewGeneration = false;
  private declare realmVersion: number;

  constructor(
    private client: Indexer,
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
      ...upsert(
        'indexed_cards',
        'indexed_cards_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);
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
      ...upsert(
        'indexed_cards',
        'indexed_cards_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);
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
          `SELECT i.card_url, i.realm_url, ${this.realmVersion} as realm_version, true as is_deleted`,
          'FROM indexed_cards as i',
          'INNER JOIN realm_versions r ON i.realm_url = r.realm_url',
          'WHERE i.realm_url =',
          param(this.realmURL.href),
          'AND',
          ...realmVersionExpression({ useWorkInProgressIndex: false }),
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
      ...upsert(
        'realm_versions',
        'realm_versions_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);

    // prune obsolete generation index entries
    if (this.isNewGeneration) {
      await this.client.query([
        `DELETE FROM indexed_cards`,
        'WHERE realm_version <',
        param(this.realmVersion),
      ]);
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
      if (
        e.message?.includes('violates unique constraint') || // postgres
        e.result?.message?.includes('UNIQUE constraint failed') // sqlite
      ) {
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

function realmVersionExpression(opts?: {
  useWorkInProgressIndex?: boolean;
  withMaxVersion?: number;
}) {
  return [
    'realm_version =',
    ...addExplicitParens([
      'SELECT MAX(i2.realm_version)',
      'FROM indexed_cards i2',
      'WHERE i2.card_url = i.card_url',
      ...(opts?.withMaxVersion
        ? ['AND i2.realm_version <=', param(opts?.withMaxVersion)]
        : !opts?.useWorkInProgressIndex
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

function trimTrailingBrackets(pathTraveled: string) {
  return pathTraveled.replace(/\[\]$/g, '');
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
