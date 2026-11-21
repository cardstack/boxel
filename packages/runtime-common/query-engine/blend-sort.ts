// Blends: the projection column (and any vector joins) each `_blend` sort
// ranks by, reciprocal rank fusion over its signals, and the per-signal
// columns `explain` reads.
// Owns: `blendSortExpressions` and each signal's score for a card.
// Must not: build the ORDER BY (sort-order.ts) or expand `_relevance`
// (relevance-sort.ts).
// Guarantees: docs/search.md ("Blended ranking (`blend`)").

import {
  type FilterContext,
  isBlendSort,
  isMatchRelevanceSort,
} from './types.ts';
import {
  type BlendComponent,
  DEFAULT_RRF_K,
  type MatchTerm,
  type Sort,
  isExprSort,
  isWhenSignal,
} from '../query-v2/query.ts';
import {
  type CardExpression,
  fieldQuery,
  param,
  sortDirection,
} from '../expression.ts';
import { baseCardRef } from '../index.ts';
import { blendScoreAlias } from './sort-sql.ts';
import { isNearSort } from '../vector-query.ts';
import { RelevanceSort } from './relevance-sort.ts';

export abstract class BlendSort extends RelevanceSort {
  // The projection column (and any vector joins) for each `_blend` sort:
  // reciprocal rank fusion, sum(weight / (k + rank)) over the signals a card
  // has a value for. Each signal's rank is a window over every grouped row
  // the filter admits (evaluated before ORDER BY / LIMIT), so a page holds
  // the top of the whole match set. A card without a value for a signal (no
  // vector, no text match, an empty field) gets nothing from it, rather than
  // a last place. Ties share a rank (RANK()).
  protected async blendSortExpressions(
    sort: Sort | undefined,
    matches: MatchTerm[],
    staged: boolean,
    filterContext: FilterContext,
    explain = false,
  ): Promise<{ blendColumns: CardExpression; blendJoins: CardExpression }> {
    let blendColumns: CardExpression = [];
    let blendJoins: CardExpression = [];
    if (!sort) {
      return { blendColumns, blendJoins };
    }
    for (let [index, s] of sort.entries()) {
      if (!isBlendSort(s)) {
        continue;
      }
      let k = s.k ?? DEFAULT_RRF_K;
      let terms: CardExpression[] = [];
      for (let [j, component] of s.of.entries()) {
        let weight = component.weight ?? 1;
        let inverted = weight < 0;
        let score = await this.#blendSignalScore(
          component,
          matches,
          `nb${index}_${j}`,
          blendJoins,
          staged,
          filterContext,
          inverted,
        );
        // A negative weight inverts the signal: the same size, ranked the
        // other way round. A `_when` signal inverts in its score instead.
        if (explain && index === sort.findIndex((s) => isBlendSort(s))) {
          let order: CardExpression = [
            '(ORDER BY',
            ...score,
            sortDirection(
              isWhenSignal(component)
                ? 'desc'
                : inverted
                  ? (component.direction ?? 'desc') === 'desc'
                    ? 'asc'
                    : 'desc'
                  : (component.direction ?? 'desc'),
            ),
            'NULLS LAST)',
          ];
          blendColumns.push(
            ', (',
            ...score,
            `) AS "_x${j}_value"`,
            ', (CASE WHEN',
            ...score,
            'IS NULL THEN NULL ELSE RANK() OVER',
            ...order,
            `END) AS "_x${j}_rank"`,
          );
        }
        let declared = isWhenSignal(component)
          ? 'desc'
          : (component.direction ?? 'desc');
        let direction =
          inverted && !isWhenSignal(component)
            ? declared === 'desc'
              ? 'asc'
              : 'desc'
            : declared;
        terms.push([
          'CASE WHEN',
          ...score,
          'IS NULL THEN 0 ELSE',
          ...this.dialect.castFloat([param(Math.abs(weight))]),
          '/ (',
          param(k),
          '+ RANK() OVER (ORDER BY',
          ...score,
          sortDirection(direction),
          'NULLS LAST)) END',
        ]);
      }
      let sum: CardExpression = [];
      terms.forEach((t, i) => {
        if (i > 0) {
          sum.push('+');
        }
        sum.push(...t);
      });
      blendColumns.push(
        ', (',
        ...sum,
        `) AS "${blendScoreAlias(sort, index)}"`,
      );
    }
    return { blendColumns, blendJoins };
  }

  // One blend signal's aggregated value for a card, NULL when it has none.
  async #blendSignalScore(
    component: BlendComponent,
    matches: MatchTerm[],
    joinAlias: string,
    joins: CardExpression,
    staged: boolean,
    filterContext: FilterContext,
    inverted = false,
  ): Promise<CardExpression> {
    if (isWhenSignal(component)) {
      // 1 for a card the filter admits, NULL (no signal) otherwise, so every
      // match ties for first place. Inverted, the cards it doesn't admit.
      await this.assertNearFilters(
        component.when,
        baseCardRef,
        filterContext.realmURL,
        filterContext.near,
      );
      let condition = this.filterCondition(
        component.when,
        baseCardRef,
        'positive',
        { ...filterContext, perRow: true },
      );
      return inverted
        ? ['NULLIF(MIN(CASE WHEN', ...condition, 'THEN 0 ELSE 1 END), 0)']
        : ['MAX(CASE WHEN', ...condition, 'THEN 1 END)'];
    }
    if (isExprSort(component)) {
      return [
        'ANY_VALUE(',
        this.exprSql(component.expr, undefined, filterContext.now),
        ')',
      ];
    }
    if (isMatchRelevanceSort(component)) {
      // ts_rank_cd is 0 for a card the terms don't match: no signal.
      return ['NULLIF(', ...this.matchRelevanceScore(matches, staged), ', 0)'];
    }
    if (isNearSort(component)) {
      return await this.vectors.nearSignalScore(
        component,
        joinAlias,
        joins,
        filterContext.realmURL,
        filterContext.near,
      );
    }
    return [
      'ANY_VALUE(',
      'on' in component && component.on
        ? fieldQuery(component.by, component.on, false, 'sort')
        : this.generalFieldSortColumn(component.by),
      ')',
    ];
  }
}
