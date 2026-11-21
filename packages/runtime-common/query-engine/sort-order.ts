// Ordering: the ORDER BY a sort compiles to (field sorts with their
// direction and NULLS placement, relevance, blends of signals, expression
// sorts), the sort values a merged page compares, and the wrapped order a
// collapsed or paged read uses. Relevance expansion is in relevance-sort.ts,
// a blend's columns in blend-sort.ts.
// Owns: `orderExpression`, expression sort SQL (`exprSql`) and each
// expression sort's instant and one-card bindings.
// Must not: run the window over a page's rows (sort-window.ts), or page.
// Guarantees: docs/search.md ("Sort Order", "Blended ranking (`blend`)",
// "Ranking by an expression (`expression`)", "Sets and sequences").

import {
  MATCH_RELEVANCE_SORT_KEY,
  generalSortFields,
  isBlendSort,
  isMatchRelevanceSort,
} from './types.ts';
import { type Sort, isExprSort } from '../query.ts';
import {
  type CardExpression,
  fieldQuery,
  separatedByCommas,
  sortDirection,
} from '../expression.ts';
import {
  type SortValueKind,
  blendScoreAlias,
  nullsPlacement,
} from './sort-sql.ts';
import { TextSearch } from './text-search.ts';
import { requireExpressionSql } from '../query-v2/query-expression.ts';
import { getField, traveledThruPlural } from './filter-paths.ts';
import { isNearSort, nearSimilarityAlias } from '../vector-query.ts';

// How one sort entry orders: its reads (several break each other's ties),
// its direction (default: the entry's own), and where a row with no value
// goes (default: the entry's `missing`; false for a read that always has
// one, so an index on it serves the order).
export interface OrderTerm {
  reads: CardExpression[];
  direction?: string;
  nulls?: string | false;
}

// A ranking score: best first unless the entry says otherwise, no value last.
const ranked = (read: CardExpression): OrderTerm => ({
  reads: [read],
  direction: 'desc',
  nulls: 'NULLS LAST',
});

// The one ORDER BY, for every source: each entry's terms in order, then the
// source's tie keys (cards: url then type; log lines: file then line).
export function orderBy<E extends { direction?: string | null }>(
  sort: readonly E[],
  term: (entry: E, index: number) => OrderTerm,
  ties: CardExpression[],
): CardExpression {
  return [
    'ORDER BY',
    ...separatedByCommas([
      ...sort.flatMap((entry, index) => {
        let { reads, direction, nulls } = term(entry, index);
        let placement = nulls ?? nullsPlacement(entry);
        return reads.map((read) => [
          ...read,
          sortDirection(entry.direction ?? direction),
          ...(placement === false ? [] : [placement]),
        ]);
      }),
      ...ties,
    ]),
  ];
}

export abstract class SortOrder extends TextSearch {
  // An `_expr` sort's formula as SQL over the row's search doc. Postgres
  // only: the score profile lowers to Postgres functions.
  protected exprSql(
    expr: string,
    bindings?: Record<string, Record<string, unknown> | null>,
    now?: Date,
  ): string {
    this.dialect.requirePostgres(`a formula sort runs on Postgres only`);
    return requireExpressionSql().exprSortSql(expr, bindings, now);
  }
  // Each expression sort's query instant, which its NOW() reads.
  protected sortNow = new WeakMap<object, Date>();
  // Each expression sort's one-card bindings: a path that starts with a
  // binding's name reads that card (see `exprSortSql`).
  protected sortBindings = new WeakMap<
    object,
    Record<string, Record<string, unknown> | null>
  >();

  // Whether each sort key orders as a number or as text, decided as the SQL
  // decides it: the scores the engine computes and an expression's value are
  // numbers; a general key is a number unless it is the url; a field is a
  // number when `handleFieldQuery` casts it to `numeric` (a number or
  // big-integer field read outside a list), and text otherwise.
  protected async sortValueKinds(
    sort: Sort | undefined,
  ): Promise<SortValueKind[]> {
    return await Promise.all(
      (sort ?? []).map(async (s): Promise<SortValueKind> => {
        if (
          isExprSort(s) ||
          isBlendSort(s) ||
          isNearSort(s) ||
          isMatchRelevanceSort(s)
        ) {
          return 'number';
        }
        if (!('on' in s && s.on)) {
          // `lastModified` and `createdAt` are integer columns; `cardURL` is
          // text.
          return s.by === 'cardURL' ? 'text' : 'number';
        }
        let numeric = false;
        await this.walkFilterFieldPath(
          await this.getDefinition(s.on),
          s.by,
          [] as CardExpression,
          async (definition, expression, pathTraveled) => {
            let field = await getField(
              definition,
              pathTraveled,
              this.definitionLookup,
            );
            numeric =
              !traveledThruPlural(pathTraveled) &&
              (field.serializerName === 'number' ||
                field.serializerName === 'big-integer');
            return expression;
          },
        );
        return numeric ? 'number' : 'text';
      }),
    );
  }

  protected generalFieldSortColumn(field: string) {
    let mappedField = generalSortFields[field];
    if (mappedField) {
      return mappedField;
    } else {
      throw new Error(`Unknown sort field: ${field}`);
    }
  }

  protected orderExpression(sort: Sort | undefined): CardExpression {
    if (!sort) {
      // `i.type` follows `url` so a dual-indexed card `.json`'s two rows
      // (same url, `instance` vs `file`) order deterministically.
      return ['ORDER BY i.url COLLATE "POSIX", i.type'];
    }
    // `_matchRelevance` is the aggregated relevance column projected by the
    // SELECT (see `_search`); reference the alias directly and default to
    // `desc` (best match first). A near sort's similarity column works the
    // same way. Everything else sorts on a column. `url` then `type` are the
    // final sort keys for deterministic results (the two rows of a
    // dual-indexed card `.json` share a url).
    return orderBy(
      sort,
      (s, index): OrderTerm =>
        isExprSort(s)
          ? ranked([
              'ANY_VALUE(',
              this.exprSql(
                s.expr,
                this.sortBindings.get(s),
                this.sortNow.get(s),
              ),
              ')',
            ])
          : isBlendSort(s)
            ? ranked([`"${blendScoreAlias(sort, index)}"`])
            : isNearSort(s)
              ? ranked([`"${nearSimilarityAlias(sort, index)}"`])
              : isMatchRelevanceSort(s)
                ? ranked([`"${MATCH_RELEVANCE_SORT_KEY}"`])
                : {
                    // intentionally not using field arity here--not sure
                    // what it means to sort via a plural field
                    reads: [
                      [
                        'ANY_VALUE(',
                        'on' in s && s.on
                          ? fieldQuery(s.by, s.on, false, 'sort')
                          : this.generalFieldSortColumn(s.by),
                        ')',
                      ],
                    ],
                  },
      [['i.url COLLATE "POSIX"'], ['i.type']],
    );
  }

  // The order expression split for the outer-wrapped projection: the inner
  // grouped query exposes each sort value as an aliased column, and the outer
  // query applies the ORDER BY against those aliases (plus the `url`
  // tiebreaker). This yields the same ordering as `orderExpression` while the
  // sort values are computed once in the inner aggregation.
  protected wrappedOrderExpression(sort: Sort | undefined): {
    innerSortColumns: CardExpression;
    outerOrderBy: CardExpression;
  } {
    if (!sort) {
      // `type` follows `url` to match `orderExpression`'s tiebreaker — the two
      // rows of a dual-indexed card `.json` share a url. The inner projection
      // aliases `ANY_VALUE(i.type) as type`, so the outer references it bare.
      return {
        innerSortColumns: [],
        outerOrderBy: ['ORDER BY url COLLATE "POSIX", type'],
      };
    }
    let innerSortColumns: CardExpression = [];
    let outerKeys: CardExpression[] = [];
    sort.forEach((s, i) => {
      if (isExprSort(s)) {
        let alias = `_sort_${i}`;
        innerSortColumns.push(
          ', ANY_VALUE(',
          this.exprSql(s.expr, this.sortBindings.get(s), this.sortNow.get(s)),
          `) AS ${alias}`,
        );
        outerKeys.push([
          alias,
          sortDirection(s.direction ?? 'desc'),
          'NULLS LAST',
        ]);
        return;
      }
      // Blend and near columns are projected by the inner SELECT too.
      if (isBlendSort(s)) {
        outerKeys.push([
          `"${blendScoreAlias(sort, i)}"`,
          sortDirection(s.direction ?? 'desc'),
          'NULLS LAST',
        ]);
        return;
      }
      if (isNearSort(s)) {
        outerKeys.push([
          `"${nearSimilarityAlias(sort, i)}"`,
          sortDirection(s.direction ?? 'desc'),
          'NULLS LAST',
        ]);
        return;
      }
      // `_matchRelevance` is already projected by the inner SELECT (see
      // `_search`), so it rides through `sub.*` — reference it in the outer
      // ORDER BY directly, with no inner `_sort_i` alias, defaulting to `desc`.
      if (isMatchRelevanceSort(s)) {
        outerKeys.push([
          `"${MATCH_RELEVANCE_SORT_KEY}"`,
          sortDirection(s.direction ?? 'desc'),
          'NULLS LAST',
        ]);
        return;
      }
      let alias = `_sort_${i}`;
      innerSortColumns.push(
        ', ANY_VALUE(',
        'on' in s && s.on
          ? fieldQuery(s.by, s.on, false, 'sort')
          : this.generalFieldSortColumn(s.by),
        `) AS ${alias}`,
      );
      outerKeys.push([alias, sortDirection(s.direction), nullsPlacement(s)]);
    });
    // `url` then `type` are the final tiebreakers, matching `orderExpression`
    // for deterministic results (a dual-indexed card `.json`'s two rows share
    // a url; the inner projection aliases `ANY_VALUE(i.type) as type`).
    outerKeys.push(['url COLLATE "POSIX"']);
    outerKeys.push(['type']);
    return {
      innerSortColumns,
      outerOrderBy: ['ORDER BY', ...separatedByCommas(outerKeys)],
    };
  }
}
