// The narrow pass of a collapsed search: each group's best rows by the
// query's order, and the group's size on each kept row.
// Owns: `collapsedNarrowPass`.
// Must not: change which rows match or their order within a group.
// Guarantees: docs/search.md ("Collapsing to one per group (`collapse`)").

import { COLLAPSE_SIZE_KEY, type QueryOptions } from './types.ts';
import {
  type CardExpression,
  fieldQuery,
  tableValuedFunctionsPlaceholder,
} from '../expression.ts';
import type { CodeRef } from '../index.ts';
import type { Sort } from '../query-v2/query.ts';
import { prerenderedJoin, tableFromOpts } from './index-sql.ts';
import { Paging } from './paging.ts';

export abstract class CollapsePaging extends Paging {
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
}
