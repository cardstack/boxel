// A realm union's per-realm totals: how many of a union search's matches
// each realm holds, or under `collapse` how many of the kept rows.
// Owns: `unionRealmTotals`.
// Must not: page.
// Guarantees: docs/search.md ("Federated search").

import type { QueryOptions } from './types.ts';
import {
  type CardExpression,
  tableValuedFunctionsPlaceholder,
} from '../expression.ts';
import type { CodeRef } from '../index.ts';
import type { Sort } from '../query.ts';
import { prerenderedJoin, tableFromOpts } from './index-sql.ts';
import { realmsOf } from '../realm-union.ts';
import { Columns } from './columns.ts';

export abstract class UnionTotals extends Columns {
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
