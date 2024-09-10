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
  ResolvedCodeRef,
} from './index';
import {
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
  any,
  every,
  fieldQuery,
  fieldValue,
  fieldArity,
  tableValuedFunctionsPlaceholder,
  query,
  realmVersionExpression,
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
import {
  coerceTypes,
  RealmMetaTable,
  type BoxelIndexTable,
  type CardTypeSummary,
  type RealmVersionsTable,
} from './index-structure';

interface IndexedModule {
  type: 'module';
  executableCode: string;
  source: string;
  canonicalURL: string;
  lastModified: number;
  deps: string[] | null;
}

export interface IndexedInstance {
  type: 'instance';
  instance: CardResource;
  source: string;
  canonicalURL: string;
  lastModified: number;
  isolatedHtml: string | null;
  embeddedHtml: { [refURL: string]: string } | null;
  fittedHtml: { [refURL: string]: string } | null;
  atomHtml: string | null;
  searchDoc: Record<string, any> | null;
  types: string[] | null;
  deps: string[] | null;
  realmVersion: number;
  realmURL: string;
  indexedAt: number | null;
}
interface IndexedError {
  type: 'error';
  error: SerializedError;
}

export type IndexedInstanceOrError = IndexedInstance | IndexedError;
export type IndexedModuleOrError = IndexedModule | IndexedError;

type GetEntryOptions = WIPOptions;
export type QueryOptions = WIPOptions & PrerenderedCardOptions;

interface PrerenderedCardOptions {
  htmlFormat?: 'embedded' | 'fitted' | 'atom';
  cardUrls?: string[];
}

interface WIPOptions {
  useWorkInProgressIndex?: boolean;
}

export interface PrerenderedCard {
  url: string;
  html: string;
}

export interface QueryResultsMeta {
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

// A mapper for fields that can be sorted on but are not an attribute of a card
export const generalSortFields: Record<string, string> = {
  lastModified: 'last_modified',
};

export function isValidPrerenderedHtmlFormat(
  format: string | undefined,
): format is PrerenderedCardOptions['htmlFormat'] {
  return (
    format !== undefined && ['embedded', 'fitted', 'atom'].includes(format)
  );
}

export class IndexQueryEngine {
  constructor(private dbAdapter: DBAdapter) {}

  private async query(expression: Expression) {
    return await query(this.dbAdapter, expression, coerceTypes);
  }

  private async queryCards(query: CardExpression, loader: Loader) {
    return this.query(await this.makeExpression(query, loader));
  }

  async getModule(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<IndexedModuleOrError | undefined> {
    let rows = (await this.query([
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
    let maybeResult: BoxelIndexTable | undefined = rows[0];
    if (!maybeResult) {
      return undefined;
    }
    if (maybeResult.is_deleted) {
      return undefined;
    }
    let result = maybeResult;
    if (result.type === 'error') {
      return { type: 'error', error: result.error_doc! };
    }
    let moduleEntry = assertIndexEntrySource(result);
    let {
      transpiled_code: executableCode,
      source,
      url: canonicalURL,
      last_modified: lastModified,
    } = moduleEntry;
    if (!executableCode) {
      throw new Error(
        `bug: index entry for ${url.href} with opts: ${JSON.stringify(
          opts,
        )} has neither an error_doc nor transpiled_code`,
      );
    }
    return {
      type: 'module',
      canonicalURL,
      executableCode,
      source,
      lastModified: parseInt(lastModified),
      deps: moduleEntry.deps,
    };
  }

  async getInstance(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<IndexedInstanceOrError | undefined> {
    let result = (await this.query([
      `SELECT i.*, embedded_html, fitted_html`,
      `FROM boxel_index as i
       INNER JOIN realm_versions r ON i.realm_url = r.realm_url
       WHERE`,
      ...every([
        any([
          [`i.url =`, param(url.href)],
          [`i.file_alias =`, param(url.href)],
        ]),
        realmVersionExpression(opts),
        any([
          ['i.type =', param('instance')],
          ['i.type =', param('error')],
        ]),
      ]),
    ] as Expression)) as unknown as (BoxelIndexTable & {
      default_embedded_html: string | null;
    })[];
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
    let instanceEntry = assertIndexEntrySource(maybeResult);
    let {
      url: canonicalURL,
      pristine_doc: instance,
      isolated_html: isolatedHtml,
      atom_html: atomHtml,
      embedded_html: embeddedHtml,
      fitted_html: fittedHtml,
      search_doc: searchDoc,
      realm_version: realmVersion,
      realm_url: realmURL,
      indexed_at: indexedAt,
      last_modified: lastModified,
      source,
      types,
      deps,
    } = instanceEntry;
    if (!instance) {
      throw new Error(
        `bug: index entry for ${url.href} with opts: ${JSON.stringify(
          opts,
        )} has neither an error_doc nor a pristine_doc`,
      );
    }
    return {
      type: 'instance',
      canonicalURL,
      realmURL,
      instance,
      isolatedHtml,
      embeddedHtml,
      fittedHtml,
      atomHtml,
      searchDoc,
      types,
      indexedAt: indexedAt != null ? parseInt(indexedAt) : null,
      source,
      deps,
      lastModified: parseInt(lastModified),
      realmVersion,
    };
  }

  // we pass the loader in so there is no ambiguity which loader to use as this
  // client may be serving a live index or a WIP index that is being built up
  // which could have conflicting loaders. It is up to the caller to provide the
  // loader that we should be using.
  private async _search(
    realmURL: URL,
    { filter, sort, page }: Query,
    loader: Loader,
    opts: QueryOptions,
    selectClauseExpression: CardExpression,
  ): Promise<{
    meta: QueryResultsMeta;
    results: Partial<BoxelIndexTable>[];
  }> {
    let version: number;
    if (page?.realmVersion) {
      version = page.realmVersion;
    } else {
      let currentRealmVersion = await this.fetchCurrentRealmVersion(realmURL);
      version = opts?.useWorkInProgressIndex
        ? currentRealmVersion + 1
        : currentRealmVersion;
    }
    let conditions: CardExpression[] = [
      ['i.realm_url = ', param(realmURL.href)],
      ['i.type =', param('instance')],
      ['is_deleted = FALSE OR is_deleted IS NULL'],
      realmVersionExpression({ withMaxVersion: version }),
    ];

    if (opts.cardUrls && opts.cardUrls.length > 0) {
      conditions.push([
        'i.url IN',
        ...addExplicitParens(
          separatedByCommas(opts.cardUrls.map((url) => [param(url)])),
        ),
      ]);
    }

    if (filter) {
      conditions.push(this.filterCondition(filter, baseCardRef));
    }

    let everyCondition = every(conditions);
    let query = [
      ...selectClauseExpression,
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

    let [results, totalResults] = await Promise.all([
      this.queryCards(query, loader),
      this.queryCards(queryCount, loader),
    ]);

    return {
      results,
      meta: {
        page: { total: Number(totalResults[0].total), realmVersion: version },
      },
    };
  }

  async search(
    realmURL: URL,
    { filter, sort, page }: Query,
    loader: Loader,
    opts: QueryOptions = {},
    // TODO this should be returning a CardCollectionDocument--handle that in
    // subsequent PR where we start storing card documents in "pristine_doc"
  ): Promise<{ cards: CardResource[]; meta: QueryResultsMeta }> {
    let { results, meta } = await this._search(
      realmURL,
      { filter, sort, page },
      loader,
      opts,
      [
        'SELECT url, ANY_VALUE(pristine_doc) AS pristine_doc, ANY_VALUE(error_doc) AS error_doc',
      ],
    );

    let cards = results
      .map((r) => r.pristine_doc)
      .filter(Boolean) as CardResource[];

    return { cards, meta };
  }

  private generalFieldSortColumn(field: string) {
    let mappedField = generalSortFields[field];
    if (mappedField) {
      return mappedField;
    } else {
      throw new Error(`Unknown sort field: ${field}`);
    }
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
          'on' in s
            ? fieldQuery(s.by, s.on, false, 'sort')
            : this.generalFieldSortColumn(s.by),
          ')',
          s.direction ?? 'asc',
          'NULLS LAST',
        ]),
        // we include 'url' as the final sort key for deterministic results
        ['url COLLATE "POSIX"'],
      ]),
    ];
  }

  async searchPrerendered(
    realmURL: URL,
    { filter, sort, page }: Query,
    loader: Loader,
    opts: QueryOptions = {},
  ): Promise<{
    prerenderedCards: PrerenderedCard[];
    scopedCssUrls: string[];
    meta: QueryResultsMeta;
  }> {
    if (!isValidPrerenderedHtmlFormat(opts.htmlFormat)) {
      throw new Error(
        `htmlFormat must be either 'embedded', 'fitted', or 'atom'`,
      );
    }

    let ref: ResolvedCodeRef;
    let filterOnValue = filter && 'type' in filter ? filter.type : filter?.on;
    if (filterOnValue) {
      ref = filterOnValue as ResolvedCodeRef;
    } else {
      ref = baseCardRef;
    }

    let htmlColumnExpression;
    switch (opts.htmlFormat) {
      case 'embedded':
        htmlColumnExpression = [
          'embedded_html ->> ',
          param(internalKeyFor(ref, undefined)),
        ];
        break;
      case 'fitted':
        htmlColumnExpression = [
          'fitted_html ->> ',
          param(internalKeyFor(ref, undefined)),
        ];
        break;
      case 'atom':
      default:
        htmlColumnExpression = ['atom_html'];
        break;
    }

    let { results, meta } = (await this._search(
      realmURL,
      { filter, sort, page },
      loader,
      opts,
      [
        'SELECT url, ANY_VALUE(file_alias) as file_alias, ANY_VALUE(',
        ...htmlColumnExpression,
        ') as html, ANY_VALUE(deps) as deps',
      ],
    )) as {
      meta: QueryResultsMeta;
      results: (Partial<BoxelIndexTable> & { html: string })[];
    };

    // We need a way to get scoped css urls even from cards linked from foreign realms.These are saved in the deps column of instances and modules.
    // It would be more efficient to return scoped css urls found only in deps of the module we are filtering on (i.e. `ref`),
    // but in case the module is from a foreign realm, this module will not be indexed in this realm's index.
    // That's why we gather all scoped css urls from all instances in the search results and include them in the result.

    let scopedCssUrls = new Set<string>(); // Use a set for deduplication

    let prerenderedCards = results.map((card) => {
      card.deps!.forEach((dep: string) => {
        if (dep.endsWith('glimmer-scoped.css')) {
          scopedCssUrls.add(dep);
        }
      });

      return {
        url: card.url!,
        html: card.html,
      };
    });

    return { prerenderedCards, scopedCssUrls: [...scopedCssUrls], meta };
  }

  async fetchCardTypeSummary(realmURL: URL): Promise<CardTypeSummary[]> {
    let results = (await this.query([
      `SELECT value
       FROM realm_meta rm
       INNER JOIN realm_versions rv
       ON rm.realm_url = rv.realm_url AND rm.realm_version = rv.current_version
       WHERE`,
      ...every([['rm.realm_url =', param(realmURL.href)]]),
    ] as Expression)) as Pick<RealmMetaTable, 'value'>[];

    return (results[0]?.value ?? []) as unknown as CardTypeSummary[];
  }

  private async fetchCurrentRealmVersion(realmURL: URL) {
    let [{ current_version }] = (await this.query([
      'SELECT current_version FROM realm_versions WHERE realm_url =',
      param(realmURL.href),
    ])) as Pick<RealmVersionsTable, 'current_version'>[];
    if (current_version == null) {
      throw new Error(`No current version found for realm ${realmURL.href}`);
    }
    return current_version;
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
        value: [query, 'ILIKE', v],
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

function assertIndexEntrySource<T>(obj: T): Omit<
  T,
  'source' | 'last_modified'
> & {
  source: string;
  last_modified: string;
} {
  if (!obj || typeof obj !== 'object') {
    throw new Error(`expected index entry is null or not an object`);
  }
  if (!('source' in obj) || typeof obj.source !== 'string') {
    throw new Error(`expected index entry to have "source" string property`);
  }
  if (!('last_modified' in obj) || typeof obj.last_modified !== 'string') {
    throw new Error(`expected index entry to have "last_modified" property`);
  }
  return obj as Omit<T, 'source' | 'last_modified'> & {
    source: string;
    last_modified: string;
  };
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
