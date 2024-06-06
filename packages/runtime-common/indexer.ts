import * as JSONTypes from 'json-typescript';
import flatten from 'lodash/flatten';
import {
  type CardResource,
  type CodeRef,
  Loader,
  baseCardRef,
  loadCard,
  internalKeyFor,
  identifyCard,
  hasExecutableExtension,
  trimExecutableExtension,
  RealmPaths,
} from './index';
import { transpileJS } from './transpile';
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
  RangeFilterValue,
} from './query';
import { type SerializedError } from './error';
import { type DBAdapter } from './db';

import type { BaseDef, Field } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

export interface BoxelIndexTable {
  url: string;
  file_alias: string;
  realm_version: number;
  realm_url: string;
  type: 'instance' | 'module' | 'error';
  // TODO in followup PR update this to be a document not a resource
  pristine_doc: CardResource | null;
  error_doc: SerializedError | null;
  search_doc: Record<string, PgPrimitive> | null;
  // `deps` is a list of URLs that the card depends on, either card URL's or
  // module URL's
  deps: string[] | null;
  // `types` is the adoption chain for card where each code ref is serialized
  // using `internalKeyFor()`
  types: string[] | null;
  transpiled_code: string | null;
  source: string | null;
  embedded_html: string | null;
  isolated_html: string | null;
  indexed_at: number | null;
  is_deleted: boolean | null;
}

export interface RealmVersionsTable {
  realm_url: string;
  current_version: number;
}

interface IndexedModule {
  type: 'module';
  executableCode: string;
  // TODO source
}

export interface IndexedInstance {
  type: 'instance';
  instance: CardResource;
  isolatedHtml: string | null;
  searchDoc: Record<string, any> | null;
  types: string[] | null;
  deps: string[] | null;
  realmVersion: number;
  realmURL: string;
  indexedAt: number | null;
  // TODO source
}
interface IndexedError {
  type: 'error';
  error: SerializedError;
}

export type IndexedInstanceOrError = IndexedInstance | IndexedError;
export type IndexedModuleOrError = IndexedModule | IndexedError;

type GetEntryOptions = WIPOptions;
export type QueryOptions = WIPOptions;
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

  async getModule(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<IndexedModuleOrError | undefined> {
    let result = (await this.query([
      `SELECT i.* 
       FROM boxel_index as i
       INNER JOIN realm_versions r ON i.realm_url = r.realm_url
       WHERE`,
      ...every([
        any([
          [`i.url =`, param(url.href)],
          [`i.file_alias =`, param(url.href)],
        ]),
        realmVersionExpression(opts),
        any([
          ['i.type =', param('module')],
          ['i.type =', param('error')],
        ]),
      ]),
    ] as Expression)) as unknown as BoxelIndexTable[];
    let maybeResult: BoxelIndexTable | undefined = result[0];
    if (!maybeResult) {
      return undefined;
    }
    if (maybeResult.is_deleted) {
      return undefined;
    }

    if (maybeResult.error_doc) {
      return { type: 'error', error: maybeResult.error_doc };
    }
    let { transpiled_code: executableCode } = maybeResult;
    if (!executableCode) {
      throw new Error(
        `bug: index entry for ${url.href} with opts: ${JSON.stringify(
          opts,
        )} has neither an error_doc nor transpiled_code`,
      );
    }
    return { type: 'module', executableCode };
  }

  async getCard(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<IndexedInstanceOrError | undefined> {
    let href = assertURLEndsWithJSON(url).href;
    let result = (await this.query([
      `SELECT i.* 
       FROM boxel_index as i
       INNER JOIN realm_versions r ON i.realm_url = r.realm_url
       WHERE`,
      ...every([
        [`i.url =`, param(href)],
        realmVersionExpression(opts),
        any([
          ['i.type =', param('instance')],
          ['i.type =', param('error')],
        ]),
      ]),
    ] as Expression)) as unknown as BoxelIndexTable[];
    let maybeResult: BoxelIndexTable | undefined = result[0];
    if (!maybeResult) {
      return undefined;
    }
    if (maybeResult.is_deleted) {
      return undefined;
    }

    if (maybeResult.error_doc) {
      return { type: 'error', error: maybeResult.error_doc };
    }
    let {
      pristine_doc: instance,
      isolated_html: isolatedHtml,
      search_doc: searchDoc,
      realm_version: realmVersion,
      realm_url: realmURL,
      indexed_at: indexedAt,
      types,
      deps,
    } = maybeResult;
    if (!instance) {
      throw new Error(
        `bug: index entry for ${href} with opts: ${JSON.stringify(
          opts,
        )} has neither an error_doc nor a pristine_doc`,
      );
    }
    return {
      type: 'instance',
      realmURL,
      instance,
      isolatedHtml,
      searchDoc,
      types,
      indexedAt,
      deps,
      realmVersion,
    };
  }

  async createBatch(realmURL: URL) {
    let batch = new Batch(this, realmURL);
    await batch.ready;
    return batch;
  }

  async itemsThatReference(
    alias: string,
    realmVersion: number,
  ): Promise<
    { url: string; alias: string; type: 'instance' | 'module' | 'error' }[]
  > {
    const pageSize = 1000;
    let results: Pick<BoxelIndexTable, 'url' | 'file_alias' | 'type'>[] = [];
    let rows: Pick<BoxelIndexTable, 'url' | 'file_alias' | 'type'>[] = [];
    let pageNumber = 0;
    do {
      // SQLite does not support cursors when used in the worker thread since
      // the API for using cursors cannot be serialized over the postMessage
      // boundary. so we use a handcrafted paging approach that leverages
      // realm_version to keep the result set stable across pages
      rows = (await this.query([
        'SELECT i.url, i.file_alias, i.type',
        'FROM boxel_index as i',
        'CROSS JOIN LATERAL jsonb_array_elements_text(i.deps) as deps_array_element',
        'INNER JOIN realm_versions r ON i.realm_url = r.realm_url',
        'WHERE',
        ...every([
          [`deps_array_element =`, param(alias)],
          realmVersionExpression({ withMaxVersion: realmVersion }),
        ]),
        'ORDER BY i.url COLLATE "POSIX"',
        `LIMIT ${pageSize} OFFSET ${pageNumber * pageSize}`,
      ] as Expression)) as Pick<
        BoxelIndexTable,
        'url' | 'file_alias' | 'type'
      >[];
      results = [...results, ...rows];
      pageNumber++;
    } while (rows.length === pageSize);
    return results.map(({ url, file_alias, type }) => ({
      url,
      alias: file_alias,
      type,
    }));
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
  ): Promise<{ cards: CardResource[]; meta: QueryResultsMeta }> {
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
      ['i.type =', param('instance')],
      ['is_deleted = FALSE OR is_deleted IS NULL'],
      // our tests assert that the index card should not come back in the search results, so:
      ['url !=', param(new RealmPaths(realmURL).fileURL('index.json').href)],
      realmVersionExpression({ withMaxVersion: version }),
    ];
    if (filter) {
      conditions.push(this.filterCondition(filter, baseCardRef));
    }

    let everyCondition = every(conditions);
    let query = [
      `SELECT url, ANY_VALUE(pristine_doc) AS pristine_doc, ANY_VALUE(error_doc) AS error_doc`,
      `FROM boxel_index AS i ${tableValuedFunctionsPlaceholder}`,
      `INNER JOIN realm_versions r ON i.realm_url = r.realm_url`,
      'WHERE',
      ...everyCondition,
      'GROUP BY url',
      ...this.orderExpression(sort),
      ...(page ? [`LIMIT ${page.size} OFFSET ${page.number * page.size}`] : []),
    ];
    let queryCount = [
      'SELECT COUNT(DISTINCT url) AS total',
      `FROM boxel_index AS i ${tableValuedFunctionsPlaceholder}`,
      `INNER JOIN realm_versions r ON i.realm_url = r.realm_url`,
      'WHERE',
      ...everyCondition,
    ];

    let [totalResults, results] = await Promise.all([
      this.queryCards(queryCount, loader) as Promise<{ total: number }[]>,
      this.queryCards(query, loader) as Promise<
        Pick<BoxelIndexTable, 'pristine_doc' | 'url' | 'error_doc'>[]
      >,
    ]);

    let cards = results
      .map((r) => r.pristine_doc)
      .filter(Boolean) as CardResource[];
    let meta: QueryResultsMeta = {
      // postgres returns the `COUNT()` aggregate function as a string
      page: { total: Number(totalResults[0].total), realmVersion: version },
    };
    return { cards, meta };
  }

  private orderExpression(sort: Sort | undefined): CardExpression {
    if (!sort) {
      return ['ORDER BY url COLLATE "POSIX"'];
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
          'NULLS LAST',
        ]),
        // we include 'url' as the final sort key for deterministic results
        ['url COLLATE "POSIX"'],
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
      return every([
        ...(filter.on ? [this.typeCondition(filter.on)] : []),
        ...filter.every.map((i) => this.filterCondition(i, filter.on ?? on)),
      ]);
    } else if ('any' in filter) {
      return every([
        ...(filter.on ? [this.typeCondition(filter.on)] : []),
        any([
          ...filter.any.map((i) => this.filterCondition(i, filter.on ?? on)),
        ]),
      ]);
    } else {
      assertNever(filter);
    }
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
      ...(filter.on ? [this.typeCondition(filter.on)] : []),
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
      ...(filter.on ? [this.typeCondition(filter.on)] : []),
      ...Object.entries(filter.contains).map(([key, value]) => {
        return this.fieldLikeFilter(key, value, on);
      }),
    ]);
  }

  private notCondition(filter: NotFilter, on: CodeRef): CardExpression {
    on = filter.on ?? on;
    return every([
      ...(filter.on ? [this.typeCondition(filter.on)] : []),
      ['NOT', ...addExplicitParens(this.filterCondition(filter.not, on))],
    ]);
  }

  private rangeCondition(filter: RangeFilter, on: CodeRef): CardExpression {
    on = filter.on ?? on;
    return every([
      ...(filter.on ? [this.typeCondition(filter.on)] : []),
      ...Object.entries(filter.range).map(([key, filterValue]) => {
        return this.fieldRangeFilter(key, filterValue as RangeFilterValue, on);
      }),
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

  private fieldRangeFilter(
    key: string,
    filterValue: RangeFilterValue,
    onRef: CodeRef,
  ): CardExpression {
    let query = fieldQuery(key, onRef, false, 'filter');
    let cardExpressions: CardExpression[] = [];
    Object.entries(filterValue).forEach(([operator, value]) => {
      if (value == null) {
        throw new Error(`'null' is not a permitted value in a 'range' filter`);
      }
      let v = fieldValue(key, [param(value)], onRef, 'filter');
      cardExpressions.push([
        fieldArity({
          type: onRef,
          path: key,
          value: [query, RANGE_OPERATORS[operator as RangeOperator], v],
          errorHint: 'filter',
        }),
      ]);
    });

    return every(cardExpressions);
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
  //   SELECT url, pristine_doc
  //   FROM
  //     boxel_index,
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
  //   GROUP BY url
  //   ORDER BY url

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
                  path,
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
              path,
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
              tableValuedTree('search_doc', rootPluralPath, path, 'text_value'),
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
    let field: Field;
    if (currentSegment === '_cardType') {
      // this is a little awkward--we have the need to treat '_cardType' as a
      // type of string field that we can query against from the index (e.g. the
      // cards grid sorts by the card's display name). current-run is injecting
      // this into the searchDoc during index time.
      field = {
        card: (
          await loader.import<{ default: typeof CardAPI.FieldDef }>(
            'https://cardstack.com/base/string',
          )
        ).default,
        fieldType: 'contains',
      } as unknown as Field; // just pretend this is an actual field
    } else {
      let fields = api.getFields(cardOrField, { includeComputeds: true });
      field = fields[currentSegment];
      if (!field) {
        throw new Error(
          `Your filter refers to nonexistent field "${currentSegment}" on type ${JSON.stringify(
            identifyCard(cardOrField),
          )}`,
        );
      }
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

export type IndexEntry = InstanceEntry | ModuleEntry | ErrorEntry;

// TODO why is this type so special?
export type InstanceEntryWithErrors = InstanceEntry | ErrorEntry;

export interface InstanceEntry {
  type: 'instance';
  instance: {
    resource: CardResource;
    searchData: Record<string, any>;
    isolatedHtml?: string;
    types: string[];
    deps: Set<string>;
  };
}

interface ErrorEntry {
  type: 'error';
  error: SerializedError;
}
interface ModuleEntry {
  type: 'module';
  module: {
    deps: Set<string>;
    source: string;
  };
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

  async updateEntry(url: URL, entry: IndexEntry): Promise<void> {
    if (!new RealmPaths(this.realmURL).inRealm(url)) {
      // TODO this is a workaround for CS-6886. after we have solved that issue we can
      // drop this band-aid
      return;
    }
    let href = url.href;
    this.touched.add(href);
    let { nameExpressions, valueExpressions } = asExpressions(
      {
        url: href,
        file_alias: trimExecutableExtension(url).href,
        realm_version: this.realmVersion,
        realm_url: this.realmURL.href,
        is_deleted: false,
        indexed_at: Date.now(),
        ...(entry.type === 'instance'
          ? {
              // TODO in followup PR we need to alter the SearchEntry type to use
              // a document instead of a resource
              type: 'instance',
              pristine_doc: entry.instance.resource,
              search_doc: entry.instance.searchData,
              isolated_html: entry.instance.isolatedHtml,
              deps: [...entry.instance.deps],
              types: entry.instance.types,
            }
          : entry.type === 'module'
          ? {
              type: 'module',
              deps: [...entry.module.deps],
              source: entry.module.source,
              transpiled_code: transpileJS(
                entry.module.source,
                new RealmPaths(this.realmURL).local(url),
              ),
            }
          : {
              type: 'error',
              error_doc: entry.error,
              deps: entry.error.deps,
            }),
      } as BoxelIndexTable,
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
        'boxel_index',
        'boxel_index_pkey',
        nameExpressions,
        valueExpressions,
      ),
    ]);
  }

  async makeNewGeneration() {
    await this.setNextGenerationRealmVersion();
    this.isNewGeneration = true;
    let cols = [
      'url',
      'file_alias',
      'type',
      'realm_url',
      'realm_version',
      'is_deleted',
    ].map((c) => [c]);
    await this.detectUniqueConstraintError(
      () =>
        // create tombstones for all card URLs
        this.client.query([
          `INSERT INTO boxel_index`,
          ...addExplicitParens(separatedByCommas(cols)),
          `SELECT i.url, i.file_alias, i.type, i.realm_url, ${this.realmVersion} as realm_version, true as is_deleted`,
          'FROM boxel_index as i',
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
        `DELETE FROM boxel_index`,
        'WHERE',
        ...every([
          ['realm_version <', param(this.realmVersion)],
          ['realm_url =', param(this.realmURL.href)],
        ]),
      ] as Expression);
    }
  }

  private async setNextRealmVersion() {
    let [row] = (await this.client.query([
      'SELECT current_version FROM realm_versions WHERE realm_url =',
      param(this.realmURL.href),
    ])) as Pick<RealmVersionsTable, 'current_version'>[];
    if (!row) {
      let { nameExpressions, valueExpressions } = asExpressions({
        realm_url: this.realmURL.href,
        current_version: 0,
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
      this.realmVersion = 1;
    } else {
      this.realmVersion = row.current_version + 1;
    }
  }

  // this will use a version higher than any in-progress indexing in case there
  // are artifacts left over from a failed index
  private async setNextGenerationRealmVersion() {
    let [maxVersionRow] = (await this.client.query([
      'SELECT MAX(realm_version) as max_version FROM boxel_index WHERE realm_url =',
      param(this.realmURL.href),
    ])) as { max_version: number }[];
    let maxVersion = (maxVersionRow?.max_version ?? 0) + 1;
    let nextVersion = Math.max(this.realmVersion, maxVersion);
    this.realmVersion = nextVersion;
  }

  async invalidate(url: URL): Promise<string[]> {
    await this.ready;
    let alias = trimExecutableExtension(url).href;
    let invalidations = [
      ...new Set([
        url.href,
        ...(alias ? await this.calculateInvalidations(alias) : []),
      ]),
    ];

    // insert tombstone into next version of the realm index
    let columns = [
      'url',
      'file_alias',
      'type',
      'realm_version',
      'realm_url',
      'is_deleted',
    ].map((c) => [c]);
    let rows = invalidations.map((id) =>
      [
        id,
        trimExecutableExtension(new URL(id)).href,
        hasExecutableExtension(id) ? 'module' : 'instance',
        this.realmVersion,
        this.realmURL.href,
        true,
      ].map((v) => [param(v)]),
    );

    await this.detectUniqueConstraintError(
      () =>
        this.client.query([
          `INSERT INTO boxel_index`,
          ...addExplicitParens(separatedByCommas(columns)),
          'VALUES',
          ...separatedByCommas(
            rows.map((value) => addExplicitParens(separatedByCommas(value))),
          ),
        ] as Expression),
      { url, invalidations },
    );

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
          message =
            `${message}: the invalidation ${
              opts.url.href
            } resulted in invalidation graph: ${JSON.stringify(
              opts.invalidations,
            )} that collides with unfinished indexing. The most likely reason this happens is that there ` +
            `was an error encountered during incremental indexing that prevented the indexing from completing ` +
            `(and realm version increasing), then there was another incremental update to the same document ` +
            `that collided with the WIP artifacts from the indexing that never completed. Removing the WIP ` +
            `indexing artifacts (the rows(s) that triggered the unique constraint will solve the immediate ` +
            `problem, but likely the issue that triggered the unfinished indexing will need to be fixed to ` +
            `prevent this from happening in the future.`;
        } else if (opts?.isMakingNewGeneration) {
          message =
            `${message}. created a new generation while there was still unfinished indexing. ` +
            `The most likely reason this happens is that there was an error encountered during incremental ` +
            `indexing that prevented the indexing from completing (and realm version increasing), ` +
            `then the realm was restarted and the left over WIP indexing artifact(s) collided with the ` +
            `from-scratch indexing. To resolve this issue delete the WIP indexing artifacts (the row(s) ` +
            `that triggered the unique constraint) and restart the realm.`;
        }
        throw new Error(message);
      }
      throw e;
    }
  }

  private async calculateInvalidations(
    alias: string,
    visited: string[] = [],
  ): Promise<string[]> {
    if (visited.includes(alias)) {
      return [];
    }
    let childInvalidations = await this.client.itemsThatReference(
      alias,
      this.realmVersion,
    );
    let invalidations = childInvalidations.map(({ url }) => url);
    let aliases = childInvalidations.map(({ alias: _alias }) => _alias);
    let results = [
      ...invalidations,
      ...flatten(
        await Promise.all(
          aliases.map((a) =>
            this.calculateInvalidations(a, [...visited, alias]),
          ),
        ),
      ),
    ];
    return [...new Set(results)];
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
      'FROM boxel_index i2',
      'WHERE i2.url = i.url',
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

function assertURLEndsWithJSON(url: URL): URL {
  if (!url.href.endsWith('.json')) {
    return new URL(`${url}.json`);
  }
  return url;
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
