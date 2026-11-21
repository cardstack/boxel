// The search pipeline (`_search`): one query from arrival to answer, in the
// order docs/search.md ("Evaluation order") documents: snapshot, refusals
// before any read, time zone, lowering the newer spelling, labels, checks,
// one-card bindings, the window, bindings and text rewrites, base
// conditions, filter, collapse, relevance and near columns, count, page,
// facets, passages, the exact retry of a starved near page, and warnings.
// Owns: the order of those steps and the answer's `meta`.
// Must not: hold a step's logic: each step is a call into its layer.
// Guarantees: docs/search.md ("How a query is evaluated").

import { refuse } from '../query-v2/query-refusals.ts';
import { BXL_FORMULA_FUNCTIONS } from '@cardstack/bxl/compiler';
import {
  type CardExpression,
  addExplicitParens,
  any,
  every,
  expressionToSql,
  param,
  separatedByCommas,
  tableValuedFunctionsPlaceholder,
  type StoreBound,
} from '../expression.ts';
import { type CodeRef, baseCardRef } from '../index.ts';
import { StoreBlend } from './store-blend.ts';
import {
  DEFAULT_TIME_ZONE,
  assertPostgresKnowsTimeZone,
  assertTimeZone,
  clockInZone,
  isUtcZone,
} from '../query-v2/time-zone.ts';
import {
  FORMULA_KEY,
  type FilterContext,
  type IndexRowWithHtml,
  type PlainPage,
  type QueryOptions,
  type QueryResultsMeta,
  COLLAPSE_SIZE_KEY,
  isBlendSort,
  isMatchRelevanceSort,
} from './types.ts';
import {
  type Facet,
  type FacetStats,
  type Filter,
  type PageTotalMode,
  type Query,
  type Sort,
  assertNoTypeAheadOperator,
  collapseBy,
  collectPositiveMatchTerms,
  isExprSort,
  lowerTitlePrefixMatches,
  lowerTitlePrefixMatchesInSort,
} from '../query.ts';
import { NearContext } from '../vector-query.ts';
import { pageTotal } from './index-sql.ts';
import {
  SEARCH_TOTAL_CAP,
  TOTAL_ESTIMATED,
  totalEstimatedMessage,
} from '../search-bounds.ts';
import {
  INDEX_HAS_ERROR,
  notEffectivelyErrored,
  prerenderedJoin,
  prerenderedTableFromOpts,
  tableFromOpts,
} from './index-sql.ts';
import { explainRows } from './sort-sql.ts';
import { filterAnchor, requiredTypes } from './filter-sql.ts';
import { type FacetPlan, filterWithout } from './facet-sql.ts';
import {
  type FacetQuery,
  SHARED_FACET_PREFIX,
  storeCounts,
  storedPathOf,
} from './facets.ts';
import { type StoreFacetSet, storeFacetKeysCte } from './store-facets.ts';
import {
  storedRangesCandidates,
  storedTypeCount,
} from './value-store-filter.ts';
import {
  liveAndNonLiveMatches,
  nonLiveRowsOf,
  realmHoldsNonLiveRows,
} from './non-live-rows.ts';
import { besideNearFilters, cappedMatchCount } from './near-filter-beside.ts';
import { vectorSearchSettings } from '../vector-store.ts';
import { unwrapLiterals } from '../query-v2/binding-reference.ts';
import {
  isFilterRefersToNonexistentTypeError,
  isTransientDefinitionLookupError,
} from '../definition-lookup.ts';
import { isRealmUnion, realmIs } from '../realm-union.ts';
import {
  lowerQuery,
  queryHasLabels,
  resolveQueryLabels,
  usesNewSyntax,
} from '../query-v2/query-syntax.ts';
import { resolveTypeReferences } from '../query-v2/type-reference.ts';
import {
  approximateForSqlite,
  withApproximations,
} from './sqlite-approximations.ts';
import stringify from 'safe-stable-stringify';

// `filter` and a policy's `grants` as one conjunction, for a search whose
// statement tests both. A policy-scoped search carries its grants twice: in
// the caller's filter, which every other reader of the query sees, and as the
// base condition that survives a facet dropping the filter's own predicates.
// Compiled apart, the statement tests each grant's type beside the filter's
// own test of it, and Postgres multiplies the repeated tests' selectivities:
// a facet over 12,084 products was planned for 1-4 rows and ran as a nested
// loop of 12,084 index probes instead of one hash join.
//
// As one `every`, flattened, the repeated conjuncts are dropped (`and` is
// idempotent), and a type a grant shares with the filter is tested once
// (`#anchoredEvery` in filter-compiler.ts). The rows are the rows of
// `filter and grants`.
export function withGrants(filter: Filter, grants: Filter): Filter {
  let parts: Filter[] = [];
  let seen = new Set<string>();
  let add = (node: Filter) => {
    let keys = Object.keys(node);
    if (keys.length === 1 && keys[0] === 'every') {
      (node as { every: Filter[] }).every.forEach(add);
      return;
    }
    if (
      keys.length === 1 &&
      keys[0] === 'any' &&
      (node as { any: Filter[] }).any.length === 1
    ) {
      add((node as { any: Filter[] }).any[0]);
      return;
    }
    let key = stringify(node);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    parts.push(node);
  };
  add(filter);
  add(grants);
  return { every: parts };
}

// The field paths a query names with `[]` in them.
function bracketedPaths(query: {
  filter?: Filter;
  sort?: Sort;
  facets?: Facet[];
}): string[] {
  let out: string[] = [];
  let walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (let [key, value] of Object.entries(node)) {
      if (
        ['eq', 'in', 'range', 'contains', 'pattern', 'regex', 'near'].includes(
          key,
        ) &&
        value &&
        typeof value === 'object'
      ) {
        out.push(...Object.keys(value).filter((p) => p.includes('[]')));
      } else if (key === 'every' || key === 'any' || key === 'not') {
        walk(value);
      }
    }
  };
  walk(query.filter);
  for (let s of query.sort ?? []) {
    let by = (s as { by?: unknown }).by;
    if (typeof by === 'string' && by.includes('[]')) out.push(by);
  }
  for (let f of query.facets ?? []) {
    if (f.by.includes('[]')) out.push(f.by);
  }
  return out;
}

export abstract class SearchPipeline extends StoreBlend {
  // One search: `asWritten` in either spelling, `opts` from the caller (the
  // snapshot, zone and clock are added on the way down), and the projection
  // its rows carry. Nested searches (bindings, windows, an exact retry)
  // re-enter here with the outer search's snapshot.
  protected async _search(
    realmURL: URL,
    asWritten: Query,
    opts: QueryOptions,
    selectClauseExpression: CardExpression,
    entryType: 'instance' | 'file' | 'all' = 'instance',
  ): Promise<{
    meta: QueryResultsMeta;
    results: Partial<IndexRowWithHtml>[];
  }> {
    // A log a binding reads that no index pass has synced yet is synced
    // first: the snapshot below could not see rows written after it began.
    if (!opts.reader && asWritten.let) {
      await this.syncBindingLogs(realmURL, asWritten.let, opts);
    }
    // Every statement of the search, and of the searches nested in it, reads
    // one snapshot.
    if (!opts.reader && this.dbAdapter.withReadSnapshot) {
      // The definitions the query names are resolved first, before the
      // snapshot pins a connection: a lookup can wait on a module prerender,
      // and a search holding a connection idle in its transaction for that
      // long starves the pool. The wait sits inside the search's own bound.
      let settled = await this.resolveDefinitionsBeforeSnapshot(
        asWritten,
        opts,
      );
      return await this.inSnapshot(
        opts,
        (inSnapshot) =>
          this._search(
            realmURL,
            asWritten,
            inSnapshot,
            selectClauseExpression,
            entryType,
          ),
        settled,
      );
    }
    // A caller's `typeahead` is refused before anything runs: type-ahead is
    // `{ matches, prefix: true, scope: 'title' }`, which the engine rewrites
    // to an internal node of that old name (below), so only the outermost
    // search checks what it was handed.
    if (!opts.zoneResolved) {
      assertNoTypeAheadOperator(asWritten);
    }
    // A union compares vectors exactly: an approximate index read takes one
    // realm's nearest candidates (realm-union.ts).
    if (isRealmUnion(realmURL) && !opts.nearExact) {
      opts = { ...opts, nearExact: true };
    }
    // One clock reading for the whole query, nested reads included.
    if (!opts.queryNow) {
      opts = { ...opts, queryNow: new Date() };
    }
    // The zone whose calendar the query's dates are reckoned in: the query's
    // own `timeZone`, else the caller's (a federated search over several
    // realms passes UTC), else the realm's default, else UTC. Resolved once,
    // on the outermost search, and carried by the clock reading (`clockInZone`)
    // to every filter, facet, expression and nested search; a binding's query
    // that names its own zone reckons in that one.
    {
      let written = (asWritten as { timeZone?: unknown }).timeZone;
      let own = written !== undefined ? assertTimeZone(written) : undefined;
      if (!opts.zoneResolved) {
        let zone =
          own ??
          (opts.timeZone !== undefined
            ? assertTimeZone(opts.timeZone)
            : undefined) ??
          (await this.realmTimeZone(realmURL, opts)) ??
          DEFAULT_TIME_ZONE;
        if (this.dialect.timeZoneNames) {
          await assertPostgresKnowsTimeZone(zone, (sql, bind) =>
            this.db(opts).execute(sql, { bind: bind as any }),
          );
        }
        // What a SQLite search, and those nested in it, approximated.
        let approximations: NonNullable<QueryOptions['approximations']> = [];
        let out = await this._search(
          realmURL,
          asWritten,
          {
            ...opts,
            timeZone: zone,
            zoneResolved: true,
            queryNow: clockInZone(opts.queryNow!, zone),
            approximations,
          },
          selectClauseExpression,
          entryType,
        );
        withApproximations(out.meta, approximations);
        // Reported when the query named a zone or one other than UTC
        // applied; a search reckoned in UTC by default answers as it always
        // did.
        if (own !== undefined || !isUtcZone(zone)) {
          out.meta.timeZone = zone;
        }
        return out;
      }
      if (own !== undefined && own !== opts.timeZone) {
        if (this.dialect.timeZoneNames) {
          await assertPostgresKnowsTimeZone(own, (sql, bind) =>
            this.db(opts).execute(sql, { bind: bind as any }),
          );
        }
        opts = {
          ...opts,
          timeZone: own,
          queryNow: clockInZone(opts.queryNow!, own),
        };
      }
    }
    // Type references as absolute code refs, in either spelling: a shorthand
    // parsed, a `$REALM/` module resolved against this realm
    // (type-reference.ts). A no-op for a query a boundary resolved already.
    asWritten = resolveTypeReferences(asWritten, { realm: realmURL.href });
    // A query in the request grammar's spellings (a top-level type, blend,
    // formula and boost keys) lowers to the engine's form first.
    let lowering = usesNewSyntax(asWritten)
      ? lowerQuery(asWritten as Record<string, any>, {
          knownFunctions: BXL_FORMULA_FUNCTIONS,
        })
      : undefined;
    let {
      filter,
      sort,
      page,
      facets,
      collapse,
      let: lets,
      explain,
      rerank,
    } = (lowering?.query as Query | undefined) ?? asWritten;
    // Fields written as labels (`PriceMin`, `"Units Sold 30d"`, `Brand.Name`)
    // resolve to their paths against the anchoring type first.
    if (queryHasLabels({ filter, sort, collapse, facets, rerank })) {
      ({ filter, sort, collapse, facets, rerank } = (await resolveQueryLabels(
        { filter, sort, collapse, facets, rerank },
        this.fieldsAt,
        { written: lowering?.notes.quotedLabels },
      )) as Query);
    }
    // The newer spelling has no `[]` in a path: a list is read by its
    // field's own name. (The older spelling's `kind[]` keeps reading `kind`.)
    if (lowering) {
      let bracketed = bracketedPaths(asWritten as Query);
      if (bracketed.length) {
        throw refuse('field-list-named-without', undefined, {
          value0: bracketed[0],
          value1: bracketed[0].replace(/\[\]/g, ''),
        });
      }
    }
    // Type-ahead (`{ matches, prefix: true, scope: 'title' }`) runs as the
    // engine's own type-ahead node. A binding's or comparison set's query
    // passes through here too, as its own search.
    filter = lowerTitlePrefixMatches(filter);
    sort = lowerTitlePrefixMatchesInSort(sort);
    await this.assertKnownModules({ filter, sort, collapse, facets, rerank });
    await this.assertExpressions(filter, sort, rerank, lets, realmURL, opts);
    // On SQLite, a regex, a formula sort and a rerank become the closest
    // thing SQLite runs (sqlite-approximations.ts); a regex left out still
    // gets its field checks.
    if (!this.dialect.regularExpressions || !this.dialect.expressions) {
      let approximated = approximateForSqlite(
        { filter, sort, rerank },
        {
          regularExpressions: this.dialect.regularExpressions,
          expressions: this.dialect.expressions,
        },
      );
      ({ filter, sort, rerank } = approximated);
      opts.approximations?.push(...approximated.warnings);
      for (let { on, path } of approximated.dropped) {
        await this.assertNearFilters(
          { ...(on ? { on } : {}), pattern: { [path]: '*' } } as Filter,
          baseCardRef,
          realmURL,
        );
      }
    }
    // Each expression sort reads the query's one instant.
    if (opts.queryNow && sort?.some((s) => isExprSort(s))) {
      let now = opts.queryNow;
      sort = sort.map((s) => {
        if (!isExprSort(s) || this.sortNow.get(s) === now) return s;
        let entry = { ...s };
        let bindings = this.sortBindings.get(s);
        if (bindings) this.sortBindings.set(entry, bindings);
        this.sortNow.set(entry, now);
        return entry;
      });
    }
    // A page is whole numbers: a size, and a number whose offset a database
    // integer holds. Anything else is refused here, never left to reach
    // LIMIT and OFFSET as text the database cannot read.
    if (page) {
      let size = Number(page.size);
      let number = Number(page.number ?? 0);
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        !Number.isSafeInteger(number) ||
        number < 0 ||
        !Number.isSafeInteger(size * number)
      ) {
        throw refuse('page-size-number-are', undefined, {
          value0: String(page.size),
          value1: String(page.number ?? 0),
        });
      }
    }
    // A counts-only html search answers what a paged html search of the
    // same query answers: its total and facets cover the cards it lists,
    // error cards included, an error card counted by its last good values.
    // The value store holds the live cards only, so the realm's non-live
    // rows are found off their own indexes (non-live-rows.ts). A realm with
    // none, which two index-only reads tell, is counted from the store
    // alone. Where some match the filter, the total adds them, and facets
    // are counted over the live matches the store names together with
    // those rows, in one statement (`liveFromStore`).
    if (
      page &&
      Number(page.size) === 0 &&
      opts.includeErrors &&
      !opts.countsOnlySplit &&
      this.dialect.valueStore &&
      !isRealmUnion(realmURL) &&
      tableFromOpts(opts) === 'boxel_index' &&
      entryType !== 'file'
    ) {
      let { includeErrors: _counted, ...rest } = opts;
      let live: QueryOptions = { ...rest, countsOnlySplit: true };
      let [held] = await this.queryCards(
        realmHoldsNonLiveRows(realmURL.href),
        opts.timings,
        opts,
      );
      let extra = 0;
      if (held?.held) {
        let { facets: _facets, sort: _sort, ...counted } = asWritten as Query;
        let nonLive = await this._search(
          realmURL,
          { ...counted, page: { size: 0 } } as Query,
          { ...opts, countsOnlySplit: true, nonLiveOnly: true },
          selectClauseExpression,
          entryType,
        );
        extra = Number(nonLive.meta.page?.total ?? 0);
      }
      if (extra > 0 && facets?.length) {
        return await this._search(
          realmURL,
          asWritten,
          { ...opts, countsOnlySplit: true, liveFromStore: true },
          selectClauseExpression,
          entryType,
        );
      }
      let out = await this._search(
        realmURL,
        asWritten,
        live,
        selectClauseExpression,
        entryType,
      );
      if (extra > 0 && out.meta.page) {
        out.meta.page = {
          ...out.meta.page,
          total: Number(out.meta.page.total ?? 0) + extra,
          hasMore: true,
        };
      }
      return out;
    }
    // One-card bindings resolve first: their values stand in for each
    // reference, and the query runs on without them.
    if (lets && Object.values(lets).some((b) => b.one)) {
      let resolved = await this.resolveCardLets(
        realmURL,
        { filter, sort, rerank, let: lets },
        opts,
      );
      let out = await this._search(
        realmURL,
        {
          filter: resolved.filter,
          sort: resolved.sort,
          page,
          facets,
          collapse,
          let: resolved.lets,
          explain,
          rerank: resolved.rerank,
        },
        opts,
        selectClauseExpression,
        entryType,
      );
      out.meta.lets = { ...(out.meta.lets ?? {}), ...resolved.letMeta };
      return out;
    }
    // the projection as asked for, before a leading formula adds its column
    let askedSelect = selectClauseExpression;
    if (rerank) {
      let reranked = await this.reranked(
        realmURL,
        { filter, sort, page, facets, collapse, let: lets, explain, rerank },
        opts,
        selectClauseExpression,
        entryType,
      );
      if (reranked) {
        return reranked;
      }
    }
    // The query as it stood before the steps below rewrite it (lets, typos,
    // broad matches, relevance sorts, plain facets), so the
    // overflow fallback re-runs what was asked rather than a rewritten copy.
    let beforeRewrite = { filter, sort, facets };
    try {
      let letMeta: QueryResultsMeta['lets'];
      let letWarnings: NonNullable<QueryResultsMeta['warnings']> = [];
      if (lets && Object.keys(lets).length) {
        ({
          filter,
          sort,
          letMeta,
          warnings: letWarnings,
        } = await this.resolveLets(realmURL, lets, filter, sort, opts));
      }
      // every binding read: an escaped `{ $literal }` is its text now
      filter = unwrapLiterals(filter);
      sort = unwrapLiterals(sort);
      let anonymize = Boolean(opts.anonymizeStatistics);
      filter = await this.resolveTypos(filter, realmURL, anonymize);
      // A broad `matches` term ranks a capped candidate set, unless the
      // caller asked for an exact total.
      let candidatesCapped = false;
      ({ filter, capped: candidatesCapped } = await this.capBroadMatches(
        filter,
        realmURL,
        page,
        opts,
        entryType,
      ));
      // A full-text term's candidates are narrowed by the value store when
      // the filter's other conjuncts let it (store-narrow.ts).
      filter = await this.storeNarrowFilter({
        filter,
        realmURL,
        opts,
        entryType,
      });
      sort = await this.expandRelevanceSorts(sort, filter);
      // A formula that leads the sort ran in SQL; each row carries its value.
      let leadingExpr = sort?.[0];
      if (leadingExpr && isExprSort(leadingExpr) && this.dialect.expressions) {
        selectClauseExpression = [
          ...selectClauseExpression,
          ', ANY_VALUE(',
          this.exprSql(
            leadingExpr.expr,
            this.sortBindings.get(leadingExpr),
            opts.queryNow,
          ),
          `) AS "${FORMULA_KEY}"`,
        ];
      }
      // The facets are counted in one statement of their own over the same
      // match set as the page (`countFacets`).
      let requestedFacets = facets ?? [];
      let facetPlans = await this.facetPlans(
        requestedFacets,
        filter,
        realmURL,
        opts,
        entryType,
      );
      let conditions: CardExpression[] = [
        realmIs('i.realm_url', realmURL) as CardExpression,
        ['i.is_deleted = FALSE OR i.is_deleted IS NULL'],
      ];

      // "not errored" spans both error channels (index + current render error),
      // matching the single-kind branches below — so a file row with a current
      // render error is excluded from the mixed scope too. Where the value
      // store bounds the candidates (below), the store's own liveness stands
      // in for the render-error probe, and only the row's own index error is
      // tested.
      let kindCondition = (live: string): CardExpression => {
        let notErrored: CardExpression = [live];
        if (entryType === 'all') {
          // Mixed scope. Instance rows follow `includeErrors` (their error
          // markup is rendered through the html branch); file rows are only
          // ever surfaced in a healthy state, so they always require
          // `has_error` false regardless of `includeErrors`.
          let instanceBranch: CardExpression = opts.includeErrors
            ? ['i.type =', param('instance')]
            : every([['i.type =', param('instance')], notErrored]);
          let fileBranch = every([['i.type =', param('file')], notErrored]);
          return any([instanceBranch, fileBranch]);
        } else if (opts.includeErrors) {
          return ['i.type =', param(entryType)];
        }
        return every([['i.type =', param(entryType)], notErrored]);
      };
      let kindAt = conditions.length;
      conditions.push(kindCondition(notEffectivelyErrored(opts)));

      // A card-instance `.json` is dual-indexed: an `instance` row and a
      // `file` row sharing the same `i.url`, distinguished only by `i.type`.
      // `GROUP BY i.url, i.type` (below) keeps them as two distinct rows so a
      // mixed query surfaces both; a consumer that wants to dedup the `file`
      // row filters on the `_isCardInstanceFile` search-doc key (stamped only on
      // that row) — e.g. `eq: { _isCardInstanceFile: false }` keeps cards + plain
      // files and drops the card `.json`.

      if (opts.nonLiveOnly) {
        conditions.push(nonLiveRowsOf(realmURL.href));
      }

      if (opts.cardUrls && opts.cardUrls.length > 0) {
        // Restrict to this URL subset. Instance rows key on their `.json` file
        // URL; file rows on their canonical file URL — the same `i.url` column,
        // so the filter applies to both projections (the single-instance
        // card+html / file-meta+html GET sources one entry this way).
        conditions.push([
          'i.url IN',
          ...addExplicitParens(
            separatedByCommas(opts.cardUrls.map((url) => [param(url)])),
          ),
        ]);
      }

      // A policy's grants are a base condition, not part of the caller's
      // filter: a facet that ignores its own selection drops predicates from
      // the filter, and a grant must survive that.
      // The value store answers for every row this search can return when it
      // reads only live instances of one realm's promoted index: a range
      // filter may then narrow by it, and a whole type is counted from it
      // (value-store-filter.ts).
      // A mixed search (`all`, a realm `_search` with no scope) of a card
      // type reads only card instances too: a card type's chain is never a
      // file row's.
      let storeRealm =
        this.dialect.valueStore &&
        !isRealmUnion(realmURL) &&
        tableFromOpts(opts) === 'boxel_index' &&
        (entryType === 'instance' ||
          (entryType === 'all' &&
            filter !== undefined &&
            (await this.#readsOnlyCards(filter)))) &&
        !opts.includeErrors
          ? realmURL.href
          : undefined;
      let filterContext: FilterContext = {
        inAny: false,
        prerenderedTable: prerenderedTableFromOpts(opts),
        now: opts.queryNow,
        indexTable: tableFromOpts(opts),
        realmURL,
        ...(storeRealm ? { valueStoreRealm: storeRealm } : {}),
      };
      let unscopedConditions = [...conditions];
      if (opts.grantFilter) {
        conditions.push(
          this.filterCondition(
            opts.grantFilter,
            baseCardRef,
            'positive',
            filterContext,
          ),
        );
      }
      // A filter read beside the grants, compiled with them as one
      // conjunction (`withGrants`), so a type the filter and a grant both
      // test is tested once.
      let scopedFilterCondition = (f: Filter): CardExpression[] =>
        opts.grantFilter
          ? [
              ...unscopedConditions,
              this.filterCondition(
                withGrants(f, opts.grantFilter),
                baseCardRef,
                'positive',
                filterContext,
              ),
            ]
          : [
              ...unscopedConditions,
              this.filterCondition(f, baseCardRef, 'positive', filterContext),
            ];

      // Everything but the filter: the wide pass of a paged search reads its
      // page's rows under these alone (see `pageRows`).
      let baseConditions = [...conditions];

      // How this search's near sorts, signals and filters run: exactly, or
      // through an approximate index (see vector-query.ts).
      let grantFilter = opts.grantFilter;
      let nearCtx = new NearContext({
        exact: opts.nearExact || opts.nearExactOwn || Boolean(page?.exactNear),
        page,
        reader: opts.reader,
        candidateFloor: opts.nearCandidateFloor,
        ...(grantFilter && this.dialect.vectors
          ? {
              countVisible: async (
                fieldPath: string,
                space: string,
                limit: number,
              ) => {
                let [row] = await this.queryCards(
                  [
                    `SELECT COUNT(*)::int AS n FROM (SELECT 1 FROM boxel_index_vectors AS v JOIN ${tableFromOpts(opts)} AS i ON i.url = v.url AND i.realm_url = v.realm_url AND i.type = v.type WHERE`,
                    ...realmIs('v.realm_url', realmURL),
                    'AND v.field_path =',
                    param(fieldPath),
                    'AND v.space =',
                    param(space),
                    'AND (i.is_deleted = FALSE OR i.is_deleted IS NULL) AND',
                    ...this.filterCondition(
                      grantFilter,
                      baseCardRef,
                      'positive',
                      {
                        inAny: false,
                        prerenderedTable: prerenderedTableFromOpts(opts),
                        indexTable: tableFromOpts(opts),
                        realmURL,
                        now: opts.queryNow,
                      },
                    ),
                    `LIMIT ${Number(limit)}) AS c`,
                  ],
                  opts.timings,
                  opts,
                );
                return Number(row?.n ?? 0);
              },
            }
          : {}),
      });
      if (filter) {
        // The clauses beside the filter's near filters, counted once when a
        // near filter would read the index (near-filter-beside.ts).
        let beside = this.dialect.vectors
          ? besideNearFilters(filter)
          : undefined;
        if (beside) {
          let rest = beside;
          let few: Promise<boolean> | undefined;
          nearCtx.fewBesideNearFilters = () =>
            (few ??= (async () => {
              // checked before they compile, as the whole filter is
              await this.assertNearFilters(rest, baseCardRef, realmURL);
              let cap = vectorSearchSettings().filterCandidates;
              let [row] = await this.queryCards(
                cappedMatchCount(
                  opts,
                  every(scopedFilterCondition(rest)),
                  cap + 1,
                ),
                opts.timings,
                opts,
              );
              return Number(row?.n ?? 0) <= cap;
            })());
        }
        await this.assertNearFilters(filter, baseCardRef, realmURL, nearCtx);
        if (storeRealm) {
          // The filter compiled now, so its range tests say whether the store
          // bounded the candidates: a positive range on a number field that is
          // a conjunct of the whole filter keeps only cards the store holds,
          // and the store holds only live cards (value-store.ts), so the
          // render-error probe would only re-prove what the store answered.
          let storeBound: StoreBound = { narrowed: false, ranges: [] };
          let compiled = await this.makeExpression(
            this.filterCondition(
              opts.grantFilter ? withGrants(filter, opts.grantFilter) : filter,
              baseCardRef,
              'positive',
              { ...filterContext, storeBound },
            ),
            opts,
          );
          let bound = storedRangesCandidates(storeBound.ranges);
          conditions = [
            ...unscopedConditions,
            compiled,
            ...(bound ? [bound as CardExpression] : []),
          ];
          if (storeBound.narrowed) {
            conditions[kindAt] = kindCondition(`(NOT ${INDEX_HAS_ERROR})`);
          }
        } else {
          conditions = scopedFilterCondition(filter);
        }
      }

      let everyCondition = every(conditions);
      // A facet that ignores its own selection counts over the search's
      // condition without it (the search's own where the filter does not
      // test the facet's field); facets with equal conditions share one
      // match set (`countFacets`).
      let ignoring = new Map<string, CardExpression>();
      let facetConditionOf = (plan: FacetPlan): CardExpression => {
        if (plan.facet.own !== 'ignore') {
          return everyCondition;
        }
        let rest = filter ? filterWithout(filter, plan.facet.by) : undefined;
        let key = stringify(rest ?? null);
        if (filter && key === stringify(filter)) {
          return everyCondition;
        }
        let condition = ignoring.get(key);
        if (!condition) {
          condition = every(
            rest ? scopedFilterCondition(rest) : baseConditions,
          );
          ignoring.set(key, condition);
        }
        return condition;
      };
      // A facet match set the value store decides reads its rows from the
      // store (store-facets.ts); the facets of one filter share it.
      let facetStoreSets = new Map<FacetPlan, StoreFacetSet | undefined>();
      if (facetPlans.length > 0) {
        let facetFilterOf = (plan: FacetPlan) =>
          plan.facet.own !== 'ignore' || !filter
            ? filter
            : filterWithout(filter, plan.facet.by);
        let groups = new Map<string, FacetPlan[]>();
        for (let plan of facetPlans) {
          let key = stringify(facetFilterOf(plan) ?? null);
          groups.set(key, [...(groups.get(key) ?? []), plan]);
        }
        for (let group of groups.values()) {
          let set = await this.storeFacetSet({
            realmURL,
            filter: facetFilterOf(group[0]),
            opts,
            entryType,
            condition: facetConditionOf(group[0]),
            facetPaths: group
              .filter((plan) => !plan.empty && !plan.column)
              .map(storedPathOf),
          });
          for (let plan of group) {
            facetStoreSets.set(plan, set);
          }
        }
      }
      let storeSetOf = (plan: FacetPlan) => facetStoreSets.get(plan);
      // The facets counted in the page's own statement, over its match set.
      let facetsFirst:
        | { query: FacetQuery; row: Record<string, unknown> }
        | undefined;
      // A search of one whole type: its total is the store's count of the
      // type's live cards.
      // A card type's chain is never a file row's, so a mixed search of one
      // card type counts the same cards. A filter that only anchors a type
      // (`{ on, every: [] }`, a query's top-level `type` with nothing else)
      // admits the same cards; its near plan reads the count
      // (`NearContext#typeCount`), its total is counted as before. The
      // total of a page over a near sort's candidates is the count of
      // either, and of a filter whose one conjunct is a type
      // (`{ every: [{ on }] }`). A caller a realm policy scopes never reads
      // it (ADR 006).
      let wholeType =
        this.dialect.valueStore &&
        !isRealmUnion(realmURL) &&
        tableFromOpts(opts) === 'boxel_index' &&
        entryType !== 'file' &&
        !opts.includeErrors &&
        filter &&
        !opts.grantFilter &&
        !opts.cardUrls?.length
          ? wholeTypeOf(filter)
          : undefined;
      if (wholeType) {
        // Only cards are in the store: a file type is counted from the index.
        let definition = await this.getDefinition(wholeType).catch(
          () => undefined,
        );
        if (definition?.type !== 'card-def') {
          wholeType = undefined;
        }
      }
      let oneType = wholeType && filter && onlyTypeOf(filter);
      let wholeTypeCount: (() => Promise<number>) | undefined;
      if (wholeType) {
        let type = wholeType;
        let counted: Promise<number> | undefined;
        wholeTypeCount = () =>
          (counted ??= (async () => {
            let [row] = await this.queryCards(
              storedTypeCount(realmURL.href, await this.typeKeysFor(type)),
              opts.timings,
              opts,
            );
            return Number(row?.total ?? 0);
          })());
      }
      let typeCount = oneType ? wholeTypeCount : undefined;
      let storedCount = filter && 'type' in filter ? typeCount : undefined;
      nearCtx.typeCount = typeCount;
      let collapsed = collapseBy(collapse);
      let collapseOn = collapsed?.on ?? filterAnchor(filter);
      if (collapsed && !collapseOn) {
        throw refuse('collapse-needs-type-give', undefined, {
          by: collapsed.by,
        });
      }
      let limitClause = page
        ? [`LIMIT ${page.size} OFFSET ${(page.number ?? 0) * page.size}`]
        : [];

      // A page sorted by one blend that the value store can answer reads
      // its scores from the store's narrow rows (store-blend.ts).
      // Facets over sets the store decides count on their own, from the
      // store, so they need nothing of the page's match set.
      let storeBlend =
        page &&
        !explain &&
        facetPlans.every(
          (plan) => facetStoreSets.get(plan) && storeCounts(plan),
        )
          ? await this.storeBlendPage({
              realmURL,
              filter,
              sort,
              page,
              collapse:
                collapsed && collapseOn
                  ? { by: collapsed.by, on: collapseOn, keep: collapsed.keep }
                  : undefined,
              opts,
              entryType,
              nearCtx,
              everyCondition,
            })
          : undefined;

      // Full-text relevance is opt-in: computed only when the caller sorts by
      // `_matchRelevance`, so every existing `matches` caller pays nothing. When
      // present it rides the projection as an aggregated, aliased column that the
      // ORDER BY (below) references — see `matchRelevanceExpression`.
      let sortsByMatchRelevance = (sort ?? []).some(
        (s) =>
          isMatchRelevanceSort(s) ||
          (isBlendSort(s) && s.of.some(isMatchRelevanceSort)),
      );
      let relevanceColumn: CardExpression = [];
      if (sortsByMatchRelevance) {
        // `assertQuery` already rejects this on the wire surfaces (as an
        // HTTP 400); this re-check is the backstop for callers that reach the
        // engine directly.
        let matches = collectPositiveMatchTerms(filter);
        if (matches.length === 0) {
          throw refuse('sort-textrelevance-requires-least');
        }
        if ((sort ?? []).some(isMatchRelevanceSort)) {
          relevanceColumn = [
            ',',
            ...this.matchRelevanceExpression(
              matches,
              opts?.pendingStagingId !== undefined,
            ),
          ];
        }
      }
      // An expression's window ranks every match, so its near sort compares
      // exactly. A collapsed page pages over the candidates like any other
      // (collapse-candidates.ts).
      nearCtx.sortExactBecause = opts.nearExactBecause;
      // A collapsed page counts the kept rows among its filter's first
      // matches, once, when its near sort would read the index: a filter of
      // few matches compares them exactly, and the count is the total of a
      // page over the candidates.
      let collapsedCount:
        | Promise<{ matched: number; kept: number } | undefined>
        | undefined;
      let countCollapsed =
        collapsed && collapseOn && page
          ? () =>
              (collapsedCount ??= this.#cappedCollapsedCount(
                opts,
                {
                  by: collapsed.by,
                  on: collapseOn,
                  keep: collapsed.keep,
                },
                everyCondition,
              ))
          : undefined;
      if (countCollapsed) {
        nearCtx.fewMatches = async () => {
          let counted = await countCollapsed();
          return counted !== undefined && counted.matched <= SEARCH_TOTAL_CAP;
        };
      }
      let { nearColumns, nearJoins } = storeBlend
        ? { nearColumns: [] as CardExpression, nearJoins: [] as CardExpression }
        : await this.vectors.nearSortExpressions(sort, realmURL, nearCtx);
      // A leading near sort that read candidates through the index pages
      // over those cards alone, each re-scored exactly; its total comes
      // from its own count (`nearPageTotal`, below).
      let candidateUrls = nearCtx.leadingCandidates;
      let pageCondition: CardExpression = candidateUrls
        ? every([
            everyCondition,
            [
              'i.url IN (SELECT jsonb_array_elements_text(CAST(',
              param(JSON.stringify(candidateUrls)),
              'AS jsonb)))',
            ],
          ])
        : everyCondition;
      let { blendColumns, blendJoins } = storeBlend
        ? {
            blendColumns: [] as CardExpression,
            blendJoins: [] as CardExpression,
          }
        : await this.blendSortExpressions(
            sort,
            sortsByMatchRelevance ? collectPositiveMatchTerms(filter) : [],
            opts?.pendingStagingId !== undefined,
            {
              inAny: false,
              prerenderedTable: prerenderedTableFromOpts(opts),
              now: opts.queryNow,
              indexTable: tableFromOpts(opts),
              realmURL,
              near: nearCtx,
            },
            Boolean(explain),
          );
      relevanceColumn = [...relevanceColumn, ...nearColumns, ...blendColumns];
      nearJoins = [...nearJoins, ...blendJoins];

      let query: CardExpression = [
        ...selectClauseExpression,
        ...relevanceColumn,
        `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
        ...nearJoins,
        tableValuedFunctionsPlaceholder,
        'WHERE',
        ...everyCondition,
        'GROUP BY i.url, i.type',
        ...this.orderExpression(sort),
        ...limitClause,
      ];
      // Count over the same tables as the data query (via `opts`) so `total`
      // stays consistent with the result set — including in WIP mode and for a
      // `matches` predicate, which is shared with the data query through
      // `everyCondition` and references `ph.markdown`. Count distinct
      // `(url, type)` pairs to match the `GROUP BY i.url, i.type` grouping — a
      // dual-indexed card `.json` contributes both its `instance` and `file`
      // row. Expressed as a `COUNT(*)` over a `DISTINCT` subquery because
      // SQLite's `COUNT(DISTINCT …)` takes only a single expression.
      let queryCount = [
        'SELECT COUNT(*) AS total FROM (',
        'SELECT DISTINCT i.url, i.type',
        `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(
          opts,
        )} ${tableValuedFunctionsPlaceholder}`,
        'WHERE',
        ...everyCondition,
        ') AS distinct_entries',
      ];

      let results: Record<string, unknown>[];
      let totalResults: Record<string, unknown>[];
      let plainPage: PlainPage | undefined;
      let nearPageTotal:
        | { total: number; totalIsEstimate: boolean }
        | undefined;
      if (storeBlend) {
        totalResults = [{ total: storeBlend.total }];
        results =
          storeBlend.keys.length > 0
            ? await this.pageRows(
                storeBlend.keys,
                selectClauseExpression,
                baseConditions,
                opts,
                sort,
              )
            : [];
      } else if (collapsed && collapseOn) {
        // Collapsed: the narrow pass keeps each group's best rows by the
        // query's own order, then orders, counts and pages what remains.
        // Facets count every match, so they run on their own.
        let keys = await this.queryCards(
          this.collapsedNarrowPass({
            opts,
            sort,
            collapse: {
              by: collapsed.by,
              on: collapseOn,
              keep: collapsed.keep,
            },
            relevanceColumn,
            nearJoins,
            everyCondition: pageCondition,
            limitClause,
          }),
          opts.timings,
          opts,
        );
        if (candidateUrls && page) {
          // A page over the near sort's candidates (collapse-candidates.ts):
          // its groups' sizes and its total are read over the filter.
          let collapse = {
            by: collapsed.by,
            on: collapseOn,
            keep: collapsed.keep,
          };
          // A short page is read again, wider or exactly (below), so it
          // counts nothing here.
          if (keys.length >= Number(page.size)) {
            nearPageTotal = await this.#candidateCollapsedTotal({
              opts,
              collapse,
              everyCondition,
              page,
              shown: keys.length,
              counted: countCollapsed!,
            });
            await this.#candidateGroupSizes(keys, {
              opts,
              collapse,
              everyCondition,
              filterContext,
            });
          }
          totalResults = [{ total: nearPageTotal?.total ?? keys.length }];
        } else if (keys.length > 0) {
          totalResults = [{ total: keys[0].__page_total }];
        } else {
          let [row] = await this.queryCards(
            this.collapsedNarrowPass({
              opts,
              sort: undefined,
              collapse: {
                by: collapsed.by,
                on: collapseOn,
                keep: collapsed.keep,
              },
              relevanceColumn: [],
              nearJoins: [],
              everyCondition,
              limitClause: [],
              countOnly: true,
            }),
            opts.timings,
            opts,
          );
          totalResults = [{ total: row?.total ?? 0 }];
        }
        results =
          keys.length > 0
            ? await this.pageRows(
                keys,
                selectClauseExpression,
                baseConditions,
                opts,
                sort,
              )
            : [];
      } else if (
        page &&
        (plainPage = await this.plainTopN({
          opts,
          sort,
          page,
          relevanceColumn,
          nearJoins,
          everyCondition,
          realm: isRealmUnion(realmURL) ? undefined : realmURL.href,
          ...(storedCount ? { storedCount } : {}),
          requiredTypes: requiredTypes(filter),
          hydration: isRealmUnion(realmURL)
            ? undefined
            : {
                realm: realmURL.href,
                select: selectClauseExpression,
                oneType: entryType !== 'all',
              },
        }))
      ) {
        // A plain page: nothing that fans a match out into several rows, so
        // the matches are already one row per (url, type) and the page is an
        // ordered LIMIT the planner can read off an index.
        totalResults = [{ total: plainPage.total }];
        results =
          plainPage.hydrated || plainPage.rows.length === 0
            ? plainPage.rows
            : await this.pageRows(
                plainPage.rows,
                selectClauseExpression,
                baseConditions,
                opts,
                sort,
              );
      } else if (page) {
        // A paged search runs as a narrow pass then a wide one. The narrow
        // pass evaluates the filter once and returns only each match's key, its
        // sort values and the synthetic sort columns, ordered and limited to
        // the page, with the match count taken in the same pass by a window
        // function (evaluated over every group, before the LIMIT). The wide
        // pass reads the projection's large columns
        // (`pristine_doc`, the HTML maps) for the page's rows alone, by key,
        // without the filter.
        //
        // In one pass the projection's `ANY_VALUE(...)` columns are aggregated
        // for every match before the sort keeps a page, so a 24-row shelf over
        // 6,000 matches detoasted 6,000 documents; and the COUNT query
        // evaluated the whole filter again.
        let keys: Record<string, unknown>[];
        // The match count the facets' statement read, when the page's
        // statement counted them.
        let matchTotal: number | undefined;
        let countsOnlySet =
          Number(page.size) === 0 && !storedCount && !candidateUrls
            ? await this.#storeSetOfFilter(filter, facetPlans, facetStoreSets, {
                realmURL,
                opts,
                entryType,
                condition: everyCondition,
              })
            : undefined;
        if (storedCount && Number(page.size) === 0) {
          // A counts-only page of a whole type reads no index row.
          keys = [];
        } else if (countsOnlySet) {
          // A counts-only page whose matches the value store decides counts
          // them there (store-facets.ts); its facets count on their own.
          keys = [];
          let [row] = await this.queryCards(
            [
              'WITH',
              ...storeFacetKeysCte('k', countsOnlySet),
              'SELECT COUNT(*) AS total FROM k',
            ],
            opts.timings,
            opts,
          );
          matchTotal = Number(row?.total ?? 0);
        } else if (this.dialect.plannerPaging) {
          // The facets of the search's own match set are counted in the same
          // statement, over its `m`.
          let shared =
            facetPlans.length > 0 && nearJoins.length === 0
              ? this.facetQuery(facetPlans, opts, facetConditionOf, storeSetOf)
              : undefined;
          // A counts-only html search over a realm with matching error rows
          // (`liveFromStore`): its match set is the live matches the value
          // store names and the realm's non-live rows the filter matches,
          // which together are the rows the page's own condition admits,
          // read without the realm's other rows.
          let liveSet =
            opts.liveFromStore && Number(page.size) === 0 && shared
              ? await this.storeFacetSet({
                  realmURL,
                  filter,
                  opts: { ...opts, includeErrors: undefined },
                  entryType,
                  condition: everyCondition,
                  facetPaths: [],
                })
              : undefined;
          keys = await this.queryCards(
            this.pgNarrowPass({
              opts,
              sort,
              relevanceColumn,
              nearJoins,
              everyCondition: pageCondition,
              limitClause,
              ...(liveSet
                ? {
                    matches: liveAndNonLiveMatches(
                      liveSet,
                      everyCondition,
                      realmURL.href,
                    ),
                  }
                : {}),
              ...(shared
                ? {
                    facets: this.facetSql(
                      shared,
                      opts,
                      SHARED_FACET_PREFIX,
                      realmURL,
                      {
                        condition: everyCondition,
                        from: 'm',
                      },
                    ),
                  }
                : {}),
            }),
            opts.timings,
            opts,
          );
          if (shared && keys[0]) {
            facetsFirst = { query: shared, row: keys[0] };
            matchTotal = Number(keys[0].__match_total ?? 0);
            keys = keys.filter((key) => key.url != null);
          }
        } else {
          let keyQuery: CardExpression = [
            'SELECT i.url AS url, i.type AS type, COUNT(*) OVER () AS __page_total',
            ...relevanceColumn,
            `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
            ...nearJoins,
            tableValuedFunctionsPlaceholder,
            'WHERE',
            ...pageCondition,
            'GROUP BY i.url, i.type',
            ...this.orderExpression(sort),
            ...limitClause,
          ];
          keys = await this.queryCards(keyQuery, opts.timings, opts);
        }
        if (candidateUrls) {
          // A page over the near sort's candidates: its rows count only
          // those, so the total is counted over the filter, as the page
          // asks: exactly only when asked for (`page.exactTotal`), else up
          // to `SEARCH_TOTAL_CAP`, a bound past it (`total-estimated`). A
          // short page is answered exactly instead (`NearContext#starved`),
          // so it counts nothing here.
          let mode: PageTotalMode =
            page.exactTotal || page.total === 'exact'
              ? 'exact'
              : page.total === 'none'
                ? 'none'
                : 'capped';
          nearPageTotal =
            keys.length < Number(page.size)
              ? { total: keys.length, totalIsEstimate: false }
              : await pageTotal(
                  Number(page.size),
                  mode,
                  (page.number ?? 0) * Number(page.size),
                  keys.length,
                  true,
                  async (cap?: number) => {
                    // A whole type's matches are its live cards, which the
                    // value store counts without reading an index row.
                    if (wholeTypeCount) {
                      let n = await wholeTypeCount();
                      return cap ? Math.min(n, cap) : n;
                    }
                    let limit = cap ? [`LIMIT ${Number(cap)}`] : [];
                    // One row per match unless a condition walks a plural
                    // field (a lateral join): then distinct keys. Without
                    // the DISTINCT a capped count stops at its limit.
                    let plain = await this.makeExpression(
                      [
                        'SELECT COUNT(*) AS total FROM (SELECT 1',
                        `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
                        tableValuedFunctionsPlaceholder,
                        'WHERE',
                        ...everyCondition,
                        ...limit,
                        ') AS entries',
                      ],
                      opts,
                    );
                    let [row] = expressionToSql(
                      this.dialect.kind,
                      plain,
                    ).text.includes('CROSS JOIN LATERAL')
                      ? await this.queryCards(
                          [
                            ...queryCount.slice(0, -1),
                            ...limit,
                            ') AS distinct_entries',
                          ],
                          opts.timings,
                          opts,
                        )
                      : await this.query(plain, opts);
                    return Number(row?.total ?? 0);
                  },
                );
          totalResults = [{ total: nearPageTotal.total }];
        } else if (keys.length > 0) {
          totalResults = [{ total: keys[0].__page_total }];
        } else if (matchTotal !== undefined) {
          totalResults = [{ total: matchTotal }];
        } else if ((page.number ?? 0) === 0 && Number(page.size) > 0) {
          // No match: no count. A counts-only page (`size: 0`) returns no row
          // whether or not anything matched, so it takes the fallback below.
          totalResults = [{ total: 0 }];
        } else {
          // A page past the last match has no row to carry the count, so it
          // comes from its own query.
          totalResults = storedCount
            ? [{ total: await storedCount() }]
            : await this.queryCards(queryCount, opts.timings, opts);
        }
        results =
          keys.length > 0
            ? await this.pageRows(
                keys,
                selectClauseExpression,
                baseConditions,
                opts,
                sort,
              )
            : [];
      } else {
        // Unpaged: every match is a row, so the rows are the count.
        results = await this.queryCards(query, opts.timings, opts);
        totalResults = [{ total: results.length }];
      }
      if (explain) {
        explainRows(results, sort);
      }

      let extendedByFacet = new Map(
        [
          ...(this.dialect.valueStore
            ? await this.countFacets(
                facetPlans,
                opts,
                facetConditionOf,
                realmURL,
                facetsFirst,
                storeSetOf,
              )
            : // SQLite counts them in JS over the search as asked
              // (sqlite-facets.ts).
              await this.countFacetsFromSearchDocs(
                facetPlans,
                {
                  filter: beforeRewrite.filter,
                  sort: beforeRewrite.sort,
                  let: lets,
                },
                realmURL,
                opts,
                entryType,
              )
          ).entries(),
        ].map(([plan, result]) => [plan.facet, result]),
      );
      let facetStats: Record<string, FacetStats> = {};
      for (let [facet, result] of extendedByFacet) {
        if (result.stats) {
          facetStats[facet.by] = result.stats;
        }
      }

      let passageTerms = collectPositiveMatchTerms(filter).filter(
        (m) => m.within,
      );
      let passages = await this.pagePassages(
        realmURL,
        passageTerms,
        results
          .map((row) => row.url)
          .filter((url): url is string => typeof url === 'string'),
        opts,
      );

      // The leading near sort compared an approximate read's candidates,
      // and the page shows the filter may have admitted cards it left out:
      // answer exactly instead.
      if (nearCtx.starved(results as Record<string, unknown>[])) {
        // A collapsed page over the candidates reads more of them first.
        let wider = collapsed && collapseOn ? nearCtx.widenedRead() : undefined;
        if (wider !== undefined) {
          return await this._search(
            realmURL,
            asWritten,
            { ...opts, nearCandidateFloor: wider },
            askedSelect,
            entryType,
          );
        }
        // A collapsed page compares its own near sort exactly; its `let`
        // bindings, whose pages were not short, read as they did.
        let exact = await this._search(
          realmURL,
          asWritten,
          collapsed && collapseOn
            ? { ...opts, nearCandidateFloor: undefined, nearExactOwn: true }
            : { ...opts, nearExact: true },
          askedSelect,
          entryType,
        );
        if (exact.meta.near) {
          exact.meta.near = { ...exact.meta.near, reason: 'filtered-out' };
          // The retry compared every vector past the threshold: the same
          // warning as any other exact scan of a large field.
          let { candidates, threshold } = exact.meta.near;
          let warnings = exact.meta.warnings ?? [];
          if (
            candidates > threshold &&
            !warnings.some((w) => w.code === 'near-exact-scan')
          ) {
            exact.meta.warnings = [
              ...warnings,
              {
                code: 'near-exact-scan',
                message: `a near search compared each of more than ${threshold.toLocaleString('en-US')} vectors exactly (filtered-out)`,
              },
            ];
          }
        }
        return exact;
      }
      let nearWarnings = nearCtx.warnings;
      // The total is a lower bound (a caveat, so a warning, never a flag
      // on the page): a broad `matches` term ranked a capped candidate set,
      // or the page's `total` mode stopped counting.
      let totalIsEstimate =
        plainPage?.totalIsEstimate || nearPageTotal?.totalIsEstimate;
      let totalWarning =
        candidatesCapped || totalIsEstimate
          ? {
              code: TOTAL_ESTIMATED,
              message: totalEstimatedMessage(
                candidatesCapped
                  ? 'candidates'
                  : page?.total === 'none'
                    ? 'uncounted'
                    : 'capped',
              ),
            }
          : undefined;
      // A union's count of each realm's rows: the same conditions as the
      // total, in the same snapshot, so they sum to it. Not counted where
      // the total is itself a bound or not counted.
      let realmTotals =
        isRealmUnion(realmURL) &&
        !candidatesCapped &&
        !totalIsEstimate &&
        page?.total !== 'none'
          ? await this.unionRealmTotals(realmURL, opts, everyCondition, {
              collapse:
                collapsed && collapseOn
                  ? { by: collapsed.by, on: collapseOn, keep: collapsed.keep }
                  : undefined,
              sort,
              relevanceColumn,
              nearJoins,
            })
          : undefined;
      return {
        results,
        meta: {
          ...(realmTotals ? { realmTotals } : {}),
          page: {
            total: Number(totalResults[0].total),
            ...(page
              ? {
                  hasMore:
                    plainPage?.hasMore ??
                    (page.number ?? 0) * page.size + results.length <
                      Number(totalResults[0].total),
                }
              : {}),
          },
          ...(nearCtx.report ? { near: nearCtx.report } : {}),
          ...(passages ? { passages } : {}),
          ...(requestedFacets.length
            ? {
                facets: Object.fromEntries(
                  requestedFacets.map((facet) => [
                    facet.by,
                    extendedByFacet.get(facet)?.counts ?? [],
                  ]),
                ),
              }
            : {}),
          ...(Object.keys(facetStats).length ? { facetStats } : {}),
          ...(letMeta ? { lets: letMeta } : {}),
          ...(letWarnings.length || nearWarnings.length || totalWarning
            ? {
                warnings: [
                  ...letWarnings,
                  ...nearWarnings,
                  ...(totalWarning ? [totalWarning] : []),
                ],
              }
            : {}),
        },
      };
    } catch (error) {
      // Only a type that is genuinely absent matches nothing. A lookup that
      // could not tell (its module's prerender timed out, or every populate
      // was discarded) propagates as a retryable error: answering `ok, 0`
      // would be a confident wrong answer that callers and caches keep.
      if (
        isFilterRefersToNonexistentTypeError(error) &&
        !isTransientDefinitionLookupError(error)
      ) {
        return {
          results: [],
          meta: {
            page: { total: 0 },
          },
        };
      }
      // A formula whose value overflows (or underflows) a double makes
      // Postgres raise rather than give a number (Excel's #NUM!): refused,
      // as there is nowhere else an expression runs.
      // The expression may be any sort entry's, or a blend's signal.
      let overflowing = (
        Array.isArray(beforeRewrite.sort) ? beforeRewrite.sort : []
      ).flatMap((s: any) =>
        isExprSort(s)
          ? [s.expr]
          : isBlendSort(s)
            ? s.of.filter((c: any) => isExprSort(c)).map((c: any) => c.expr)
            : [],
      );
      if (
        overflowing.length > 0 &&
        /value out of range: (overflow|underflow)/.test(
          String((error as Error)?.message),
        )
      ) {
        throw refuse('expression-value-overflows-number', undefined, {
          value0: overflowing.map((e: string) => JSON.stringify(e)).join(', '),
        });
      }
      throw error;
    }
  }

  // A collapsed page over the near sort's candidates counted its groups
  // over the candidates alone: each kept row's `_collapseSize` becomes its
  // group's size over the whole filter. A row with no value at `by` is a
  // group of its own (size 1, as counted). Over a text field the groups'
  // matches are found through the field's index (an `in` on it) first.
  async #candidateGroupSizes(
    keys: Record<string, unknown>[],
    {
      opts,
      collapse,
      everyCondition,
      filterContext,
    }: {
      opts: QueryOptions;
      collapse: { by: string; on: CodeRef; keep: number };
      everyCondition: CardExpression;
      filterContext: FilterContext;
    },
  ) {
    let groups = [
      ...new Set(
        keys.flatMap((key) =>
          key.__collapse == null ? [] : [String(key.__collapse)],
        ),
      ),
    ];
    if (groups.length === 0) {
      return;
    }
    let narrowedBy = (await this.isStoredTextField(collapse.on, collapse.by))
      ? this.filterCondition(
          { on: collapse.on, in: { [collapse.by]: groups } } as Filter,
          baseCardRef,
          'positive',
          filterContext,
        )
      : undefined;
    let rows = await this.queryCards(
      this.collapsedGroupSizes({
        opts,
        collapse,
        everyCondition,
        groups,
        narrowedBy,
      }),
      opts.timings,
      opts,
    );
    let sizes = new Map(
      rows.map((row) => [String(row.__collapse), Number(row.n)]),
    );
    for (let key of keys) {
      if (key.__collapse != null) {
        key[COLLAPSE_SIZE_KEY] =
          sizes.get(String(key.__collapse)) ?? key[COLLAPSE_SIZE_KEY];
      }
    }
  }

  // The total of a collapsed page over the near sort's candidates, counted
  // over the filter as the page asks, as any page over candidates is:
  // exactly only when asked for (`page.total: 'exact'`, `page.exactTotal`);
  // `none` counts nothing; otherwise the kept rows among the first
  // `SEARCH_TOTAL_CAP` matches, the total when the filter matches no more,
  // a lower bound (`total-estimated`) when it does. A filter that walks a
  // plural field (several rows a match) is counted exactly.
  async #candidateCollapsedTotal({
    opts,
    collapse,
    everyCondition,
    page,
    shown,
    counted,
  }: {
    opts: QueryOptions;
    collapse: { by: string; on: CodeRef; keep: number };
    everyCondition: CardExpression;
    page: NonNullable<Query['page']>;
    shown: number;
    // the capped count, read once (`#cappedCollapsedCount`)
    counted: () => Promise<{ matched: number; kept: number } | undefined>;
  }): Promise<{ total: number; totalIsEstimate: boolean }> {
    let offset = (page.number ?? 0) * Number(page.size);
    let mode: PageTotalMode =
      page.exactTotal || page.total === 'exact'
        ? 'exact'
        : page.total === 'none'
          ? 'none'
          : 'capped';
    if (mode === 'none') {
      return { total: offset + shown, totalIsEstimate: true };
    }
    let exact = async () => {
      let [row] = await this.queryCards(
        this.collapsedNarrowPass({
          opts,
          sort: undefined,
          collapse,
          relevanceColumn: [],
          nearJoins: [],
          everyCondition,
          limitClause: [],
          countOnly: true,
        }),
        opts.timings,
        opts,
      );
      return { total: Number(row?.total ?? 0), totalIsEstimate: false };
    };
    if (mode === 'exact') {
      return await exact();
    }
    let count = await counted();
    if (!count) {
      return await exact();
    }
    return count.matched <= SEARCH_TOTAL_CAP
      ? { total: count.kept, totalIsEstimate: false }
      : {
          total: Math.max(count.kept, offset + shown),
          totalIsEstimate: true,
        };
  }

  // The kept rows among the filter's first `SEARCH_TOTAL_CAP` + 1 matches
  // (`collapsedCappedCount`); undefined for a filter that walks a plural
  // field, whose matches are not one row each.
  // The store's set of `filter`'s matches (store-facets.ts): a facet's,
  // when one counts over the same filter, else its own.
  async #storeSetOfFilter(
    filter: Filter | undefined,
    facetPlans: FacetPlan[],
    facetStoreSets: Map<FacetPlan, StoreFacetSet | undefined>,
    {
      realmURL,
      opts,
      entryType,
      condition,
    }: {
      realmURL: URL;
      opts: QueryOptions;
      entryType: 'instance' | 'file' | 'all';
      condition: CardExpression;
    },
  ): Promise<StoreFacetSet | undefined> {
    let own = facetPlans.find(
      (plan) =>
        plan.facet.own !== 'ignore' ||
        (filter &&
          stringify(filterWithout(filter, plan.facet.by) ?? null) ===
            stringify(filter)),
    );
    if (own) {
      return facetStoreSets.get(own);
    }
    return await this.storeFacetSet({
      realmURL,
      filter,
      opts,
      entryType,
      condition,
      facetPaths: [],
    });
  }

  async #cappedCollapsedCount(
    opts: QueryOptions,
    collapse: { by: string; on: CodeRef; keep: number },
    everyCondition: CardExpression,
  ): Promise<{ matched: number; kept: number } | undefined> {
    let capped = await this.makeExpression(
      this.collapsedCappedCount({
        opts,
        collapse,
        everyCondition,
        cap: SEARCH_TOTAL_CAP + 1,
      }),
      opts,
    );
    if (
      expressionToSql(this.dialect.kind, capped).text.includes(
        'CROSS JOIN LATERAL',
      )
    ) {
      return undefined;
    }
    let [row] = await this.query(capped, opts);
    return {
      matched: Number(row?.matched ?? 0),
      kept: Number(row?.kept ?? 0),
    };
  }

  // Projection-parametrized instance search. `_search` builds the shared query
  // core (WHERE / GROUP BY url / ORDER / LIMIT); this method varies only the
  // SELECT list by projection. `searchCards` and `searchPrerendered` are thin
  // wrappers, each fixing one projection.

  // Whether every match of `filter` is a card instance: the filter's own
  // type, or the type of one of its top-level conjuncts (a node's `on` or
  // `type` adds that type's test), is a card type.
  async #readsOnlyCards(filter: Filter): Promise<boolean> {
    let f = filter as unknown as Record<string, unknown>;
    let refs: CodeRef[] = [];
    let own = (f.on ?? f.type) as CodeRef | undefined;
    if (own) {
      refs.push(own);
    }
    for (let child of Array.isArray(f.every) ? f.every : []) {
      let c = child as Record<string, unknown> | null;
      let ref = c && typeof c === 'object' ? (c.on ?? c.type) : undefined;
      if (ref) {
        refs.push(ref as CodeRef);
      }
    }
    for (let ref of refs) {
      let definition = await this.getDefinition(ref).catch(() => undefined);
      if (definition?.type === 'card-def') {
        return true;
      }
    }
    return false;
  }
}

// The type a filter admits every card of, and nothing else tested: a
// `{ type }` filter, or one that only anchors a type (`{ on, every: [] }`).
// The type of a filter that admits exactly one type's cards: one that only
// anchors it, or whose only conjunct does.
function wholeTypeOf(filter: Filter): CodeRef | undefined {
  let own = onlyTypeOf(filter);
  if (own) {
    return own;
  }
  let every = (filter as { every?: Filter[] }).every;
  if (Object.keys(filter).length === 1 && every?.length === 1) {
    let [child] = every as unknown as Record<string, unknown>[];
    let keys = Object.keys(child ?? {});
    if (keys.length === 1 && (keys[0] === 'type' || keys[0] === 'on')) {
      return child[keys[0]] as CodeRef;
    }
  }
  return undefined;
}

function onlyTypeOf(filter: Filter): CodeRef | undefined {
  let keys = Object.keys(filter);
  if (keys.length === 1 && 'type' in filter) {
    return (filter as { type: CodeRef }).type;
  }
  if (
    keys.length === 2 &&
    'on' in filter &&
    'every' in filter &&
    (filter as { every: Filter[] }).every.length === 0
  ) {
    return (filter as { on: CodeRef }).on;
  }
  return undefined;
}
