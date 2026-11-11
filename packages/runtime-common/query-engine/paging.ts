// Paging and totals: the plain top-N read (ungrouped, filter-first under a
// GIN-served filter, the ordered walk past the cap), the keyed narrow pass
// and the wide pass of a page, the collapsed narrow pass, and a union's
// per-realm totals.
// Owns: which page strategy runs and the statements that read keys, counts
// and page rows.
// Must not: change which rows match or their order: every strategy answers
// what the grouped query would.
// Guarantees: docs/search.md ("Pagination", "The default pages, and paging
// past them", "Warnings": total-estimated).

import { Bindings } from './bindings.ts';
import {
  COLLAPSE_SIZE_KEY,
  type PlainPage,
  type QueryOptions,
  SORT_VALUES_KEY,
  isBlendSort,
  isMatchRelevanceSort,
} from './types.ts';
import {
  type CardExpression,
  type Expression,
  addExplicitParens,
  every,
  expressionToSql,
  fieldQuery,
  param,
  separatedByCommas,
  sortDirection,
  tableValuedFunctionsPlaceholder,
} from '../expression.ts';
import type { CodeRef } from '../index.ts';
import { type PageTotalMode, type Sort, isExprSort } from '../query.ts';
import { SEARCH_TOTAL_CAP } from '../search-bounds.ts';
import { isNearSort } from '../vector-query.ts';
import {
  notEffectivelyErrored,
  prerenderedJoin,
  tableFromOpts,
} from './index-sql.ts';
import { nullsPlacement, sortValuesOf } from './sort-sql.ts';
import { realmsOf } from '../realm-union.ts';

// A plain page's filter that the search doc's GIN index serves: a
// containment or a SQL/JSON path test of `search_doc` (`#filterFirstPage`).
const INDEX_SERVED_FILTER = /\bsearch_doc @[>?]/;

// The furthest row of a page `#orderedWalk` reads off an order index.
const ORDERED_WALK_MAX = 100;

export abstract class Paging extends Bindings {
  // The wide pass of a paged search: the projection for the rows the narrow
  // pass chose, in its order, each carrying the synthetic columns
  // (`_matchRelevance`, `_nearSimilarity`, `_blendScore`) the narrow pass
  // computed over the whole match set. Those are not recomputed here: a blend
  // ranks each signal across every match, so it cannot be recomputed over the
  // page. The filter is not applied either; the rows are known to match it,
  // and `baseConditions` keeps the realm, deletion and entry-kind rules. A row
  // deleted between the passes is dropped from the page.
  // A page as an ordered LIMIT over the matches, with no grouping and no
  // materialized match set, when the query allows it: no relevance, blend or near columns (they aggregate), and
  // no condition that joins a table-valued function (a plural field walked
  // with `jsonb_tree`, which yields several rows per match). Every other match
  // is then exactly one (url, type) row — `boxel_index` and `prerendered_html`
  // are both keyed (url, realm_url, type) and joined on that key — so the
  // `GROUP BY i.url, i.type` the general path needs changes nothing here, and
  // dropping it lets the planner read the page off an ordered index and stop.
  //
  // It reads one row past the page to answer `hasMore`, and counts the total
  // only as far as `page.total` asks: `exact` counts every match, `capped`
  // stops at `SEARCH_TOTAL_CAP`, `none` counts nothing. A page that has no next
  // page is exactly counted from its own rows, so the count query runs only
  // when there is more to count. Returns undefined when the query needs the
  // general path.
  protected async plainTopN({
    opts,
    sort,
    page,
    relevanceColumn,
    nearJoins,
    everyCondition,
  }: {
    opts: QueryOptions;
    sort: Sort | undefined;
    page: { number?: number; size: number; total?: PageTotalMode };
    relevanceColumn: CardExpression;
    nearJoins: CardExpression;
    everyCondition: CardExpression;
  }): Promise<PlainPage | undefined> {
    if (
      !this.dialect.plannerPaging ||
      relevanceColumn.length > 0 ||
      nearJoins.length > 0 ||
      Number(page.size) <= 0
    ) {
      return undefined;
    }
    if (
      (sort ?? []).some(
        (s) =>
          isExprSort(s) ||
          isBlendSort(s) ||
          isNearSort(s) ||
          isMatchRelevanceSort(s),
      )
    ) {
      return undefined;
    }
    let sortColumns: CardExpression = [];
    let orderKeys: CardExpression[] = [];
    (sort ?? []).forEach((s, i) => {
      let column =
        'on' in s && s.on
          ? fieldQuery(s.by, s.on, false, 'sort')
          : this.generalFieldSortColumn(s.by);
      sortColumns.push(', ', column, ` AS _sort_${i}`);
      orderKeys.push([column, sortDirection(s.direction), nullsPlacement(s)]);
    });
    orderKeys.push(['i.url COLLATE "POSIX"'], ['i.type']);
    let size = Number(page.size);
    let offset = (page.number ?? 0) * size;
    let from: CardExpression = [
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
      tableValuedFunctionsPlaceholder,
      'WHERE',
      ...everyCondition,
    ];
    let keyExpression = await this.makeExpression(
      [
        'SELECT i.url AS url, i.type AS type',
        ...sortColumns,
        ...from,
        'ORDER BY',
        ...separatedByCommas(orderKeys),
        `LIMIT ${size + 1} OFFSET ${offset}`,
      ],
      opts,
    );
    if (
      expressionToSql(this.dialect.kind, keyExpression).text.includes(
        'CROSS JOIN LATERAL',
      )
    ) {
      return undefined;
    }
    let run = (expression: Expression) =>
      opts.timings
        ? opts.timings.busyTime('sqlExec', () => this.query(expression, opts))
        : this.query(expression, opts);
    let requested: PageTotalMode = page.total ?? 'exact';
    // A filter the search doc's GIN index serves runs filter-first: the
    // matches are read through the index, counted, and the page taken from
    // them (`#filterFirstPage`). When they are more than the total counts
    // (past the cap), the page is read off the order instead.
    let filterFirst = INDEX_SERVED_FILTER.test(
      expressionToSql(this.dialect.kind, keyExpression).text,
    )
      ? await this.#filterFirstPage({
          opts,
          sortColumns,
          from,
          sort: sort ?? [],
          orderKeys,
          size,
          offset,
          bounded: requested !== 'exact',
        })
      : undefined;
    if (filterFirst?.complete) {
      let hasMore = filterFirst.rows.length > size;
      let keys = hasMore ? filterFirst.rows.slice(0, size) : filterFirst.rows;
      // The total as the count below would report it, from the matches
      // the read counted, which are every match; `none` reports only what
      // the page passed, as it does below.
      let exactlyCounted = !hasMore || requested === 'exact';
      return {
        keys,
        total:
          !exactlyCounted && requested === 'none'
            ? offset + keys.length
            : filterFirst.matches,
        hasMore,
        totalIsEstimate: !exactlyCounted && requested === 'none',
      };
    }
    let rows = (
      filterFirst
        ? await this.#orderedWalk(keyExpression, sort, size + offset, opts)
        : await run(keyExpression)
    ) as Record<string, unknown>[];
    let hasMore = rows.length > size;
    let keys = hasMore ? rows.slice(0, size) : rows;
    if (filterFirst && hasMore && requested === 'capped') {
      // More matches than the cap, so the count stops past it, as below.
      return {
        keys,
        total: Math.max(offset + keys.length, SEARCH_TOTAL_CAP),
        hasMore,
        totalIsEstimate: true,
      };
    }
    if (!hasMore && (keys.length > 0 || offset === 0)) {
      return {
        keys,
        total: offset + keys.length,
        hasMore,
        totalIsEstimate: false,
      };
    }
    // Counting stops past the cap when the query asks for `capped`: a page
    // needs its rows and whether more follow, and an exact count of a large
    // match set costs a full pass for a number shown as "1,000+". A query
    // that names no mode is counted exactly, as the older spelling always
    // was; the newer spelling's lowering names `capped` (`lowerQuery`).
    // A page past the last match has no next page either, so it is counted
    // exactly whatever the mode (the documented rule): its own rows say
    // nothing about how many matches lie before it.
    let mode: PageTotalMode = hasMore ? (page.total ?? 'exact') : 'exact';
    if (mode === 'none') {
      // Nothing is counted: the total is the rows up to and on this page,
      // and `hasMore` says whether more follow.
      return {
        keys,
        total: offset + keys.length,
        hasMore,
        totalIsEstimate: true,
      };
    }
    if (mode === 'capped') {
      let [row] = (await run(
        await this.makeExpression(
          [
            'SELECT COUNT(*) AS total FROM (SELECT 1',
            ...from,
            `LIMIT ${SEARCH_TOTAL_CAP + 1}) AS capped`,
          ],
          opts,
        ),
      )) as { total: unknown }[];
      let counted = Number(row?.total ?? 0);
      return {
        keys,
        // A count under the cap is the count. Past it, the total is the
        // cap, and never below the rows already passed: a deep page past
        // the cap still has at least that many matches.
        total:
          counted <= SEARCH_TOTAL_CAP
            ? counted
            : Math.max(offset + keys.length, SEARCH_TOTAL_CAP),
        hasMore,
        totalIsEstimate: counted > SEARCH_TOTAL_CAP,
      };
    }
    let [row] = (await run(
      await this.makeExpression(['SELECT COUNT(*) AS total', ...from], opts),
    )) as { total: unknown }[];
    return {
      keys,
      total: Number(row?.total ?? 0),
      hasMore,
      totalIsEstimate: false,
    };
  }

  // A plain page read filter-first: the keys of every match, read through
  // the GIN index that serves the filter's predicate, then counted, and, when
  // that is every match, ordered and paged among themselves, in one
  // statement. `bounded` stops at one past `SEARCH_TOTAL_CAP`: `complete`
  // then says whether that was every match, and past it no sort value is
  // read and no page is taken.
  //
  // Postgres cannot estimate how many cards a containment or a path test of
  // the search doc admits (the docs are too wide for its statistics), so it
  // assumes a share of the rows and may read a page by walking the realm's
  // order index, testing card after card until the page fills. That walk
  // decompresses each card's search doc; when few cards match it reads the
  // whole realm (a 20-value `in` over 50,000 cards: 16.7 s). Here index
  // scans and sequential scans are turned off for this statement alone (in
  // a savepoint, or a transaction of its own), so the matches are read as a
  // bitmap of the index's candidates: the cost follows the number of
  // matches, never the size of the realm. A filter that admits more than the
  // cap leaves the page to `#orderedWalk`, which the matches then fill
  // quickly.
  async #filterFirstPage({
    opts,
    sortColumns,
    from,
    sort,
    orderKeys,
    size,
    offset,
    bounded,
  }: {
    opts: QueryOptions;
    sortColumns: CardExpression;
    from: CardExpression;
    sort: Sort;
    orderKeys: CardExpression[];
    size: number;
    offset: number;
    bounded: boolean;
  }): Promise<{
    rows: Record<string, unknown>[];
    matches: number;
    complete: boolean;
  }> {
    let pageOrder = separatedByCommas([
      ...sort.map((s, i) => [
        `p._sort_${i}`,
        sortDirection(s.direction),
        nullsPlacement(s),
      ]),
      ['p.url COLLATE "POSIX"'],
      ['p.type'],
    ]);
    // The matches' keys first, counted; the sort values are read, and the
    // page taken, only when the read holds every match. The count rides on
    // every row, and on a row of its own when the page lies past the last
    // match.
    let expression = await this.makeExpression(
      [
        'WITH m AS MATERIALIZED (SELECT i.url AS url, i.realm_url AS realm_url, i.type AS type',
        ...from,
        ...(bounded ? [`LIMIT ${SEARCH_TOTAL_CAP + 1}`] : []),
        '), c AS (SELECT COUNT(*) AS n FROM m)',
        'SELECT p.*, c.n AS __matches FROM c LEFT JOIN LATERAL (SELECT i.url AS url, i.type AS type',
        ...sortColumns,
        `FROM m JOIN ${tableFromOpts(opts)} AS i ON i.url = m.url AND i.realm_url = m.realm_url AND i.type = m.type`,
        ...(bounded ? [`WHERE c.n <= ${SEARCH_TOTAL_CAP}`] : []),
        'ORDER BY',
        ...separatedByCommas(orderKeys),
        `LIMIT ${size + 1} OFFSET ${offset}) AS p ON TRUE ORDER BY`,
        ...pageOrder,
      ],
      opts,
    );
    let read = () =>
      this.db(opts).withTransaction(async (q) => {
        await q([
          `SELECT set_config('enable_seqscan', 'off', true), set_config('enable_indexscan', 'off', true)`,
        ]);
        return await q(expression);
      });
    let all = (await (opts.timings
      ? opts.timings.busyTime('sqlExec', read)
      : read())) as Record<string, unknown>[];
    let matches = Number(all[0]?.__matches ?? 0);
    let rows = all.filter((row) => row.url != null);
    return {
      rows: rows.map(({ __matches: _m, ...key }) => key),
      matches,
      complete: !bounded || matches <= SEARCH_TOTAL_CAP,
    };
  }

  // The keys of a plain page read off an order index, for a filter
  // `#filterFirstPage` found to admit more than the cap. Postgres may
  // still misjudge the filter as selective and read every match to sort
  // them; with that many matches, the walk fills a page within about
  // (page end x realm size / cap) cards. So when the order is one an index
  // gives (the realm's url order, or newest first by modification or
  // creation), the page ends early in it, and the filter tests the row's
  // own columns, bitmap and sequential scans are turned off for the
  // statement. Otherwise the statement runs as planned.
  async #orderedWalk(
    keyExpression: Expression,
    sort: Sort | undefined,
    pageEnd: number,
    opts: QueryOptions,
  ): Promise<Record<string, unknown>[]> {
    let indexOrdered =
      !sort ||
      sort.length === 0 ||
      (sort.length === 1 &&
        !('on' in sort[0] && sort[0].on) &&
        ['lastModified', 'createdAt'].includes(String(sort[0].by)) &&
        sort[0].direction === 'desc' &&
        nullsPlacement(sort[0]) === 'NULLS LAST');
    // Only a filter of the row's own columns: a subquery (a text search, a
    // title's trigrams) reads its own index by a bitmap, which the walk's
    // settings would take away from it.
    let text = expressionToSql(this.dialect.kind, keyExpression).text;
    let ownColumns = !/\(SELECT|@@|ILIKE/.test(
      text.split(notEffectivelyErrored(opts)).join(''),
    );
    let walk = () =>
      indexOrdered && ownColumns && pageEnd < ORDERED_WALK_MAX
        ? this.db(opts).withTransaction(async (q) => {
            await q([
              `SELECT set_config('enable_seqscan', 'off', true), set_config('enable_bitmapscan', 'off', true)`,
            ]);
            return await q(keyExpression);
          })
        : this.query(keyExpression, opts);
    return (await (opts.timings
      ? opts.timings.busyTime('sqlExec', walk)
      : walk())) as Record<string, unknown>[];
  }

  protected async pageRows(
    keys: Record<string, unknown>[],
    selectClauseExpression: CardExpression,
    baseConditions: CardExpression[],
    opts: QueryOptions,
    sort?: Sort,
  ): Promise<Record<string, unknown>[]> {
    let urls = [...new Set(keys.map((key) => String(key.url)))];
    let sortKinds = opts.exposeSortValues
      ? await this.sortValueKinds(sort)
      : [];
    let rows = (await this.queryCards(
      [
        ...selectClauseExpression,
        ', i.type AS __page_type',
        `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
        'WHERE',
        ...every([
          ...baseConditions,
          [
            'i.url IN',
            ...addExplicitParens(
              separatedByCommas(urls.map((url) => [param(url)])),
            ),
          ],
        ]),
        'GROUP BY i.url, i.type',
      ],
      opts.timings,
      opts,
    )) as Record<string, unknown>[];
    let byKey = new Map(
      rows.map((row) => [`${row.__page_type} ${row.url}`, row]),
    );
    let page: Record<string, unknown>[] = [];
    for (let key of keys) {
      let row = byKey.get(`${key.type} ${key.url}`);
      if (!row) {
        continue;
      }
      let { __page_type: _type, ...columns } = row;
      // The key row's own columns are the synthetic sort columns, plus the
      // narrow pass's bookkeeping, which stays behind: its key, the total, the
      // facets, the per-facet values, and the sort keys it ordered by.
      let synthetic = Object.fromEntries(
        Object.entries(key).filter(
          ([name]) =>
            name !== 'url' &&
            name !== 'type' &&
            !name.startsWith('__') &&
            !/^_sort_\d+$/.test(name),
        ),
      );
      page.push({
        ...columns,
        ...synthetic,
        ...(opts.exposeSortValues
          ? { [SORT_VALUES_KEY]: sortValuesOf(key, sort, sortKinds) }
          : {}),
      });
    }
    return page;
  }

  // The narrow pass on Postgres. The match set is one materialized CTE: the
  // filter runs once, and the outer query orders and limits the page and
  // carries the total as a column, computed once over the whole set.
  protected pgNarrowPass({
    opts,
    sort,
    relevanceColumn,
    nearJoins,
    everyCondition,
    limitClause,
  }: {
    opts: QueryOptions;
    sort: Sort | undefined;
    relevanceColumn: CardExpression;
    nearJoins: CardExpression;
    everyCondition: CardExpression;
    limitClause: string[];
  }): CardExpression {
    let { innerSortColumns, outerOrderBy } = this.wrappedOrderExpression(sort);
    return [
      'WITH m AS MATERIALIZED (',
      'SELECT i.url AS url, i.type AS type',
      ...relevanceColumn,
      ...innerSortColumns,
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
      ...nearJoins,
      tableValuedFunctionsPlaceholder,
      'WHERE',
      ...everyCondition,
      'GROUP BY i.url, i.type',
      ')',
      'SELECT m.*, COUNT(*) OVER () AS __page_total',
      'FROM m',
      ...outerOrderBy,
      ...limitClause,
    ];
  }

  // The narrow pass of a collapsed search: every match's key and sort
  // values, as in a paged search, plus its group's value at `collapse.by`.
  // Each group keeps its best `keep` rows by the query's order (a match with
  // no value is a group of its own), and the total counts what is kept.
  // Each kept row carries its group's size, every match in it, so a caller
  // can say how many more a row stands for (`meta._collapseSize`).
  protected collapsedNarrowPass({
    opts,
    sort,
    collapse,
    relevanceColumn,
    nearJoins,
    everyCondition,
    limitClause,
    countOnly = false,
    countByRealm = false,
  }: {
    opts: QueryOptions;
    sort: Sort | undefined;
    collapse: { by: string; on: CodeRef; keep: number };
    relevanceColumn: CardExpression;
    nearJoins: CardExpression;
    everyCondition: CardExpression;
    limitClause: string[];
    countOnly?: boolean;
    // the kept rows counted by the realm each is in (a realm union)
    countByRealm?: boolean;
  }): CardExpression {
    let { innerSortColumns, outerOrderBy } = this.wrappedOrderExpression(sort);
    let kept: CardExpression = [
      'WITH m AS (',
      'SELECT i.url AS url, i.type AS type',
      ...(countByRealm ? [', ANY_VALUE(i.realm_url) AS __realm'] : []),
      ...relevanceColumn,
      ...innerSortColumns,
      ', ANY_VALUE(',
      fieldQuery(collapse.by, collapse.on, false, 'sort'),
      ') AS __collapse',
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
      ...nearJoins,
      tableValuedFunctionsPlaceholder,
      'WHERE',
      ...everyCondition,
      'GROUP BY i.url, i.type',
      '), c AS (',
      'SELECT m.*, ROW_NUMBER() OVER (PARTITION BY COALESCE(CAST(m.__collapse AS TEXT), m.url)',
      ...outerOrderBy,
      ') AS __collapse_rank,',
      `COUNT(*) OVER (PARTITION BY COALESCE(CAST(m.__collapse AS TEXT), m.url)) AS "${COLLAPSE_SIZE_KEY}"`,
      'FROM m',
      ')',
    ];
    if (countByRealm) {
      return [
        ...kept,
        `SELECT c.__realm AS realm_url, COUNT(*) AS total FROM c WHERE c.__collapse_rank <= ${Number(collapse.keep)} GROUP BY c.__realm`,
      ];
    }
    if (countOnly) {
      return [
        ...kept,
        `SELECT COUNT(*) AS total FROM c WHERE c.__collapse_rank <= ${Number(collapse.keep)}`,
      ];
    }
    return [
      ...kept,
      'SELECT c.*, COUNT(*) OVER () AS __page_total FROM c',
      `WHERE c.__collapse_rank <= ${Number(collapse.keep)}`,
      ...outerOrderBy,
      ...limitClause,
    ];
  }

  // How many of a union search's matches each realm holds, over the
  // search's own conditions (`everyCondition`), in its snapshot. Under
  // `collapse` it counts the rows collapse keeps, each in the realm of the
  // copy kept. Every realm of the union is listed, with 0 where it holds
  // none.
  protected async unionRealmTotals(
    union: URL,
    opts: QueryOptions,
    everyCondition: CardExpression,
    {
      collapse,
      sort,
      relevanceColumn,
      nearJoins,
    }: {
      collapse: { by: string; on: CodeRef; keep: number } | undefined;
      sort: Sort | undefined;
      relevanceColumn: CardExpression;
      nearJoins: CardExpression;
    },
  ): Promise<Record<string, number>> {
    let rows = await this.queryCards(
      collapse
        ? this.collapsedNarrowPass({
            opts,
            sort,
            collapse,
            relevanceColumn,
            nearJoins,
            everyCondition,
            limitClause: [],
            countByRealm: true,
          })
        : [
            'SELECT d.realm_url AS realm_url, COUNT(*) AS total FROM (',
            'SELECT DISTINCT i.url, i.type, i.realm_url',
            `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)} ${tableValuedFunctionsPlaceholder}`,
            'WHERE',
            ...everyCondition,
            ') AS d GROUP BY d.realm_url',
          ],
      opts.timings,
      opts,
    );
    let totals: Record<string, number> = Object.fromEntries(
      realmsOf(union).map((realm) => [realm, 0]),
    );
    for (let row of rows) {
      totals[String(row.realm_url)] = Number(row.total);
    }
    return totals;
  }
}
