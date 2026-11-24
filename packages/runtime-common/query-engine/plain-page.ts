// The plain page: a top-N read with no grouping and no materialized match
// set (filter-first under a GIN-served filter, the ordered walk past the
// cap), and a page's total by one rule for every source.
// Owns: `plainTopN` and `pageTotal`.
// Must not: change which rows match or their order: it answers what the
// grouped query would.
// Guarantees: docs/search.md ("Pagination", "The default pages, and paging
// past them", "Warnings": total-estimated).

import { Bindings } from './bindings.ts';
import { pageTotal } from './index-sql.ts';
import {
  type PlainPage,
  type QueryOptions,
  isBlendSort,
  isMatchRelevanceSort,
} from './types.ts';
import {
  type CardExpression,
  type Expression,
  expressionToSql,
  fieldQuery,
  param,
  separatedByCommas,
  sortDirection,
  tableValuedFunctionsPlaceholder,
} from '../expression.ts';
import type { CodeRef } from '../index.ts';
import {
  type PageTotalMode,
  type Sort,
  isExprSort,
} from '../query-v2/query.ts';
import { SEARCH_TOTAL_CAP } from '../search-bounds.ts';
import { isNearSort } from '../vector-query.ts';
import {
  notEffectivelyErrored,
  prerenderedJoin,
  tableFromOpts,
} from './index-sql.ts';
import { nullsPlacement } from './sort-sql.ts';
import { getField, isFieldPlural } from './filter-paths.ts';
import {
  ORDERED_READ_PAGE_END,
  orderedReadStatement,
  orderedReadTypes,
} from './value-store-order.ts';

// A plain page's filter that the search doc's GIN index serves: a
// containment or a SQL/JSON path test of `search_doc` (`#filterFirstPage`).
const INDEX_SERVED_FILTER = /\bsearch_(doc|keys) @[>?]/;

// The furthest row of a page `#orderedWalk` reads off an order index.
const ORDERED_WALK_MAX = 100;

interface PlainHydration {
  realm: string;
  select: CardExpression;
  // The query reads rows of one type only (`instance` or `file`, not both).
  oneType: boolean;
}

function plainPageRows(
  read: Record<string, unknown>[],
  size: number,
  hydrated: boolean,
): Pick<PlainPage, 'rows' | 'hydrated' | 'hasMore'> {
  let rows = read.filter((row) => row.url != null);
  return {
    rows: hydrated
      ? rows.map(({ __page_count: _count, __matches: _matches, ...row }) => row)
      : rows.slice(0, size).map(({ __matches: _matches, ...row }) => row),
    hydrated,
    hasMore: hydrated
      ? Number(read[0]?.__page_count) > size
      : rows.length > size,
  };
}

// Whether a page's rows can be read again by their row address (`ctid`).
// Only a read of `boxel_index` itself, a plain table (not partitioned, no
// inheritance, never a view here): a staging pass's rows are a derived table,
// which has no row address.
//
// A row address is used only inside the one statement that read it. The
// statement's snapshot keeps every row version it can see from being pruned
// or moved while it runs, so the address names the version the keys passed
// the filter on. It is never carried across statements, into a cursor, a
// cache, a key column or a response: a later statement may find another row,
// or none, at the same address. The key lookup it replaces was left to the
// planner's choice of index, and on a small table never analyzed the planner
// can take the realm's (realm_url, type) index for it and scan every row of
// the realm for each key.
function rowAddressed(opts: QueryOptions): boolean {
  return opts?.pendingStagingId === undefined;
}

// The page's order over the keys read in it. `type` breaks a tie on `url`
// only when the query reads both kinds of row: when it reads one, every key
// has that type, and ordering by it again would make the planner sort the
// page, since it cannot see through the keys' subquery that the column is a
// constant.
function plainPageOrder(sort: Sort, oneType: boolean): Expression {
  return separatedByCommas([
    ...sort.map((entry, i) => [
      `p._sort_${i}`,
      sortDirection(entry.direction),
      nullsPlacement(entry),
    ]),
    ['p.url COLLATE "POSIX"'],
    ...(oneType ? [] : [['p.type']]),
  ]) as Expression;
}

export abstract class PlainPaging extends Bindings {
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
    hydration,
    realm,
    storedCount,
    requiredTypes,
  }: {
    opts: QueryOptions;
    sort: Sort | undefined;
    page: { number?: number; size: number; total?: PageTotalMode };
    relevanceColumn: CardExpression;
    nearJoins: CardExpression;
    everyCondition: CardExpression;
    hydration?: PlainHydration;
    // The one realm searched (none for a union of realms).
    realm?: string;
    // The total of a search of a whole type, from the value store.
    storedCount?: () => Promise<number>;
    // The types every match is of, by the filter's own type tests.
    requiredTypes?: CodeRef[];
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
        // A page that is hydrated carries each key's row address, which its
        // hydration reads the row by (see `#hydratePlainPage`).
        `SELECT i.url AS url, i.type AS type${hydration ? (rowAddressed(opts) ? ', i.ctid AS __ctid' : ', i.realm_url AS realm_url') : ''}`,
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
    // The keys already passed every predicate in this snapshot. A single
    // realm's primary key identifies the same row the wide pass would read.
    if (!opts.reader || opts.exposeSortValues) hydration = undefined;
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
          hydration,
        })
      : undefined;
    if (filterFirst?.complete) {
      let { page: found } = filterFirst;
      let { hasMore, rows } = found;
      // The total as the count below would report it, from the matches
      // the read counted, which are every match; `none` reports only what
      // the page passed, as it does below.
      let exactlyCounted = !hasMore || requested === 'exact';
      return {
        ...found,
        total:
          !exactlyCounted && requested === 'none'
            ? offset + rows.length
            : filterFirst.matches,
        totalIsEstimate: !exactlyCounted && requested === 'none',
      };
    }
    // A sort by a number field reads the page off the value store's order
    // when the condition fills it soon enough (value-store-order.ts).
    let ordered = realm
      ? await this.#orderedRead({
          opts,
          sort: sort ?? [],
          realm,
          size,
          offset,
          sortColumns,
          orderKeys,
          everyCondition,
          requiredTypes: requiredTypes ?? [],
        })
      : undefined;
    let read = ordered
      ? ordered
      : filterFirst
        ? await this.#orderedWalk(keyExpression, sort, size + offset, opts)
        : await run(
            hydration
              ? await this.#hydratePlainPage(
                  keyExpression,
                  hydration,
                  opts,
                  sort ?? [],
                  size,
                )
              : keyExpression,
          );
    let found = plainPageRows(
      read,
      size,
      Boolean(hydration && !filterFirst && !ordered),
    );
    let { hasMore, rows } = found;
    if (filterFirst && hasMore && requested === 'capped') {
      // More matches than the cap, so the count stops past it, as below.
      return {
        ...found,
        total: Math.max(offset + rows.length, SEARCH_TOTAL_CAP),
        totalIsEstimate: true,
      };
    }
    return {
      ...found,
      ...(await pageTotal(
        size,
        page.total ?? 'exact',
        offset,
        rows.length,
        hasMore,
        async (cap) => {
          if (storedCount) {
            return await storedCount();
          }
          let [row] = (await run(
            await this.makeExpression(
              cap
                ? [
                    'SELECT COUNT(*) AS total FROM (SELECT 1',
                    ...from,
                    `LIMIT ${cap}) AS capped`,
                  ]
                : ['SELECT COUNT(*) AS total', ...from],
              opts,
            ),
          )) as { total: unknown }[];
          return Number(row?.total ?? 0);
        },
      )),
    };
  }

  // Limit the keys before reading the projection, so the lookahead row
  // contributes to hasMore without fetching its document or renderings.
  async #hydratePlainPage(
    keys: Expression,
    { select, oneType }: PlainHydration,
    opts: QueryOptions,
    sort: Sort,
    size: number,
    carriesTotal = false,
  ): Promise<Expression> {
    let order = plainPageOrder(sort, oneType);
    return [
      'SELECT h.*, p.__page_count',
      ...(carriesTotal ? [', p.__matches'] : []),
      'FROM (SELECT p.*, COUNT(p.url) OVER () AS __page_count FROM (',
      ...keys,
      ') AS p ORDER BY',
      ...order,
      'LIMIT',
      param(size),
      ') AS p LEFT JOIN LATERAL (',
      ...(await this.makeExpression(select, opts)),
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
      // Each key's row is read by its row address, from this statement's
      // snapshot (see `rowAddressed`).
      rowAddressed(opts)
        ? 'WHERE i.ctid = p.__ctid'
        : 'WHERE i.url = p.url AND i.type = p.type AND i.realm_url = p.realm_url',
      'GROUP BY i.url, i.type) AS h ON TRUE ORDER BY',
      ...order,
    ];
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
    hydration,
  }: {
    opts: QueryOptions;
    sortColumns: CardExpression;
    from: CardExpression;
    sort: Sort;
    orderKeys: CardExpression[];
    size: number;
    offset: number;
    bounded: boolean;
    hydration?: PlainHydration;
  }): Promise<{
    page: ReturnType<typeof plainPageRows>;
    matches: number;
    complete: boolean;
  }> {
    // The matches' keys first, counted; the sort values are read, and the
    // page taken, only when the read holds every match. The count rides on
    // every row, and on a row of its own when the page lies past the last
    // match.
    let expression = await this.makeExpression(
      [
        `WITH m AS MATERIALIZED (SELECT i.url AS url, i.realm_url AS realm_url, i.type AS type${rowAddressed(opts) ? ', i.ctid AS __ctid' : ''}`,
        ...from,
        ...(bounded ? [`LIMIT ${SEARCH_TOTAL_CAP + 1}`] : []),
        '), c AS (SELECT COUNT(*) AS n FROM m)',
        `SELECT p.*, c.n AS __matches FROM c LEFT JOIN LATERAL (SELECT i.url AS url, i.type AS type${hydration ? (rowAddressed(opts) ? ', i.ctid AS __ctid' : ', i.realm_url AS realm_url') : ''}`,
        ...sortColumns,
        // Each match's row is read again by its row address, from the same
        // statement's snapshot, so no lookup by key is left to the planner.
        `FROM m JOIN ${tableFromOpts(opts)} AS i ON ${rowAddressed(opts) ? 'i.ctid = m.__ctid' : 'i.url = m.url AND i.realm_url = m.realm_url AND i.type = m.type'}`,
        ...(bounded ? [`WHERE c.n <= ${SEARCH_TOTAL_CAP}`] : []),
        'ORDER BY',
        ...separatedByCommas(orderKeys),
        `LIMIT ${size + 1} OFFSET ${offset}) AS p ON TRUE ORDER BY`,
        ...plainPageOrder(sort, false),
      ],
      opts,
    );
    let statement = hydration
      ? await this.#hydratePlainPage(
          expression,
          hydration,
          opts,
          sort,
          size,
          true,
        )
      : expression;
    let read = () =>
      this.db(opts).withTransaction(async (q) => {
        await q([
          `SELECT set_config('enable_seqscan', 'off', true), set_config('enable_indexscan', 'off', true)`,
        ]);
        return await q(statement);
      });
    let all = (await (opts.timings
      ? opts.timings.busyTime('sqlExec', read)
      : read())) as Record<string, unknown>[];
    let matches = Number(all[0]?.__matches ?? 0);
    return {
      page: plainPageRows(all, size, Boolean(hydration)),
      matches,
      complete: !bounded || matches <= SEARCH_TOTAL_CAP,
    };
  }

  // The page's keys read off the value store's number or instant index in
  // the sort's order (value-store-order.ts), or undefined when the ordered
  // read does not apply or gives up: the first sort is a number, date or
  // date-time field of the type it names (on no list), missing values last,
  // on the promoted index of one
  // realm, and the page ends by `ORDERED_READ_PAGE_END`.
  async #orderedRead({
    opts,
    sort,
    realm,
    size,
    offset,
    sortColumns,
    orderKeys,
    everyCondition,
    requiredTypes,
  }: {
    opts: QueryOptions;
    sort: Sort;
    realm: string;
    size: number;
    offset: number;
    sortColumns: CardExpression;
    orderKeys: CardExpression[];
    everyCondition: CardExpression;
    requiredTypes: CodeRef[];
  }): Promise<Record<string, unknown>[] | undefined> {
    let first = sort[0];
    let pageEnd = offset + size + 1;
    if (
      !this.dialect.valueStore ||
      tableFromOpts(opts) !== 'boxel_index' ||
      opts.includeErrors ||
      !first ||
      !('on' in first) ||
      !first.on ||
      nullsPlacement(first) !== 'NULLS LAST' ||
      pageEnd > ORDERED_READ_PAGE_END
    ) {
      return undefined;
    }
    let on = first.on;
    let path = String(first.by);
    let kind = await this.#sortFieldKind(on, path);
    if (!kind) {
      return undefined;
    }
    let column: 'num' | 'ts' = kind === 'number' ? 'num' : 'ts';
    let form = kind === 'number' ? undefined : kind;
    // A second key on a number field, missing last, orders the tie group of
    // the walk's last value from the store too.
    let second = sort[1];
    let then =
      second &&
      'on' in second &&
      second.on &&
      nullsPlacement(second) === 'NULLS LAST' &&
      (await this.#sortFieldKind(second.on, String(second.by))) === 'number'
        ? {
            path: String(second.by),
            direction: (second.direction === 'desc' ? 'desc' : 'asc') as
              | 'asc'
              | 'desc',
          }
        : undefined;
    let run = async (query: CardExpression) =>
      await this.query(await this.makeExpression(query, opts), opts);
    // Only the types every match must be of are walked: the sort's, and
    // each a positive part of the filter tests (a type-only branch of an
    // `every`), so a narrower filter type does not walk its supertype's cards.
    let typeKeys: string[][] = [];
    for (let ref of [on, ...requiredTypes]) {
      typeKeys.push(await this.typeKeysFor(ref));
    }
    let types = await run(orderedReadTypes(realm, typeKeys));
    if (types.length === 0) {
      return undefined;
    }
    let statement = orderedReadStatement({
      realm,
      typeIds: types.map((t) => Number(t.id)),
      path,
      column,
      form,
      direction: first.direction === 'desc' ? 'desc' : 'asc',
      pageEnd,
      size,
      offset,
      join: prerenderedJoin(opts),
      cardCondition: everyCondition,
      select: ['SELECT i.url AS url, i.type AS type', ...sortColumns],
      orderKeys,
      ...(then ? { then } : {}),
    });
    let rows = (await (opts.timings
      ? opts.timings.busyTime('sqlExec', () => run(statement))
      : run(statement))) as Record<string, unknown>[];
    if (Number(rows[0]?.__walked ?? 0) < pageEnd) {
      return undefined;
    }
    return rows.map(({ __walked: _walked, ...row }) => row);
  }

  // The store's kind of the sort field `path` of `on`, when the ordered
  // read can walk it: a number, a date or a date-time, on no list.
  async #sortFieldKind(
    on: CodeRef,
    path: string,
  ): Promise<'number' | 'date' | 'datetime' | undefined> {
    try {
      let definition = await this.getDefinition(on);
      let names = path.split('.');
      for (let i = 0; i < names.length; i++) {
        let leaf = await getField(
          definition,
          names.slice(0, i + 1).join('.'),
          this.definitionLookup,
        );
        if (isFieldPlural(leaf)) {
          return undefined;
        }
        if (i === names.length - 1) {
          let name = leaf.serializerName;
          return name === 'number' || name === 'date' || name === 'datetime'
            ? name
            : undefined;
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
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
}
