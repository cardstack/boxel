import type * as JSONTypes from 'json-typescript';
import { flatten } from 'lodash-es';
import stringify from 'safe-stable-stringify';
import {
  type CardResource,
  type CodeRef,
  baseCardRef,
  internalKeysFor,
  isResolvedCodeRef,
  baseRealmRRI,
  getSerializer,
} from './index.ts';
import { isValidPrerenderedHtmlFormat } from './prerendered-html-format.ts';
import {
  type Expression,
  type CardExpression,
  type FieldQuery,
  type FieldValue,
  type FieldArity,
  type JsonContainsQuery,
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
  jsonContainsQuery,
  tableValuedFunctionsPlaceholder,
  query,
  dbExpression,
  isDbExpression,
} from './expression.ts';
import type { RangeOperator, RangeFilterValue } from './query.ts';
import {
  type Query,
  type Filter,
  type EqFilter,
  type InFilter,
  type NotFilter,
  type ContainsFilter,
  type MatchesFilter,
  type Sort,
  type RangeFilter,
  RANGE_OPERATORS,
  isCardTypeFilter,
} from './query.ts';
import type { SerializedError } from './error.ts';
import type { DBAdapter } from './db.ts';
import {
  coerceTypes,
  normalizeRealmMetaValue,
  type BoxelIndexTable,
  type RealmMetaValue,
} from './index-structure.ts';
import {
  getFieldDef,
  getImmediateFieldDef,
  type Definition,
  type FieldDefinition,
} from './definitions.ts';
import { matchSearchableRoutes, routesForField } from './searchable-routes.ts';
import {
  isFilterRefersToNonexistentTypeError,
  type DefinitionLookup,
} from './definition-lookup.ts';
import type { FileMetaResource } from './resource-types.ts';
import type { VirtualNetwork } from './virtual-network.ts';
import type { RequestTimings } from './request-timings.ts';

// A filter path resolves in the schema but crosses a `linksTo`/`linksToMany`
// hop whose target is not in the search doc, so the query would silently match
// nothing. Raised by the query compiler (see `assertFilterPathSearchable`) and
// kept distinct from the "nonexistent field" error so a forgotten `searchable`
// annotation surfaces at the point of use as an actionable message rather than
// as mysteriously-empty results. `reason` distinguishes a link that simply was
// never made searchable (fixable by annotating it) from a query-backed
// relationship, which is never in the doc at all and cannot be filtered
// through.
export class FilterRefersToNonsearchableFieldError extends Error {
  type: CodeRef;
  // The full filter path as written (e.g. `bestFriend.friends.name`).
  path: string;
  // The dotted path to the offending relationship hop (e.g. `bestFriend.friends`).
  relationshipPath: string;
  reason: 'not-searchable' | 'query-backed';

  constructor(opts: {
    type: CodeRef;
    path: string;
    relationshipPath: string;
    reason: 'not-searchable' | 'query-backed';
  }) {
    super(buildNonsearchableFieldMessage(opts));
    this.name = 'FilterRefersToNonsearchableFieldError';
    this.type = opts.type;
    this.path = opts.path;
    this.relationshipPath = opts.relationshipPath;
    this.reason = opts.reason;
    // make sure instances of this Error subclass behave like instances of the subclass should
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isFilterRefersToNonsearchableFieldError(
  error: unknown,
): error is FilterRefersToNonsearchableFieldError {
  return error instanceof FilterRefersToNonsearchableFieldError;
}

function buildNonsearchableFieldMessage(opts: {
  type: CodeRef;
  path: string;
  relationshipPath: string;
  reason: 'not-searchable' | 'query-backed';
}): string {
  let { type, path, relationshipPath, reason } = opts;
  if (reason === 'query-backed') {
    return (
      `Your filter on ${stringify(type)} refers to "${path}", but the ` +
      `"${relationshipPath}" relationship is query-backed and is never ` +
      `included in the search doc (query-backed relationships can't be kept ` +
      `current as matching cards change), so it cannot be filtered through.`
    );
  }
  // `searchable` routes are seeded from the queried card's own fields, so the
  // fix is always to extend the head field's annotation. For a single-hop path
  // the head field IS the relationship (annotate it `searchable: true`); for a
  // deeper hop the head field's annotation gains the remaining route.
  let [headField, ...rest] = relationshipPath.split('.');
  let hint =
    rest.length === 0 ? `searchable: true` : `searchable: '${rest.join('.')}'`;
  return (
    `Your filter on ${stringify(type)} refers to "${path}", but the ` +
    `"${relationshipPath}" relationship is not searchable, so its target is ` +
    `not in the search doc and the filter would silently match nothing. To ` +
    `query through it, make it searchable: add \`${hint}\` to the ` +
    `"${headField}" field (combine multiple routes in an array if it already ` +
    `has a searchable annotation).`
  );
}

export interface IndexedFile {
  type: 'file';
  canonicalURL: string;
  lastModified: number | null;
  resourceCreatedAt: number | null;
  searchDoc: Record<string, any> | null;
  resource: FileMetaResource | null;
  types: string[] | null;
  displayNames: string[] | null;
  deps: string[] | null;
  isolatedHtml: string | null;
  headHtml: string | null;
  embeddedHtml: { [refURL: string]: string } | null;
  fittedHtml: { [refURL: string]: string } | null;
  atomHtml: string | null;
  iconHtml: string | null;
  markdown: string | null;
  realmVersion: number;
  realmURL: string;
  indexedAt: number | null;
}

export interface IndexedInstance {
  type: 'instance';
  instance: CardResource;
  canonicalURL: string;
  lastModified: number | null;
  resourceCreatedAt: number;
  isolatedHtml: string | null;
  headHtml: string | null;
  embeddedHtml: { [refURL: string]: string } | null;
  fittedHtml: { [refURL: string]: string } | null;
  atomHtml: string | null;
  markdown: string | null;
  searchDoc: Record<string, any> | null;
  types: string[] | null;
  deps: string[] | null;
  realmVersion: number;
  realmURL: string;
  indexedAt: number | null;
}

interface InstanceError extends Partial<
  Omit<
    IndexedInstance,
    | 'type'
    | 'realmVersion'
    | 'realmURL'
    | 'instance'
    | 'lastModified'
    | 'resourceCreatedAt'
  >
> {
  type: 'instance-error';
  error: SerializedError;
  realmVersion: number;
  realmURL: string;
  instance: CardResource | null;
  lastModified: number | null;
  resourceCreatedAt: number | null;
}

export type InstanceOrError = IndexedInstance | InstanceError;

type GetEntryOptions = WIPOptions;
export type QueryOptions = WIPOptions & {
  includeErrors?: true;
  // Restrict the result set to this subset of card URLs (SQL `i.url IN (...)`).
  cardUrls?: string[];
  timings?: RequestTimings;
};

// Selects which columns `search()` projects. `dataOnly` projects
// the live serialization only (pristine_doc / error_doc); `renderSet` projects
// each row's full rendering set (every per-format HTML column, JSONB maps
// whole) plus the live serialization on every row — the caller selects
// renderings from the set (the htmlQuery evaluation).
export type SearchProjection = { kind: 'dataOnly' } | { kind: 'renderSet' };

export interface WIPOptions {
  useWorkInProgressIndex?: boolean;
}

export interface QueryResultsMeta {
  // TODO SQLite doesn't let us use cursors in the classic sense so we need to
  // keep track of page size and index number
  page: {
    total: number;
  };
}

// A mapper for fields that can be sorted on but are not an attribute of a card
export const generalSortFields: Record<string, string> = {
  lastModified: 'last_modified',
  createdAt: 'resource_created_at',
  cardURL: 'url COLLATE "POSIX"',
};

export { isValidPrerenderedHtmlFormat };

// Whether a predicate sits under an even (`positive`) or odd (`negated`) number
// of enclosing `not` filters. The `@>` containment rewrite is only equivalent
// to `->>` extraction at positive polarity: on an absent path `->>` yields SQL
// NULL while `@>` yields FALSE, and `NOT NULL` vs `NOT FALSE` diverge.
type FilterPolarity = 'positive' | 'negated';

function flipPolarity(polarity: FilterPolarity): FilterPolarity {
  return polarity === 'positive' ? 'negated' : 'positive';
}

export class IndexQueryEngine {
  #dbAdapter: DBAdapter;
  #definitionLookup: DefinitionLookup;
  #virtualNetwork: VirtualNetwork;

  constructor(
    dbAdapter: DBAdapter,
    definitionLookup: DefinitionLookup,
    virtualNetwork: VirtualNetwork,
  ) {
    this.#dbAdapter = dbAdapter;
    this.#definitionLookup = definitionLookup;
    this.#virtualNetwork = virtualNetwork;
  }

  async #query(expression: Expression) {
    return await query(this.#dbAdapter, expression, coerceTypes);
  }

  // Split the two phases so the search-timing line can attribute the SQL
  // stage. `makeExpression` resolves the filter tree to SQL — that resolution
  // runs a `getDefinition` card-definition lookup per type/field (a cache
  // read, or a module prerender on a miss), so it can dominate a search whose
  // actual row fetch is tiny. `#query` is the DB round-trip itself. The data
  // and count queries run concurrently, so these accumulate into the
  // parallel-sum `busy` bucket rather than the wall-clock stages.
  async #queryCards(query: CardExpression, timings?: RequestTimings) {
    let expression = timings
      ? await timings.busyTime('compile', () => this.makeExpression(query))
      : await this.makeExpression(query);
    return timings
      ? await timings.busyTime('sqlExec', () => this.#query(expression))
      : this.#query(expression);
  }

  async getInstance(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<InstanceOrError | undefined> {
    let result = (await this.#query([
      `SELECT i.*, embedded_html, fitted_html`,
      `FROM ${tableFromOpts(opts)} as i
       WHERE`,
      ...every([
        any([
          [`i.url =`, param(url.href)],
          [`i.file_alias =`, param(url.href)],
        ]),
        ['i.type =', param('instance')],
        any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
      ]),
    ] as Expression)) as unknown as BoxelIndexTable[];
    return this.#rowToInstanceOrError(result[0], url, opts);
  }

  // Batch variant of getInstance: one DB round-trip for many URLs.
  // Returns a map keyed by the LOOKUP URL (matching either i.url or i.file_alias)
  // so callers can address results by the URL they passed in.
  async getInstances(
    urls: URL[],
    opts?: GetEntryOptions,
  ): Promise<Map<string, InstanceOrError>> {
    let resultMap = new Map<string, InstanceOrError>();
    if (urls.length === 0) {
      return resultMap;
    }
    let lookupHrefs = [...new Set(urls.map((u) => u.href))];
    // Each chunk emits 2*N + 1 placeholders (url IN list + file_alias IN list
    // + i.type param). Cap at half the existing url-batch sizes used in
    // index-writer.ts (sqlite=900, pg=5000) so we stay well under both
    // adapter parameter limits.
    let chunkSize = this.#dbAdapter.kind === 'sqlite' ? 450 : 2500;
    for (let start = 0; start < lookupHrefs.length; start += chunkSize) {
      let chunk = lookupHrefs.slice(start, start + chunkSize);
      let chunkSet = new Set(chunk);
      let chunkParams = chunk.map((href) => [param(href)]);
      let rows = (await this.#query([
        `SELECT i.*, embedded_html, fitted_html`,
        `FROM ${tableFromOpts(opts)} as i
         WHERE`,
        ...every([
          any([
            ['i.url IN', ...addExplicitParens(separatedByCommas(chunkParams))],
            [
              'i.file_alias IN',
              ...addExplicitParens(separatedByCommas(chunkParams)),
            ],
          ]),
          ['i.type =', param('instance')],
          any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
        ]),
      ] as Expression)) as unknown as BoxelIndexTable[];
      for (let row of rows) {
        let mapped = this.#rowToInstanceOrError(row, undefined, opts);
        if (!mapped) {
          continue;
        }
        // A row may be addressable by its url or its file_alias.
        // Index the result under whichever lookup keys the caller asked about.
        if (row.url && chunkSet.has(row.url)) {
          resultMap.set(row.url, mapped);
        }
        if (row.file_alias && chunkSet.has(row.file_alias)) {
          resultMap.set(row.file_alias, mapped);
        }
      }
    }
    return resultMap;
  }

  // Shared row → InstanceOrError mapping for getInstance / getInstances.
  // `lookupURL` is used only for error context and is optional in the batch path.
  #rowToInstanceOrError(
    maybeResult: BoxelIndexTable | undefined,
    lookupURL: URL | undefined,
    opts?: GetEntryOptions,
  ): InstanceOrError | undefined {
    if (!maybeResult) {
      return undefined;
    }
    if (maybeResult.is_deleted) {
      return undefined;
    }
    let {
      url: canonicalURL,
      pristine_doc: instance,
      isolated_html: isolatedHtml,
      head_html: headHtml,
      atom_html: atomHtml,
      embedded_html: embeddedHtml,
      fitted_html: fittedHtml,
      markdown,
      search_doc: searchDoc,
      realm_version: realmVersion,
      realm_url: realmURL,
      indexed_at: indexedAt,
      last_modified: lastModified,
      resource_created_at: resourceCreatedAt,
      types,
      deps,
    } = maybeResult;
    let baseResult = {
      canonicalURL,
      realmURL,
      instance,
      isolatedHtml,
      headHtml,
      embeddedHtml,
      fittedHtml,
      atomHtml,
      markdown,
      searchDoc,
      types,
      indexedAt: indexedAt != null ? parseInt(indexedAt) : null,
      deps,
      lastModified: lastModified != null ? parseInt(lastModified) : null,
      resourceCreatedAt:
        resourceCreatedAt != null ? parseInt(resourceCreatedAt) : null,
      realmVersion,
    };

    if (maybeResult.has_error) {
      return {
        ...baseResult,
        type: 'instance-error',
        error: maybeResult.error_doc!,
      };
    }
    let instanceEntry = assertIndexEntry(maybeResult);
    if (!instance) {
      throw new Error(
        `bug: index entry for ${
          lookupURL?.href ?? canonicalURL
        } with opts: ${stringify(
          opts,
        )} has neither an error_doc nor a pristine_doc`,
      );
    }
    return {
      ...baseResult,
      type: 'instance',
      instance,
      lastModified:
        instanceEntry.last_modified != null
          ? parseInt(instanceEntry.last_modified)
          : null,
      resourceCreatedAt: parseInt(instanceEntry.resource_created_at),
    };
  }

  async getFile(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<IndexedFile | undefined> {
    let result = (await this.#query([
      `SELECT i.*`,
      `FROM ${tableFromOpts(opts)} as i
       WHERE`,
      ...every([
        any([
          [`i.url =`, param(url.href)],
          [`i.file_alias =`, param(url.href)],
        ]),
        ['i.type =', param('file')],
        any([['i.has_error = FALSE'], ['i.has_error IS NULL']]),
        any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
      ]),
    ] as Expression)) as unknown as BoxelIndexTable[];
    return this.#rowToIndexedFile(result[0]);
  }

  // Batch variant of getFile.
  // Keys are the LOOKUP URLs the caller passed in (matching either i.url or i.file_alias).
  async getFiles(
    urls: URL[],
    opts?: GetEntryOptions,
  ): Promise<Map<string, IndexedFile>> {
    let resultMap = new Map<string, IndexedFile>();
    if (urls.length === 0) {
      return resultMap;
    }
    let lookupHrefs = [...new Set(urls.map((u) => u.href))];
    // Same chunking discipline as getInstances — keeps placeholder count
    // safely below the sqlite/pg parameter limits.
    let chunkSize = this.#dbAdapter.kind === 'sqlite' ? 450 : 2500;
    for (let start = 0; start < lookupHrefs.length; start += chunkSize) {
      let chunk = lookupHrefs.slice(start, start + chunkSize);
      let chunkSet = new Set(chunk);
      let chunkParams = chunk.map((href) => [param(href)]);
      let rows = (await this.#query([
        `SELECT i.*`,
        `FROM ${tableFromOpts(opts)} as i
         WHERE`,
        ...every([
          any([
            ['i.url IN', ...addExplicitParens(separatedByCommas(chunkParams))],
            [
              'i.file_alias IN',
              ...addExplicitParens(separatedByCommas(chunkParams)),
            ],
          ]),
          ['i.type =', param('file')],
          any([['i.has_error = FALSE'], ['i.has_error IS NULL']]),
          any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
        ]),
      ] as Expression)) as unknown as BoxelIndexTable[];
      for (let row of rows) {
        let mapped = this.#rowToIndexedFile(row);
        if (!mapped) {
          continue;
        }
        if (row.url && chunkSet.has(row.url)) {
          resultMap.set(row.url, mapped);
        }
        if (row.file_alias && chunkSet.has(row.file_alias)) {
          resultMap.set(row.file_alias, mapped);
        }
      }
    }
    return resultMap;
  }

  #rowToIndexedFile(
    maybeResult: BoxelIndexTable | undefined,
  ): IndexedFile | undefined {
    if (!maybeResult) {
      return undefined;
    }
    if (maybeResult.is_deleted) {
      return undefined;
    }
    let {
      url: canonicalURL,
      pristine_doc: resource,
      search_doc: searchDoc,
      isolated_html: isolatedHtml,
      head_html: headHtml,
      embedded_html: embeddedHtml,
      fitted_html: fittedHtml,
      atom_html: atomHtml,
      icon_html: iconHtml,
      markdown,
      realm_version: realmVersion,
      realm_url: realmURL,
      indexed_at: indexedAt,
      last_modified: lastModified,
      resource_created_at: resourceCreatedAt,
      deps,
      types,
      display_names: displayNames,
    } = maybeResult;
    realmVersion =
      typeof realmVersion === 'string'
        ? parseInt(realmVersion)
        : (realmVersion ?? 0);
    return {
      type: 'file',
      canonicalURL,
      searchDoc,
      resource: (resource as FileMetaResource | null) ?? null,
      types,
      displayNames,
      deps,
      isolatedHtml,
      headHtml,
      embeddedHtml,
      fittedHtml,
      atomHtml,
      iconHtml: iconHtml ?? null,
      markdown,
      lastModified: lastModified != null ? parseInt(lastModified) : null,
      resourceCreatedAt:
        resourceCreatedAt != null ? parseInt(resourceCreatedAt) : null,
      realmVersion,
      realmURL,
      indexedAt: indexedAt != null ? parseInt(indexedAt) : null,
    };
  }

  async hasFileType(
    realmURL: URL,
    ref: CodeRef,
    opts?: GetEntryOptions,
  ): Promise<boolean> {
    if (!isResolvedCodeRef(ref)) {
      return false;
    }
    let typeKeys = internalKeysFor(ref, undefined, this.#virtualNetwork);
    let rows = (await this.#query([
      'SELECT 1',
      `FROM ${tableFromOpts(opts)} AS i ${tableValuedFunctionsPlaceholder}`,
      'WHERE',
      ...every([
        ['i.realm_url =', param(realmURL.href)],
        ['i.type =', param('file')],
        any(
          typeKeys.map((typeKey) => [
            tableValuedEach('types'),
            '=',
            param(typeKey),
          ]),
        ),
      ]),
      'LIMIT 1',
    ] as Expression)) as unknown as { 1: number }[];
    return rows.length > 0;
  }

  async hasInstanceType(
    realmURL: URL,
    ref: CodeRef,
    opts?: GetEntryOptions,
  ): Promise<boolean> {
    if (!isResolvedCodeRef(ref)) {
      return false;
    }
    let typeKeys = internalKeysFor(ref, undefined, this.#virtualNetwork);
    let rows = (await this.#query([
      'SELECT 1',
      `FROM ${tableFromOpts(opts)} AS i ${tableValuedFunctionsPlaceholder}`,
      'WHERE',
      ...every([
        ['i.realm_url =', param(realmURL.href)],
        ['i.type =', param('instance')],
        any(
          typeKeys.map((typeKey) => [
            tableValuedEach('types'),
            '=',
            param(typeKey),
          ]),
        ),
      ]),
      'LIMIT 1',
    ] as Expression)) as unknown as { 1: number }[];
    return rows.length > 0;
  }

  private async getDefinition(codeRef: CodeRef): Promise<Definition> {
    if (!isResolvedCodeRef(codeRef)) {
      throw new Error(
        `Your filter refers to a nonexistent type: ${stringify(codeRef)}`,
      );
    }
    return await this.#definitionLookup.lookupDefinition(codeRef);
  }

  // we pass the loader in so there is no ambiguity which loader to use as this
  // client may be serving a live index or a WIP index that is being built up
  // which could have conflicting loaders. It is up to the caller to provide the
  // loader that we should be using.
  private async _search(
    realmURL: URL,
    { filter, sort, page }: Query,
    opts: QueryOptions,
    selectClauseExpression: CardExpression,
    entryType: 'instance' | 'file' = 'instance',
    // When set, the grouped projection is wrapped in an outer select so a
    // conditional live `pristine_doc` can reference the computed `html` column
    // once (see `search()`'s render branch). The inner projection must alias
    // its raw live serialization as `pristine_doc_fallback` and its HTML as
    // `html`.
    conditionalLiveDoc = false,
  ): Promise<{
    meta: QueryResultsMeta;
    results: Partial<BoxelIndexTable>[];
  }> {
    try {
      let conditions: CardExpression[] = [
        ['i.realm_url = ', param(realmURL.href)],
        ['is_deleted = FALSE OR is_deleted IS NULL'],
      ];

      if (opts.includeErrors) {
        conditions.push(['i.type =', param(entryType)]);
      } else {
        conditions.push(
          every([
            ['i.type =', param(entryType)],
            any([['i.has_error = FALSE'], ['i.has_error IS NULL']]),
          ]),
        );
      }

      if (
        entryType === 'instance' &&
        opts.cardUrls &&
        opts.cardUrls.length > 0
      ) {
        conditions.push([
          'i.url IN',
          ...addExplicitParens(
            separatedByCommas(opts.cardUrls.map((url) => [param(url)])),
          ),
        ]);
      }

      if (filter) {
        conditions.push(this.filterCondition(filter, baseCardRef, 'positive'));
      }

      let everyCondition = every(conditions);
      let limitClause = page
        ? [`LIMIT ${page.size} OFFSET ${(page.number ?? 0) * page.size}`]
        : [];
      let query: CardExpression;
      if (conditionalLiveDoc) {
        // Outer-wrap the grouped projection so the conditional `pristine_doc`
        // references the already-computed `html` column rather than recomputing
        // the HTML expression. Sort keys are exposed by the inner query and the
        // outer ORDER BY applies them (plus the `url` tiebreaker), so ordering
        // and paging match the unwrapped path.
        let { innerSortColumns, outerOrderBy } =
          this.#wrappedOrderExpression(sort);
        query = [
          'SELECT sub.*,',
          'CASE WHEN sub.html IS NULL THEN sub.pristine_doc_fallback END as pristine_doc',
          'FROM (',
          ...selectClauseExpression,
          ...innerSortColumns,
          `FROM ${tableFromOpts(opts)} AS i ${tableValuedFunctionsPlaceholder}`,
          'WHERE',
          ...everyCondition,
          'GROUP BY url',
          ') AS sub',
          ...outerOrderBy,
          ...limitClause,
        ];
      } else {
        query = [
          ...selectClauseExpression,
          `FROM ${tableFromOpts(opts)} AS i ${tableValuedFunctionsPlaceholder}`,
          'WHERE',
          ...everyCondition,
          'GROUP BY url',
          ...this.orderExpression(sort),
          ...limitClause,
        ];
      }
      let queryCount = [
        'SELECT COUNT(DISTINCT url) AS total',
        `FROM boxel_index AS i ${tableValuedFunctionsPlaceholder}`,
        'WHERE',
        ...everyCondition,
      ];

      let [results, totalResults] = await Promise.all([
        this.#queryCards(query, opts.timings),
        this.#queryCards(queryCount, opts.timings),
      ]);

      return {
        results,
        meta: {
          page: { total: Number(totalResults[0].total) },
        },
      };
    } catch (error) {
      if (isFilterRefersToNonexistentTypeError(error)) {
        return {
          results: [],
          meta: {
            page: { total: 0 },
          },
        };
      }
      throw error;
    }
  }

  // Projection-parametrized instance search. `_search` builds the shared query
  // core (WHERE / GROUP BY url / ORDER / LIMIT); this method varies only the
  // SELECT list by projection. `searchCards` and `searchPrerendered` are thin
  // wrappers, each fixing one projection.
  async search(
    realmURL: URL,
    { filter, sort, page }: Query,
    opts: QueryOptions,
    projection: SearchProjection,
  ): Promise<{
    meta: QueryResultsMeta;
    results: (Partial<BoxelIndexTable> & {
      html?: string | null;
      used_render_type?: string | null;
    })[];
  }> {
    let selectClauseExpression: CardExpression;
    if (projection.kind === 'dataOnly') {
      selectClauseExpression = [
        'SELECT url, ANY_VALUE(i.type) as type, ANY_VALUE(i.has_error) as has_error, ANY_VALUE(pristine_doc) as pristine_doc, ANY_VALUE(error_doc) as error_doc',
      ];
    } else {
      // The full rendering set: every per-format HTML column whole (the
      // fitted/embedded JSONB maps keyed by render type, the scalar
      // atom/head columns), plus the live serialization on every row. The
      // caller enumerates candidate renderings and selects from the set.
      selectClauseExpression = [
        'SELECT url, ANY_VALUE(i.type) as type, ANY_VALUE(i.has_error) as has_error, ANY_VALUE(file_alias) as file_alias, ANY_VALUE(fitted_html) as fitted_html, ANY_VALUE(embedded_html) as embedded_html, ANY_VALUE(atom_html) as atom_html, ANY_VALUE(head_html) as head_html, ANY_VALUE(types) as types, ANY_VALUE(deps) as deps, ANY_VALUE(display_names) as display_names, ANY_VALUE(icon_html) as icon_html, ANY_VALUE(error_doc) as error_doc, ANY_VALUE(pristine_doc) as pristine_doc',
      ];
    }

    return (await this._search(
      realmURL,
      { filter, sort, page },
      opts,
      selectClauseExpression,
      'instance',
    )) as {
      meta: QueryResultsMeta;
      results: (Partial<BoxelIndexTable> & {
        html?: string | null;
        used_render_type?: string | null;
      })[];
    };
  }

  async searchCards(
    realmURL: URL,
    { filter, sort, page }: Query,
    opts: QueryOptions = {},
    // TODO this should be returning a CardCollectionDocument--handle that in
    // subsequent PR where we start storing card documents in "pristine_doc"
  ): Promise<{ cards: CardResource[]; meta: QueryResultsMeta }> {
    let { results, meta } = await this.search(
      realmURL,
      { filter, sort, page },
      opts,
      { kind: 'dataOnly' },
    );

    let cards = results
      .map((r) => r.pristine_doc)
      .filter(Boolean) as CardResource[];

    return { cards, meta };
  }

  async searchFiles(
    realmURL: URL,
    { filter, sort, page }: Query,
    opts: QueryOptions = {},
  ): Promise<{ files: IndexedFile[]; meta: QueryResultsMeta }> {
    let { results, meta } = await this._search(
      realmURL,
      { filter, sort, page },
      opts,
      [
        'SELECT url, ANY_VALUE(pristine_doc) AS pristine_doc, ANY_VALUE(search_doc) AS search_doc, ANY_VALUE(types) AS types, ANY_VALUE(display_names) AS display_names, ANY_VALUE(deps) AS deps, ANY_VALUE(last_modified) AS last_modified, ANY_VALUE(resource_created_at) AS resource_created_at, ANY_VALUE(isolated_html) AS isolated_html, ANY_VALUE(head_html) AS head_html, ANY_VALUE(embedded_html) AS embedded_html, ANY_VALUE(fitted_html) AS fitted_html, ANY_VALUE(atom_html) AS atom_html, ANY_VALUE(icon_html) AS icon_html, ANY_VALUE(markdown) AS markdown, ANY_VALUE(realm_version) AS realm_version, ANY_VALUE(realm_url) AS realm_url, ANY_VALUE(indexed_at) AS indexed_at',
      ],
      'file',
    );

    let files = results.map((result) => this.fileEntryFromResult(result));
    return { files, meta };
  }

  private fileEntryFromResult(result: Partial<BoxelIndexTable>): IndexedFile {
    let canonicalURL = result.url;
    if (!canonicalURL) {
      throw new Error('expected file search result to include url');
    }
    let lastModified =
      typeof result.last_modified === 'string'
        ? parseInt(result.last_modified)
        : (result.last_modified ?? null);
    let resourceCreatedAt =
      typeof result.resource_created_at === 'string'
        ? parseInt(result.resource_created_at)
        : (result.resource_created_at ?? null);
    let indexedAt =
      typeof result.indexed_at === 'string'
        ? parseInt(result.indexed_at)
        : (result.indexed_at ?? null);
    return {
      type: 'file',
      canonicalURL,
      searchDoc: (result.search_doc as Record<string, any> | null) ?? null,
      resource: (result.pristine_doc as FileMetaResource | null) ?? null,
      types: (result.types as string[] | null) ?? null,
      displayNames: (result.display_names as string[] | null) ?? null,
      deps: (result.deps as string[] | null) ?? null,
      isolatedHtml: result.isolated_html ?? null,
      headHtml: result.head_html ?? null,
      embeddedHtml:
        (result.embedded_html as { [refURL: string]: string } | null) ?? null,
      fittedHtml:
        (result.fitted_html as { [refURL: string]: string } | null) ?? null,
      atomHtml: result.atom_html ?? null,
      iconHtml: result.icon_html ?? null,
      markdown: result.markdown ?? null,
      lastModified,
      resourceCreatedAt,
      realmVersion: result.realm_version ?? 0,
      realmURL: result.realm_url ?? '',
      indexedAt,
    };
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

  // The order expression split for the outer-wrapped projection: the inner
  // grouped query exposes each sort value as an aliased column, and the outer
  // query applies the ORDER BY against those aliases (plus the `url`
  // tiebreaker). This yields the same ordering as `orderExpression` while the
  // sort values are computed once in the inner aggregation.
  #wrappedOrderExpression(sort: Sort | undefined): {
    innerSortColumns: CardExpression;
    outerOrderBy: CardExpression;
  } {
    if (!sort) {
      return {
        innerSortColumns: [],
        outerOrderBy: ['ORDER BY url COLLATE "POSIX"'],
      };
    }
    let innerSortColumns: CardExpression = [];
    let outerKeys: CardExpression[] = [];
    sort.forEach((s, i) => {
      let alias = `_sort_${i}`;
      innerSortColumns.push(
        ', ANY_VALUE(',
        'on' in s
          ? fieldQuery(s.by, s.on, false, 'sort')
          : this.generalFieldSortColumn(s.by),
        `) AS ${alias}`,
      );
      outerKeys.push([alias, s.direction ?? 'asc', 'NULLS LAST']);
    });
    // the `url` tiebreaker matches `orderExpression` for deterministic results
    outerKeys.push(['url COLLATE "POSIX"']);
    return {
      innerSortColumns,
      outerOrderBy: ['ORDER BY', ...separatedByCommas(outerKeys)],
    };
  }

  async fetchCardTypeSummary(realmURL: URL): Promise<RealmMetaValue> {
    // JOIN against realm_versions.current_version so we always pick the
    // realm_meta row that matches the realm's authoritative current
    // version. Naive `SELECT … WHERE realm_url=…` returns an arbitrary
    // row when stale rows linger (e.g., a from-scratch reindex resets
    // the version to a low number, leaving older high-version rows that
    // the legacy prune predicate `realm_version < <new>` never reaches).
    // Ordering by `realm_version DESC` would actually pick the *wrong*
    // row after a from-scratch — the highest version is the oldest.
    // realm_versions is the system source of truth for "which version
    // is current," so anchoring the read there is the robust fix.
    let results = (await this.#query([
      `SELECT rm.value
       FROM realm_meta rm
       JOIN realm_versions rv
         ON rv.realm_url = rm.realm_url
        AND rv.current_version = rm.realm_version
       WHERE`,
      ...every([['rm.realm_url =', param(realmURL.href)]]),
      `LIMIT 1`,
    ] as Expression)) as { value: unknown }[];

    return normalizeRealmMetaValue(results[0]?.value);
  }

  private filterCondition(
    filter: Filter,
    onRef: CodeRef,
    polarity: FilterPolarity,
  ): CardExpression {
    let typeRef = (filter as { type?: CodeRef }).type;
    let onProp = 'on' in filter ? filter.on : undefined;
    let on = onProp ?? typeRef ?? onRef;
    let typeConditionRef = onProp ?? typeRef;

    if (typeRef && Object.keys(filter).length === 1) {
      return this.typeCondition(typeRef);
    }

    if ('eq' in filter) {
      return this.eqCondition(filter, on, typeConditionRef, polarity);
    } else if ('in' in filter) {
      return this.inCondition(filter, on, typeConditionRef);
    } else if ('contains' in filter) {
      return this.containsCondition(filter, on, typeConditionRef);
    } else if ('not' in filter) {
      return this.notCondition(filter, on, typeConditionRef, polarity);
    } else if ('range' in filter) {
      return this.rangeCondition(filter, on, typeConditionRef);
    } else if ('matches' in filter) {
      return this.matchesCondition(filter, on, typeConditionRef);
    } else if ('every' in filter) {
      return every([
        ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
        ...filter.every.map((i) => this.filterCondition(i, on, polarity)),
      ]);
    } else if ('any' in filter) {
      return every([
        ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
        any([...filter.any.map((i) => this.filterCondition(i, on, polarity))]),
      ]);
    } else {
      if (isCardTypeFilter(filter)) {
        return this.typeCondition(filter.type);
      }
      assertNever(filter);
    }
    throw new Error(`Unknown filter: ${stringify(filter)}`);
  }

  // the type condition only consumes absolute URL card refs.
  private typeCondition(ref: CodeRef): CardExpression {
    // Match any equivalent spelling of the type key (RRI / real-URL /
    // virtual-alias), so rows indexed before references were canonicalized to
    // RRI still satisfy the filter without a reindex or DB migration.
    return any(
      internalKeysFor(ref, undefined, this.#virtualNetwork).map((typeKey) => [
        tableValuedEach('types'),
        '=',
        param(typeKey),
      ]),
    );
  }

  // The card's primary `id` and a FileDef's `url` index in URL form, but a
  // query may now arrive with a canonical-RRI (prefix) value. For filter paths
  // whose leaf is `id`/`url`, a prefix-form value additionally matches its
  // equivalent spellings — real-URL, RRI-prefix, and any virtual-alias — via
  // the realm's VirtualNetwork. This mirrors how the `types` column tolerates
  // mixed spellings (`internalKeysFor` / `equivalentURLForms`), so a reference
  // filter matches the URL-indexed value without a reindex or DB migration.
  //
  // Only a *prefix-form* value (one that starts with a registered realm prefix)
  // is expanded. These leaf names also occur on ordinary user-data fields (a
  // contained `url` StringField, a FieldDef `id`) whose values are plain
  // strings or URLs and whose `in` filter is an exact string comparison —
  // those are matched exactly as given, gaining no extra normalized spellings,
  // so exact semantics are preserved for non-reference fields.
  private isReferenceFilterField(key: string): boolean {
    let leaf = key.split('.').pop();
    return leaf === 'id' || leaf === 'url';
  }

  private expandReferenceFilterValues(
    key: string,
    values: JSONTypes.Value[],
  ): JSONTypes.Value[] {
    if (!this.isReferenceFilterField(key)) {
      return values;
    }
    let expanded: JSONTypes.Value[] = [];
    let seen = new Set<string>();
    for (let value of values) {
      if (typeof value !== 'string') {
        expanded.push(value);
        continue;
      }
      // Match the value as given by default — this preserves exact `in`
      // semantics for URL-form refs and for ordinary (non-reference) `id`/`url`
      // user-data fields.
      let forms: string[] = [value];
      if (this.#virtualNetwork.isRegisteredPrefix(value)) {
        try {
          // A prefix-form RRI: resolve to its real URL (the server's VN owns
          // the realm mappings), then enumerate equivalent spellings — same
          // composition `internalKeysFor` uses for type keys — so it matches
          // the URL-form indexed reference.
          forms.push(
            ...this.#virtualNetwork.equivalentURLForms(
              this.#virtualNetwork.toURL(value).href,
            ),
          );
        } catch {
          // Unresolvable prefix — match the value as given.
        }
      }
      for (let form of forms) {
        if (!seen.has(form)) {
          seen.add(form);
          expanded.push(form);
        }
      }
    }
    return expanded;
  }

  private eqCondition(
    filter: EqFilter,
    on: CodeRef,
    typeConditionRef?: CodeRef,
    polarity: FilterPolarity = 'positive',
  ): CardExpression {
    let typeRef = typeConditionRef;
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      ...Object.entries(filter.eq).map(([key, value]) => {
        return this.fieldEqFilter(key, value, on, polarity);
      }),
    ]);
  }

  private inCondition(
    filter: InFilter,
    on: CodeRef,
    typeConditionRef?: CodeRef,
  ): CardExpression {
    let typeRef = typeConditionRef;
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      ...Object.entries(filter.in).map(([key, values]) => {
        return this.fieldInFilter(key, values as JSONTypes.Value[], on);
      }),
    ]);
  }

  private containsCondition(
    filter: ContainsFilter,
    on: CodeRef,
    typeConditionRef?: CodeRef,
  ): CardExpression {
    let typeRef = typeConditionRef;
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      ...Object.entries(filter.contains).map(([key, value]) => {
        return this.fieldLikeFilter(key, value, on);
      }),
    ]);
  }

  private notCondition(
    filter: NotFilter,
    on: CodeRef,
    typeConditionRef?: CodeRef,
    polarity: FilterPolarity = 'positive',
  ): CardExpression {
    let typeRef = typeConditionRef;
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      [
        'NOT',
        ...addExplicitParens(
          this.filterCondition(filter.not, on, flipPolarity(polarity)),
        ),
      ],
    ]);
  }

  private rangeCondition(
    filter: RangeFilter,
    on: CodeRef,
    typeConditionRef?: CodeRef,
  ): CardExpression {
    let typeRef = typeConditionRef;
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      ...Object.entries(filter.range).map(([key, filterValue]) => {
        return this.fieldRangeFilter(key, filterValue as RangeFilterValue, on);
      }),
    ]);
  }

  // Full-text matches predicate. Postgres uses tsvector/tsquery on the
  // indexed markdown column; SQLite falls back to a case-insensitive
  // substring LIKE with `%`/`_`/`\` escaped in JS before binding. An
  // empty/whitespace-only query short-circuits to FALSE so SQLite doesn't
  // match every non-null row (PG's websearch_to_tsquery already yields an
  // empty tsquery that matches nothing — we match that behavior here).
  private matchesCondition(
    filter: MatchesFilter,
    _on: CodeRef,
    typeConditionRef?: CodeRef,
  ): CardExpression {
    let typeRef = typeConditionRef;
    let predicate: CardExpression =
      filter.matches.trim() === ''
        ? ['FALSE']
        : [
            dbExpression({
              pg: [
                `to_tsvector('english', coalesce(i.markdown, ''))`,
                '@@',
                `websearch_to_tsquery('english',`,
                param(filter.matches),
                `)`,
              ],
              sqlite: [
                `LOWER(i.markdown) LIKE LOWER(`,
                param(`%${escapeSqliteLikePattern(filter.matches)}%`),
                `) ESCAPE '\\'`,
              ],
            }),
          ];
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      predicate,
    ]);
  }

  private fieldEqFilter(
    key: string,
    value: JSONTypes.Value,
    onRef: CodeRef,
    polarity: FilterPolarity = 'positive',
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
    // Note: the canonical-RRI tolerance (see `expandReferenceFilterValues`) is
    // applied to `in` filters only. `eq` on a reference field keeps exact-match
    // semantics so a singular `.id` eq is still served by the `@>` GIN
    // containment path below; canonical-RRI reference matching uses `in`.
    let query = fieldQuery(key, onRef, false, 'filter');
    let v = fieldValue(key, [param(value)], onRef, 'filter');
    // At positive polarity a singular-path string `eq` can be served by the GIN
    // `search_doc` index via a `@>` containment predicate. fieldArity routes on
    // cardinality only: the singular branch resolves the containment-capable
    // node (which itself falls back to `->>` extraction for numeric/non-string
    // leaves), while a plural path anywhere uses the json_tree machinery. At
    // negated polarity we keep plain extraction, whose NULL-on-absent-path
    // semantics `@>` cannot reproduce under `NOT`.
    if (polarity === 'positive') {
      return [
        fieldArity({
          type: onRef,
          path: key,
          value: [jsonContainsQuery(key, onRef, [param(value)])],
          pluralValue: [query, '=', v],
          errorHint: 'filter',
        }),
      ];
    }
    return [
      fieldArity({
        type: onRef,
        path: key,
        value: [query, '=', v],
        errorHint: 'filter',
      }),
    ];
  }

  private fieldInFilter(
    key: string,
    values: JSONTypes.Value[],
    onRef: CodeRef,
  ): CardExpression {
    if (values.length === 0) {
      // Empty set matches nothing
      return ['false'];
    }
    let nonNullValues = this.expandReferenceFilterValues(
      key,
      values.filter((v) => v !== null),
    );
    let hasNull = values.some((v) => v === null);

    let conditions: CardExpression[] = [];

    if (nonNullValues.length > 0) {
      let query = fieldQuery(key, onRef, false, 'filter');
      let inList: CardExpression = [];
      nonNullValues.forEach((v, i) => {
        if (i > 0) {
          inList.push(',');
        }
        inList.push(fieldValue(key, [param(v)], onRef, 'filter'));
      });
      conditions.push([
        fieldArity({
          type: onRef,
          path: key,
          value: [query, 'IN', '(', ...inList, ')'],
          errorHint: 'filter',
        }),
      ]);
    }

    if (hasNull) {
      let query = fieldQuery(key, onRef, true, 'filter');
      conditions.push([
        fieldArity({
          type: onRef,
          path: key,
          value: [query, 'IS NULL'],
          pluralValue: [query, "= 'null'::jsonb"],
          usePluralContainer: true,
          errorHint: 'filter',
        }),
      ]);
    }

    if (conditions.length === 1) {
      return conditions[0];
    }
    return any(conditions);
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

  private async makeExpression(query: CardExpression): Promise<Expression> {
    return flatten(
      await Promise.all(
        query.map((element) => {
          if (
            isParam(element) ||
            isDbExpression(element) ||
            typeof element === 'string' ||
            element.kind === 'table-valued-each' ||
            element.kind === 'table-valued-tree' ||
            element.kind === 'json-contains'
          ) {
            return Promise.resolve([element]);
          } else if (element.kind === 'field-query') {
            return this.handleFieldQuery(element);
          } else if (element.kind === 'field-value') {
            return this.handleFieldValue(element);
          } else if (element.kind === 'field-arity') {
            return this.handleFieldArity(element);
          } else if (element.kind === 'json-contains-query') {
            return this.handleJsonContainsQuery(element);
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

  private async handleFieldArity(fieldArity: FieldArity): Promise<Expression> {
    let { path, value, type, pluralValue, usePluralContainer } = fieldArity;
    let definition = await this.getDefinition(type);
    // Every field-path filter (eq / in / contains / range, including their null
    // forms) routes through exactly one `fieldArity` node, so this is the single
    // chokepoint that sees each filter path once. Sort paths use `fieldQuery`
    // directly and are intentionally not gated here.
    await this.assertFilterPathSearchable(definition, path);
    let exp: CardExpression = await this.walkFilterFieldPath(
      definition,
      path,
      value,
      // Leaf field handler
      async (_definition, expression, pathTraveled) => {
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
    return await this.makeExpression(exp);
  }

  private async handleFieldQuery(fieldQuery: FieldQuery): Promise<Expression> {
    let { path, type, useJsonBValue } = fieldQuery;
    let definition = await this.getDefinition(type);
    // The rootPluralPath should line up with the tableValuedTree that was
    // used in the handleFieldArity (the multiple tableValuedTree expressions will
    // collapse into a single function)
    let rootPluralPath: string | undefined;
    let isNumericField = false;

    let exp = await this.walkFilterFieldPath(
      definition,
      path,
      [],
      // Leaf field handler
      async (definition, expression, pathTraveled) => {
        let field = await getField(
          definition,
          pathTraveled,
          this.#definitionLookup,
        );
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
          let fieldName = currentField(pathTraveled);
          isNumericField =
            field.serializerName === 'number' ||
            field.serializerName === 'big-integer';
          return [...expression, '->>', param(fieldName)];
        }
        return expression;
      },
      // interior field handler
      {
        enter: async (definition, expression, pathTraveled) => {
          // we work forwards determining if any interior fields are plural
          // since that requires a different style predicate
          let field = await getField(
            definition,
            pathTraveled,
            this.#definitionLookup,
          );
          if (isFieldPlural(field)) {
            rootPluralPath = trimPathAtFirstPluralField(pathTraveled);
            return [
              tableValuedTree('search_doc', rootPluralPath, path, 'text_value'),
            ];
          }
          return expression;
        },
        exit: async (definition, expression, pathTraveled) => {
          // we populate the singular fields backwards as we can only do that
          // after we are assured that we are not leveraging the plural style
          // predicate
          let field = await getField(
            definition,
            pathTraveled,
            this.#definitionLookup,
          );
          if (!isFieldPlural(field) && !rootPluralPath) {
            let fieldName = currentField(pathTraveled);
            return ['->', param(fieldName), ...expression];
          }
          return expression;
        },
      },
    );
    if (!rootPluralPath) {
      // Numeric fields (NumberField, BigIntegerField) are stored as JSON
      // numbers/strings but PostgreSQL's ->> extracts them as text. Cast to
      // numeric so that ORDER BY and range comparisons use numeric ordering
      // instead of lexicographic ordering (e.g. 100 > 20 > 3, not
      // "100" < "20" < "3"). SQLite's ->> preserves the original JSON type so
      // no cast is needed there.
      if (isNumericField) {
        exp = [
          dbExpression({ pg: '(', sqlite: '' }),
          'search_doc',
          ...exp,
          dbExpression({ pg: ')::numeric', sqlite: '' }),
        ];
      } else {
        exp = ['search_doc', ...exp];
      }
    }
    return exp;
  }

  private async handleFieldValue(fieldValue: FieldValue): Promise<Expression> {
    let { path, value, type } = fieldValue;
    let definition = await this.getDefinition(type);
    let exp = await this.makeExpression(value);

    return await this.walkFilterFieldPath(
      definition,
      path,
      exp,
      // Leaf field handler
      async (definition, expression, pathTraveled) => {
        let queryValue: any;
        let [value] = expression;
        let field = await getField(
          definition,
          pathTraveled,
          this.#definitionLookup,
        );
        let serializer = field.serializerName
          ? getSerializer(field.serializerName)
          : undefined;
        if (isParam(value)) {
          queryValue = serializer?.formatQuery?.(value.param) ?? value.param;
        } else if (typeof value === 'string') {
          queryValue = serializer?.formatQuery?.(value) ?? value;
        } else {
          throw new Error(
            `Do not know how to handle field value: ${stringify(value)}`,
          );
        }
        return [param(queryValue)];
      },
    );
  }

  // Resolves a non-null `eq` predicate that fieldArity routed to a singular
  // path (no plural segment was crossed). When the leaf is a string-valued,
  // non-numeric field the predicate becomes a GIN-servable `JsonContains`
  // node; otherwise it degrades to the same `->>` extraction equality the
  // engine has always emitted — numeric leaves keep their `::numeric` cast
  // semantics, non-string values keep text equality.
  private async handleJsonContainsQuery(
    node: JsonContainsQuery,
  ): Promise<Expression> {
    let { path, type, value } = node;
    let resolvedValue = await this.makeExpression([
      fieldValue(path, value, type, 'filter'),
    ]);
    let [leaf] = resolvedValue;
    let definition = await this.getDefinition(type);
    let leafField = await getField(definition, path, this.#definitionLookup);
    let isNumericLeaf =
      leafField.serializerName === 'number' ||
      leafField.serializerName === 'big-integer';
    if (isParam(leaf) && typeof leaf.param === 'string' && !isNumericLeaf) {
      return [
        {
          kind: 'json-contains',
          column: 'search_doc',
          segments: path.split('.'),
          value: leaf,
        },
      ];
    }
    return await this.makeExpression([
      fieldQuery(path, type, false, 'filter'),
      '=',
      ...resolvedValue,
    ]);
  }

  // Reject a filter path that resolves in the schema but crosses a relationship
  // hop whose target the search doc does not carry — it would otherwise match
  // nothing silently. Searchability is reconstructed from the SAME route model
  // the search-doc generator uses (`base/searchable.ts`): routes are seeded from
  // the queried card's own `searchable` annotations and threaded down as tails,
  // and a link is "searchable" exactly when a route reaches it. A non-searchable
  // link still carries its `{ id }`, so a path stopping at that `id` is allowed;
  // a query-backed relationship carries nothing and can never be crossed.
  //
  // Path resolution is verified first: a hop that doesn't resolve (a typo, a
  // removed field, the synthetic `_cardType`) is left for the main walk's
  // `getField` to raise the canonical "nonexistent field" error, so a genuinely
  // nonexistent path never gets reported as merely non-searchable.
  private async assertFilterPathSearchable(
    definition: Definition,
    path: string,
  ): Promise<void> {
    let segments = removeBrackets(path).split('.');
    let routes = seedSearchableRoutesFromDefinition(definition);
    let current: Pick<Definition, 'fields' | 'fieldDefs'> = definition;
    let traveled: string[] = [];
    // Hold the first (outermost) violation but keep resolving: if a later
    // segment turns out not to resolve, the path is nonexistent and that error
    // takes precedence over searchability.
    let violation: FilterRefersToNonsearchableFieldError | undefined;

    for (let i = 0; i < segments.length; i++) {
      let segment = segments[i];
      let fieldDef = getImmediateFieldDef(current, segment);
      if (!fieldDef) {
        return; // nonexistent (or `_cardType`) — defer to the main walk
      }
      let isLast = i === segments.length - 1;
      let isLink =
        fieldDef.type === 'linksTo' || fieldDef.type === 'linksToMany';
      let { matched, tails } = matchSearchableRoutes(routes, segment);

      if (isLink && !isLast && violation == null) {
        let relationshipPath = [...traveled, segment].join('.');
        // A path stopping at the link's `id` reads only the always-present
        // `{ id }` sentinel, so it needs no expansion.
        let crossingToIdOnly =
          i === segments.length - 2 && segments[i + 1] === 'id';
        if (fieldDef.query) {
          violation = new FilterRefersToNonsearchableFieldError({
            type: definition.codeRef,
            path,
            relationshipPath,
            reason: 'query-backed',
          });
        } else if (!matched && !crossingToIdOnly) {
          violation = new FilterRefersToNonsearchableFieldError({
            type: definition.codeRef,
            path,
            relationshipPath,
            reason: 'not-searchable',
          });
        }
      }

      if (isLast) {
        break;
      }
      // Advance to the next segment's owning definition, mirroring `getFieldDef`:
      // a path that goes deeper than a primitive or through an unresolved /
      // unloadable ref is nonexistent — defer to the main walk.
      if (fieldDef.isPrimitive || !isResolvedCodeRef(fieldDef.fieldOrCard)) {
        return;
      }
      let next = await this.#definitionLookup.lookupDefinition(
        fieldDef.fieldOrCard,
      );
      if (!next) {
        return;
      }
      current = next;
      routes = tails;
      traveled.push(segment);
    }

    if (violation) {
      throw violation;
    }
  }

  private async walkFilterFieldPath(
    definition: Definition,
    path: string,
    expression: Expression,
    handleLeafField: FilterFieldHandler<Expression>,
    handleInteriorField?: FilterFieldHandlerWithEntryAndExit<Expression>,
    pathTraveled?: string[],
  ): Promise<Expression>;
  private async walkFilterFieldPath(
    definition: Definition,
    path: string,
    expression: CardExpression,
    handleLeafField: FilterFieldHandler<CardExpression>,
    handleInteriorField?: FilterFieldHandlerWithEntryAndExit<CardExpression>,
    pathTraveled?: string[],
  ): Promise<CardExpression>;
  private async walkFilterFieldPath(
    definition: Definition,
    path: string,
    expression: Expression,
    handleLeafField: FilterFieldHandler<any[]>,
    handleInteriorField?: FilterFieldHandlerWithEntryAndExit<any[]>,
    pathTraveled: string[] = [],
  ): Promise<any> {
    let pathSegments = path.split('.');
    let isLeaf = pathSegments.length === 1;
    let currentSegment = pathSegments.shift()!;
    let currentPath = removeBrackets(
      [...pathTraveled, currentSegment].join('.'),
    );
    let field = await getField(definition, currentPath, this.#definitionLookup);
    // we use '[]' to denote plural fields as that has important ramifications
    // to how we compose our queries in the various handlers and ultimately in
    // SQL construction
    let traveled = [
      ...(pathTraveled ?? []),
      `${currentSegment}${isFieldPlural(field) ? '[]' : ''}`,
    ].join('.');
    if (isLeaf) {
      expression = await handleLeafField(definition, expression, traveled);
    } else {
      let passThru: FilterFieldHandler<any[]> = async (
        _definition,
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
        definition,
        pathSegments.join('.'),
        await entranceHandler(definition, expression, traveled),
        handleLeafField,
        handleInteriorField,
        traveled.split('.'),
      );
      expression = await exitHandler(definition, interiorExpression, traveled);
    }
    return expression;
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

function removeBrackets(pathTraveled: string) {
  return pathTraveled.replace(/\[\]/g, '');
}

function isFieldPlural(field: FieldDefinition): boolean {
  return field.type === 'containsMany' || field.type === 'linksToMany';
}

// Seed the `searchable` route set from the queried card's own fields — the
// loaderless mirror of `base/searchable.ts`'s `seedSearchableRoutes`, reading
// `FieldDefinition.searchable` from the cached definition instead of the live
// field descriptor.
function seedSearchableRoutesFromDefinition(
  definition: Pick<Definition, 'fields' | 'fieldDefs'>,
): string[] {
  let routes: string[] = [];
  for (let [fieldName, defId] of Object.entries(definition.fields)) {
    routes.push(
      ...routesForField(fieldName, definition.fieldDefs[defId]?.searchable),
    );
  }
  return routes;
}

async function getField(
  definition: Definition,
  pathTraveled: string,
  definitionLookup: DefinitionLookup,
): Promise<FieldDefinition> {
  let cleansedPath = removeBrackets(pathTraveled);
  let field = await getFieldDef(definition, cleansedPath, async (codeRef) => {
    if (!isResolvedCodeRef(codeRef)) {
      return undefined;
    }
    return await definitionLookup.lookupDefinition(codeRef);
  });
  if (!field) {
    if (currentField(pathTraveled) === '_cardType') {
      // this is a little awkward--we have the need to treat '_cardType' as a
      // type of string field that we can query against from the index (e.g. the
      // cards grid sorts by the card's display name). index-runner is injecting
      // this into the searchDoc during index time.
      return {
        type: 'contains',
        isPrimitive: true,
        isComputed: false,
        fieldOrCard: {
          module: `${baseRealmRRI}card-api`,
          name: 'StringField',
        },
      } as FieldDefinition;
    }
    throw new Error(
      `Your filter refers to a nonexistent field "${cleansedPath}" on type ${stringify(
        definition.codeRef,
      )}`,
    );
  }
  return field;
}

function currentField(pathTraveled: string) {
  let cleansedPath = removeBrackets(pathTraveled);
  return cleansedPath.split('.').pop()!;
}

function assertIndexEntry<T>(obj: T): Omit<
  T,
  'source' | 'last_modified' | 'resource_created_at'
> & {
  last_modified: string | null;
  resource_created_at: string;
} {
  if (!obj || typeof obj !== 'object') {
    throw new Error(`expected index entry is null or not an object`);
  }
  if (!('last_modified' in obj)) {
    throw new Error(`expected index entry to have "last_modified" property`);
  }
  if (
    !('resource_created_at' in obj) ||
    typeof obj.resource_created_at !== 'string'
  ) {
    throw new Error(
      `expected index entry to have "resource_created_at" property`,
    );
  }
  return obj as Omit<T, 'source' | 'last_modified' | 'resource_created_at'> & {
    last_modified: string;
    resource_created_at: string;
  };
}

function tableFromOpts(opts: WIPOptions | undefined) {
  return opts?.useWorkInProgressIndex ? 'boxel_index_working' : 'boxel_index';
}

// SQLite LIKE treats `%` and `_` as wildcards. With `ESCAPE '\'` we can
// neutralize user-supplied wildcards by prefixing them (and the escape
// char itself) with a backslash before binding.
function escapeSqliteLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}

type FilterFieldHandler<T> = (
  definition: Definition,
  expression: T,
  pathTraveled: string,
) => Promise<T>;

interface FilterFieldHandlerWithEntryAndExit<T> {
  enter?: FilterFieldHandler<T>;
  exit?: FilterFieldHandler<T>;
}
