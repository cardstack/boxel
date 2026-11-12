// The search pipeline (`_search`): one query from arrival to answer, in the
// order docs/search.md ("Evaluation order") documents: snapshot, refusals
// before any read, time zone, lowering the newer spelling, labels, checks,
// one-card bindings, the window, bindings and text rewrites, base
// conditions, filter, collapse, relevance and near columns, count, page,
// facets, passages, the exact retry of a starved near page, and warnings.
// Owns: the order of those steps and the answer's `meta`.
// Must not: hold a step's logic: each step is a call into its layer.
// Guarantees: docs/search.md ("How a query is evaluated").

import { BXL_FORMULA_FUNCTIONS } from '@cardstack/bxl/compiler';
import {
  type CardExpression,
  addExplicitParens,
  any,
  every,
  param,
  separatedByCommas,
  tableValuedFunctionsPlaceholder,
} from '../expression.ts';
import { baseCardRef } from '../index.ts';
import { Columns } from './columns.ts';
import {
  DEFAULT_TIME_ZONE,
  assertPostgresKnowsTimeZone,
  assertTimeZone,
  clockInZone,
  isUtcZone,
} from '../time-zone.ts';
import {
  FORMULA_KEY,
  type FilterContext,
  type IndexRowWithHtml,
  type PlainPage,
  type QueryOptions,
  type QueryResultsMeta,
  isBlendSort,
  isMatchRelevanceSort,
} from './types.ts';
import {
  type Facet,
  type FacetStats,
  type Filter,
  InvalidQueryError,
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
import { TOTAL_ESTIMATED, totalEstimatedMessage } from '../search-bounds.ts';
import {
  notEffectivelyErrored,
  prerenderedJoin,
  prerenderedTableFromOpts,
  tableFromOpts,
} from './index-sql.ts';
import { explainRows } from './sort-sql.ts';
import { filterAnchor } from './filter-sql.ts';
import { filterWithout } from './facet-sql.ts';
import { unwrapLiterals } from '../binding-reference.ts';
import { isFilterRefersToNonexistentTypeError } from '../definition-lookup.ts';
import { isRealmUnion, realmIs } from '../realm-union.ts';
import {
  lowerQuery,
  queryHasLabels,
  resolveQueryLabels,
  usesNewSyntax,
} from '../query-syntax.ts';
import { resolveTypeReferences } from '../type-reference.ts';
import { restoreSpilledSearchDocs } from '../search-doc-spill.ts';

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

export abstract class SearchPipeline extends Columns {
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
      return await this.inSnapshot(opts, (inSnapshot) =>
        this._search(
          realmURL,
          asWritten,
          inSnapshot,
          selectClauseExpression,
          entryType,
        ),
      );
    }
    // A caller's `typeahead` is refused before anything runs: type-ahead is
    // `{ matches, prefix: true, scope: 'title' }`, which the engine rewrites
    // to an internal node of that old name (below), so only the outermost
    // search checks what it was handed.
    if (!opts.zoneResolved) {
      assertNoTypeAheadOperator(asWritten);
      // Postgres features (a regex, an expression, a facet) are refused
      // before anything reads the index, the realm's time zone included, so
      // a browser (SQLite) search never runs a statement for them.
      this.dialect.assertRunnable(asWritten);
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
        let out = await this._search(
          realmURL,
          asWritten,
          {
            ...opts,
            timeZone: zone,
            zoneResolved: true,
            queryNow: clockInZone(opts.queryNow!, zone),
          },
          selectClauseExpression,
          entryType,
        );
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
        throw new InvalidQueryError(
          `"${bracketed[0]}" is not a field: a list is named without [] (write "${bracketed[0].replace(/\[\]/g, '')}")`,
          'unknown-field',
        );
      }
    }
    // Type-ahead (`{ matches, prefix: true, scope: 'title' }`) runs as the
    // engine's own type-ahead node. A binding's or comparison set's query
    // passes through here too, as its own search.
    filter = lowerTitlePrefixMatches(filter);
    sort = lowerTitlePrefixMatchesInSort(sort);
    await this.assertKnownModules({ filter, sort, collapse, facets, rerank });
    await this.assertExpressions(filter, sort, rerank, lets, realmURL, opts);
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
        throw new InvalidQueryError(
          `page: size and number are whole numbers of at least 0, and the page must start at a row a search can count to (size ${String(page.size)}, number ${String(page.number ?? 0)})`,
          'invalid-page',
        );
      }
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
    // word statistics, broad matches, relevance sorts, plain facets), so the
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
      filter = await this.prepareWordStatistics(filter, realmURL, anonymize);
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
      // Each facet is counted by its own queries over the facet table
      // (`extendedFacet`), over the same match set as the page.
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
      // render error is excluded from the mixed scope too.
      let notErrored: CardExpression = [notEffectivelyErrored(opts)];
      if (entryType === 'all') {
        // Mixed scope. Instance rows follow `includeErrors` (their error
        // markup is rendered through the html branch); file rows are only
        // ever surfaced in a healthy state, so they always require
        // `has_error` false regardless of `includeErrors`.
        let instanceBranch: CardExpression = opts.includeErrors
          ? ['i.type =', param('instance')]
          : every([['i.type =', param('instance')], notErrored]);
        let fileBranch = every([['i.type =', param('file')], notErrored]);
        conditions.push(any([instanceBranch, fileBranch]));
      } else if (opts.includeErrors) {
        conditions.push(['i.type =', param(entryType)]);
      } else {
        conditions.push(every([['i.type =', param(entryType)], notErrored]));
      }

      // A card-instance `.json` is dual-indexed: an `instance` row and a
      // `file` row sharing the same `i.url`, distinguished only by `i.type`.
      // `GROUP BY i.url, i.type` (below) keeps them as two distinct rows so a
      // mixed query surfaces both; a consumer that wants to dedup the `file`
      // row filters on the `_isCardInstanceFile` search-doc key (stamped only on
      // that row) — e.g. `eq: { _isCardInstanceFile: false }` keeps cards + plain
      // files and drops the card `.json`.

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
      if (opts.grantFilter) {
        conditions.push(
          this.filterCondition(opts.grantFilter, baseCardRef, 'positive', {
            inAny: false,
            prerenderedTable: prerenderedTableFromOpts(opts),
            now: opts.queryNow,
            indexTable: tableFromOpts(opts),
            realmURL,
          }),
        );
      }

      // Everything but the filter: the wide pass of a paged search reads its
      // page's rows under these alone (see `pageRows`).
      let baseConditions = [...conditions];

      // How this search's near sorts, signals and filters run: exactly, or
      // through an approximate index (see vector-query.ts).
      let grantFilter = opts.grantFilter;
      let nearCtx = new NearContext({
        exact: opts.nearExact,
        page,
        reader: opts.reader,
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
        await this.assertNearFilters(filter, baseCardRef, realmURL, nearCtx);
        conditions.push(
          this.filterCondition(filter, baseCardRef, 'positive', {
            inAny: false,
            prerenderedTable: prerenderedTableFromOpts(opts),
            now: opts.queryNow,
            indexTable: tableFromOpts(opts),
            realmURL,
          }),
        );
      }

      let everyCondition = every(conditions);
      let collapsed = collapseBy(collapse);
      let collapseOn = collapsed?.on ?? filterAnchor(filter);
      if (collapsed && !collapseOn) {
        throw new InvalidQueryError(
          `collapse by "${collapsed.by}" needs a type: give it \`on\` or anchor the filter on a type`,
          'needs-type',
        );
      }
      let limitClause = page
        ? [`LIMIT ${page.size} OFFSET ${(page.number ?? 0) * page.size}`]
        : [];

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
          throw new InvalidQueryError(
            `sort by textRelevance requires at least one positive \`matches\` filter`,
            'matches-required',
          );
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
      let { nearColumns, nearJoins } = await this.vectors.nearSortExpressions(
        sort,
        realmURL,
        nearCtx,
      );
      let { blendColumns, blendJoins } = await this.blendSortExpressions(
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
      if (collapsed && collapseOn) {
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
            everyCondition,
            limitClause,
          }),
          opts.timings,
          opts,
        );
        if (keys.length > 0) {
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
          hydration: isRealmUnion(realmURL)
            ? undefined
            : { realm: realmURL.href, select: selectClauseExpression },
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
        if (this.dialect.plannerPaging) {
          keys = await this.queryCards(
            this.pgNarrowPass({
              opts,
              sort,
              relevanceColumn,
              nearJoins,
              everyCondition,
              limitClause,
            }),
            opts.timings,
            opts,
          );
        } else {
          let keyQuery: CardExpression = [
            'SELECT i.url AS url, i.type AS type, COUNT(*) OVER () AS __page_total',
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
          keys = await this.queryCards(keyQuery, opts.timings, opts);
        }
        if (keys.length > 0) {
          totalResults = [{ total: keys[0].__page_total }];
        } else if ((page.number ?? 0) === 0 && Number(page.size) > 0) {
          // No match: no count. A counts-only page (`size: 0`) returns no row
          // whether or not anything matched, so it takes the fallback below.
          totalResults = [{ total: 0 }];
        } else {
          // A page past the last match has no row to carry the count, so it
          // comes from its own query.
          totalResults = await this.queryCards(queryCount, opts.timings, opts);
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
      // A projection that returns `search_doc` (file rows) returns it whole.
      await restoreSpilledSearchDocs(this.db(opts), results);
      if (explain) {
        explainRows(results, sort);
      }

      let filterContext: FilterContext = {
        inAny: false,
        prerenderedTable: prerenderedTableFromOpts(opts),
        now: opts.queryNow,
        indexTable: tableFromOpts(opts),
        realmURL,
      };
      let extendedPlans = facetPlans;
      let batchedCounts = await this.batchValueFacets(
        extendedPlans,
        opts,
        everyCondition,
        realmURL,
      );
      let extendedResults = await Promise.all(
        extendedPlans.map(async (plan) => {
          let counts = batchedCounts.get(plan);
          if (counts) {
            return { counts, stats: undefined };
          }
          let condition = everyCondition;
          if (plan.facet.own === 'ignore') {
            let rest = filter
              ? filterWithout(filter, plan.facet.by)
              : undefined;
            condition = every([
              ...baseConditions,
              ...(rest
                ? [
                    this.filterCondition(
                      rest,
                      baseCardRef,
                      'positive',
                      filterContext,
                    ),
                  ]
                : []),
            ]);
          }
          return this.extendedFacet(plan, opts, condition, realmURL);
        }),
      );
      let extendedByFacet = new Map(
        extendedPlans.map((plan, i) => [plan.facet, extendedResults[i]]),
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
        let exact = await this._search(
          realmURL,
          asWritten,
          { ...opts, nearExact: true },
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
      let totalWarning =
        candidatesCapped || plainPage?.totalIsEstimate
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
        !plainPage?.totalIsEstimate &&
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
      if (isFilterRefersToNonexistentTypeError(error)) {
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
        throw new InvalidQueryError(
          `expression: its value overflows a number in SQL for some row: ${overflowing.map((e: string) => JSON.stringify(e)).join(', ')}`,
          'limit-exceeded',
        );
      }
      throw error;
    }
  }

  // Projection-parametrized instance search. `_search` builds the shared query
  // core (WHERE / GROUP BY url / ORDER / LIMIT); this method varies only the
  // SELECT list by projection. `searchCards` and `searchPrerendered` are thin
  // wrappers, each fixing one projection.
}
