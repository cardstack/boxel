// Paging: the keyed narrow pass and the wide pass of a page. The plain
// top-N read and a page's total are in plain-page.ts, the collapsed narrow
// pass in collapse-paging.ts, a union's per-realm totals in union-totals.ts.
// Owns: the statements that read a page's keys and its rows.
// Must not: change which rows match or their order: every strategy answers
// what the grouped query would.
// Guarantees: docs/search.md ("Pagination", "The default pages, and paging
// past them", "Warnings": total-estimated).

import { PlainPaging } from './plain-page.ts';
import { type QueryOptions, SORT_VALUES_KEY } from './types.ts';
import {
  type CardExpression,
  addExplicitParens,
  every,
  param,
  separatedByCommas,
  tableValuedFunctionsPlaceholder,
} from '../expression.ts';
import type { Sort } from '../query.ts';
import { prerenderedJoin, tableFromOpts } from './index-sql.ts';
import { sortValuesOf } from './sort-sql.ts';

export abstract class Paging extends PlainPaging {
  // The wide pass of a paged search: the projection for the rows the narrow
  // pass chose, in its order, each carrying the synthetic columns
  // (`_matchRelevance`, `_nearSimilarity`, `_blendScore`) the narrow pass
  // computed over the whole match set. Those are not recomputed here: a blend
  // ranks each signal across every match, so it cannot be recomputed over the
  // page. The filter is not applied either; the rows are known to match it,
  // and `baseConditions` keeps the realm, deletion and entry-kind rules. A row
  // deleted between the passes is dropped from the page.
  protected async pageRows(
    keys: Record<string, unknown>[],
    selectClauseExpression: CardExpression,
    baseConditions: CardExpression[],
    opts: QueryOptions,
    sort?: Sort,
  ): Promise<Record<string, unknown>[]> {
    let urls = [...new Set(keys.map((key) => String(key.url)))];
    // A card and its file can share a URL. When the page chose one type,
    // hydrate only that type instead of loading both and discarding one.
    let type = keys[0]?.type;
    let typeCondition: CardExpression[] =
      typeof type === 'string' && keys.every((key) => key.type === type)
        ? [['i.type =', param(type)]]
        : [];
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
          ...typeCondition,
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
    facets,
    matches: given,
  }: {
    opts: QueryOptions;
    sort: Sort | undefined;
    relevanceColumn: CardExpression;
    nearJoins: CardExpression;
    everyCondition: CardExpression;
    limitClause: string[];
    // The facets' CTEs and columns over the match set `m` (`facetSql`).
    facets?: { ctes: CardExpression[]; columns: CardExpression };
    // The match set `m` as given, `WITH` included, in place of the one read
    // by `everyCondition` (a counts-only page, so no sort column).
    matches?: CardExpression;
  }): CardExpression {
    let { innerSortColumns, outerOrderBy } = this.wrappedOrderExpression(sort);
    let matches: CardExpression = given ?? [
      'WITH m AS MATERIALIZED (',
      'SELECT i.url AS url, i.type AS type',
      ...(facets
        ? [
            ', ANY_VALUE(i.realm_url) AS __realm_url, ANY_VALUE(i.types ->> 0) AS __type_key',
          ]
        : []),
      ...relevanceColumn,
      ...innerSortColumns,
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
      ...nearJoins,
      tableValuedFunctionsPlaceholder,
      'WHERE',
      ...everyCondition,
      'GROUP BY i.url, i.type',
      ')',
    ];
    let page: CardExpression = [
      'SELECT m.*, COUNT(*) OVER () AS __page_total',
      'FROM m',
      ...outerOrderBy,
      ...limitClause,
    ];
    if (!facets) {
      return [...matches, ...page];
    }
    // With the facets, one row always comes back to carry them and the
    // match count, page or no page (its page columns then null).
    return [
      ...matches,
      ...facets.ctes.flatMap((cte) => [',', ...cte]),
      'SELECT p.*, (SELECT COUNT(*) FROM m) AS __match_total,',
      ...facets.columns,
      'FROM (SELECT 1) AS one LEFT JOIN LATERAL (',
      ...page,
      ') AS p ON TRUE',
    ];
  }
}
