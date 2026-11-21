// A near filter beside a selective filter: when the rest of the query's
// filter admits few cards, a near filter over a single-valued field compares
// those cards' vectors exactly instead of reading the space's index.
// Owns: `besideNearFilters`, `cappedMatchCount`.
// Must not: change which cards a near filter admits; it only chooses the
// path (see `NearContext#fewBesideNearFilters`).
// Guarantees: docs/search.md ("Vector search (`near`)").
//
// Practice: a filtered vector search that pre-filters when the filter is
// selective and walks the index otherwise (Weaviate's and Qdrant's filtered
// HNSW, Elasticsearch's kNN falling back to exact search over a small
// filtered set). Boxel's mapping: the filter's clauses that hold no near
// filter are counted, stopping one past `filterCandidates` (1,000); no more
// than that many cards, at one vector each, cost less to compare exactly
// than the index read, which walks at least as many vectors, and the exact
// comparison admits every card within the threshold.

import type { Filter } from '../query.ts';
import {
  type CardExpression,
  tableValuedFunctionsPlaceholder,
} from '../expression.ts';
import type { QueryOptions } from './types.ts';
import { prerenderedJoin, tableFromOpts } from './index-sql.ts';

// The conjunction of a filter's top-level clauses that hold no near filter,
// anchored as the filter is: every card a near filter among the others can
// admit passes it. Undefined when the filter is no conjunction with a near
// filter among its clauses, or nothing but near filters stands beside them.
export function besideNearFilters(filter: Filter): Filter | undefined {
  if (!('every' in filter)) {
    return undefined;
  }
  let kept = filter.every.filter((child) => !holdsNearFilter(child));
  if (kept.length === filter.every.length) {
    return undefined;
  }
  if (kept.length === 0 && !filter.on) {
    return undefined;
  }
  return { ...filter, every: kept };
}

function holdsNearFilter(filter: Filter): boolean {
  if ('near' in filter) {
    return true;
  }
  if ('every' in filter) {
    return filter.every.some(holdsNearFilter);
  }
  if ('any' in filter) {
    return filter.any.some(holdsNearFilter);
  }
  if ('not' in filter) {
    return holdsNearFilter(filter.not);
  }
  return false;
}

// How many rows pass `condition`, stopping at `cap`. A card that fans out
// into several rows counts more than once, so the count never says fewer
// cards than there are.
export function cappedMatchCount(
  opts: QueryOptions,
  condition: CardExpression,
  cap: number,
): CardExpression {
  return [
    'SELECT COUNT(*) AS n FROM (SELECT 1',
    `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
    tableValuedFunctionsPlaceholder,
    'WHERE',
    ...condition,
    `LIMIT ${Number(cap)}) AS c`,
  ];
}
