// Ordering: the ORDER BY a sort compiles to (field sorts with their
// direction and NULLS placement, relevance, blends of signals, expression
// sorts), the sort values a merged page compares, and the wrapped order a
// collapsed or paged read uses.
// Owns: `orderExpression`, relevance and blend expansion, expression sort
// SQL (`exprSql`) and each expression sort's instant and one-card bindings.
// Must not: run the window over a page's rows (sort-window.ts), or page.
// Guarantees: docs/search.md ("Sort Order", "Blended ranking (`blend`)",
// "Ranking by an expression (`expression`)", "Sets and sequences").

import {
  BLEND_SORT_KEY,
  type FilterContext,
  MATCH_RELEVANCE_SORT_KEY,
  generalSortFields,
  isBlendSort,
  isMatchRelevanceSort,
} from './types.ts';
import {
  type BlendComponent,
  type BlendSortExpression,
  DEFAULT_RELEVANCE_WEIGHTS,
  DEFAULT_RRF_K,
  type Filter,
  InvalidQueryError,
  MAX_BLEND_COMPONENTS,
  type MatchTerm,
  type NearSortTarget,
  type RelevanceSignal,
  type RelevanceSortExpression,
  type Sort,
  collectPositiveMatchTerms,
  exprSortSql,
  isExprSort,
  isRelevanceSort,
  isWhenSignal,
} from '../query.ts';
import {
  type CardExpression,
  dbExpression,
  fieldQuery,
  param,
  separatedByCommas,
  sortDirection,
} from '../expression.ts';
import { type CodeRef, baseCardRef } from '../index.ts';
import {
  RELEVANCE_SORT_KEY_NAME,
  type SortValueKind,
  blendScoreAlias,
  explainNames,
  nullsPlacement,
} from './sort-sql.ts';
import { SEARCH_RANK_SIGNALS, rankFieldsOf } from '../search-intent.ts';
import { TextSearch } from './text-search.ts';
import { filterAnchor } from './filter-sql.ts';
import { getField, traveledThruPlural } from './filter-paths.ts';
import { isNearSort, nearSimilarityAlias } from '../vector-query.ts';

export abstract class SortOrder extends TextSearch {
  // An `_expr` sort's formula as SQL over the row's search doc. Postgres
  // only: the score profile lowers to Postgres functions.
  protected exprSql(
    expr: string,
    bindings?: Record<string, Record<string, unknown> | null>,
    now?: Date,
  ): string {
    this.dialect.requirePostgres(`a formula sort runs on Postgres only`);
    return exprSortSql(expr, bindings, now);
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
    return [
      'ORDER BY',
      ...separatedByCommas([
        ...sort.map((s, index) =>
          // `_matchRelevance` is the aggregated relevance column projected by
          // the SELECT (see `_search`); reference the alias directly and default
          // to `desc` (best match first). A near sort's similarity column works
          // the same way. Everything else sorts on a column.
          isExprSort(s)
            ? [
                'ANY_VALUE(',
                this.exprSql(
                  s.expr,
                  this.sortBindings.get(s),
                  this.sortNow.get(s),
                ),
                ')',
                sortDirection(s.direction ?? 'desc'),
                'NULLS LAST',
              ]
            : isBlendSort(s)
              ? [
                  `"${blendScoreAlias(sort, index)}"`,
                  sortDirection(s.direction ?? 'desc'),
                  'NULLS LAST',
                ]
              : isNearSort(s)
                ? [
                    `"${nearSimilarityAlias(sort, index)}"`,
                    sortDirection(s.direction ?? 'desc'),
                    'NULLS LAST',
                  ]
                : isMatchRelevanceSort(s)
                  ? [
                      `"${MATCH_RELEVANCE_SORT_KEY}"`,
                      sortDirection(s.direction ?? 'desc'),
                      'NULLS LAST',
                    ]
                  : [
                      // intentionally not using field arity here--not sure what it
                      // means to sort via a plural field
                      'ANY_VALUE(',
                      'on' in s && s.on
                        ? fieldQuery(s.by, s.on, false, 'sort')
                        : this.generalFieldSortColumn(s.by),
                      ')',
                      sortDirection(s.direction),
                      nullsPlacement(s),
                    ],
        ),
        // `url` then `type` are the final sort keys for deterministic results
        // (the two rows of a dual-indexed card `.json` share a url).
        ['i.url COLLATE "POSIX"'],
        ['i.type'],
      ]),
    ];
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

  // Each `_relevance` sort, as the `_blend` it stands for: text relevance
  // (when the filter has a positive `matches` term), each ranking signal the
  // anchoring type declares (`rank: 'popularity'`, its `static searchDefaults.rank`),
  // and, given `near`, the similarity of the type's vector field as the
  // `meaning` signal. Weights default to `DEFAULT_RELEVANCE_WEIGHTS`; a zero
  // weight drops a signal and a negative one inverts it.
  protected async expandRelevanceSorts(
    sort: Sort | undefined,
    filter: Filter | undefined,
  ): Promise<Sort | undefined> {
    if (!sort?.some((s) => isRelevanceSort(s))) {
      return sort;
    }
    let expanded: Sort = [];
    for (let s of sort) {
      expanded.push(
        isRelevanceSort(s) ? await this.#relevanceBlend(s, filter) : s,
      );
    }
    return expanded;
  }

  async #relevanceBlend(
    sort: RelevanceSortExpression,
    filter: Filter | undefined,
  ): Promise<BlendSortExpression> {
    let weightOf = (signal: RelevanceSignal) =>
      sort.weights?.[signal] ?? DEFAULT_RELEVANCE_WEIGHTS[signal];
    let signal = (
      weight: number,
      entry: { by: string; on?: CodeRef; near?: NearSortTarget },
      name?: RelevanceSignal,
    ): BlendComponent => {
      let component = {
        ...entry,
        weight: Math.abs(weight),
        direction: weight < 0 ? 'asc' : 'desc',
      } as BlendComponent;
      // read by `explain`, never on the wire
      if (name) explainNames.set(component, { name, weight });
      return component;
    };
    let of: BlendComponent[] = [];
    let text = weightOf('text');
    if (text !== 0 && collectPositiveMatchTerms(filter).length > 0) {
      of.push(signal(text, { by: MATCH_RELEVANCE_SORT_KEY }, 'text'));
    }
    let on = sort.on ?? filterAnchor(filter);
    if (on) {
      let definition = await this.getDefinition(on);
      let rankFields = rankFieldsOf(definition);
      for (let name of SEARCH_RANK_SIGNALS) {
        let field = rankFields[name]?.[0];
        let weight = weightOf(name);
        if (field && weight !== 0) {
          of.push(signal(weight, { by: field, on }, name));
        }
      }
      let meaning = weightOf('meaning');
      if (sort.near != null && meaning !== 0) {
        let vectorField = Object.entries(definition.fields).find(
          ([, defId]) =>
            definition.fieldDefs[defId]?.serializerName === 'vector',
        )?.[0];
        if (!vectorField) {
          throw new InvalidQueryError(
            `sort by "${RELEVANCE_SORT_KEY_NAME}" near a vector needs a type with a VectorField; ${JSON.stringify(on)} has none`,
            'needs-declaration',
          );
        }
        of.push(
          signal(meaning, { by: vectorField, on, near: sort.near }, 'meaning'),
        );
      }
    } else if (sort.near != null) {
      throw new InvalidQueryError(
        `sort by "${RELEVANCE_SORT_KEY_NAME}" near a vector needs "on", the type whose vector field it compares`,
        'needs-type',
      );
    }
    if (of.length === 0) {
      throw new InvalidQueryError(
        `sort by "${RELEVANCE_SORT_KEY_NAME}" has nothing to rank by: give the query a positive \`matches\` filter, or anchor it ("on") to a type that declares rank fields`,
        'matches-required',
      );
    }
    return {
      by: BLEND_SORT_KEY,
      of: of.slice(0, MAX_BLEND_COMPONENTS),
      direction: sort.direction ?? 'desc',
    };
  }

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
          'IS NULL THEN 0 ELSE CAST(',
          param(Math.abs(weight)),
          dbExpression({ pg: 'AS DOUBLE PRECISION)', sqlite: 'AS REAL)' }),
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
