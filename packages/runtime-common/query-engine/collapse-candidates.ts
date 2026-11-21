// A collapsed page over a near sort's approximate candidates: the page is
// computed over the candidate cards alone (`collapsedNarrowPass` under the
// candidate condition), so what it says of every match, each group's size
// and the total, is read over the filter here.
// Owns: `collapsedGroupSizes`, `collapsedCappedCount`.
// Must not: change which rows a collapsed page holds or their order.
// Guarantees: docs/search.md ("Vector search (`near`)", "Collapsing to one
// per group (`collapse`)").
//
// Why the page is the exact one. Ranked by similarity first, a group's kept
// rows are its most similar matches. The candidates are the cards nearest
// the target (as far as the index read found them), so every card more
// similar than the least similar candidate is a candidate, and a group's
// kept rows above that similarity are the same over the candidates as over
// every match. A full page over the candidates is therefore the exact page
// whenever the read found the nearest cards; a page that comes up short
// widens the read, then compares exactly (`NearContext#widenedRead`).

import type { QueryOptions } from './types.ts';
import {
  type CardExpression,
  every,
  fieldQuery,
  param,
  tableValuedFunctionsPlaceholder,
} from '../expression.ts';
import type { CodeRef } from '../index.ts';
import { prerenderedJoin, tableFromOpts } from './index-sql.ts';
import { CollapsePaging } from './collapse-paging.ts';

export abstract class CollapseCandidates extends CollapsePaging {
  // How many matches each of `groups` (the page's group values, as text)
  // holds over the whole filter: one row per group, `__collapse` and `n`.
  // `narrowedBy`, when given, is a test the matches of those groups all
  // pass (an indexed `in` on the collapse field), so the filter is read for
  // them alone.
  protected collapsedGroupSizes({
    opts,
    collapse,
    everyCondition,
    groups,
    narrowedBy,
  }: {
    opts: QueryOptions;
    collapse: { by: string; on: CodeRef };
    everyCondition: CardExpression;
    groups: string[];
    narrowedBy?: CardExpression;
  }): CardExpression {
    let value = (): CardExpression => [
      'CAST(',
      fieldQuery(collapse.by, collapse.on, false, 'sort'),
      'AS TEXT)',
    ];
    return [
      'SELECT g.__collapse AS __collapse, COUNT(*) AS n FROM (',
      'SELECT i.url AS url, i.type AS type, ANY_VALUE(',
      ...value(),
      ') AS __collapse',
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
      tableValuedFunctionsPlaceholder,
      'WHERE',
      ...every([
        everyCondition,
        ...(narrowedBy ? [narrowedBy] : []),
        [
          ...value(),
          'IN (SELECT jsonb_array_elements_text(CAST(',
          param(JSON.stringify(groups)),
          'AS jsonb)))',
        ],
      ]),
      'GROUP BY i.url, i.type',
      ') AS g GROUP BY g.__collapse',
    ];
  }

  // The kept rows among the first `cap` matches, for a filter that holds no
  // condition walking a plural field (each match one row): `matched` how
  // many matches were read, `kept` how many of them a collapse keeps. Under
  // `cap` matches it is the collapsed page's total; past it, a lower bound
  // (more matches keep no fewer rows).
  protected collapsedCappedCount({
    opts,
    collapse,
    everyCondition,
    cap,
  }: {
    opts: QueryOptions;
    collapse: { by: string; on: CodeRef; keep: number };
    everyCondition: CardExpression;
    cap: number;
  }): CardExpression {
    return [
      `SELECT COUNT(*) AS matched, COUNT(*) FILTER (WHERE x.rn <= ${Number(collapse.keep)}) AS kept FROM (`,
      'SELECT ROW_NUMBER() OVER (PARTITION BY COALESCE(CAST(y.__collapse AS TEXT), y.url)) AS rn FROM (',
      'SELECT i.url AS url,',
      fieldQuery(collapse.by, collapse.on, false, 'sort'),
      'AS __collapse',
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
      tableValuedFunctionsPlaceholder,
      'WHERE',
      ...everyCondition,
      `LIMIT ${Number(cap)}`,
      ') AS y) AS x',
    ];
  }
}
