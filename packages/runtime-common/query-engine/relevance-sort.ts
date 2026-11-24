// Relevance: a `_relevance` sort entry as the `_blend` it stands for, from
// the filter's text terms, the anchoring type's rank fields and, given
// `near`, its vector field.
// Owns: `expandRelevanceSorts`.
// Must not: compile a blend's SQL (blend-sort.ts) or the base order
// (sort-order.ts).
// Guarantees: docs/search.md ("Relevance (`relevance`)").

import { refuse } from '../query-v2/query-refusals.ts';
import { BLEND_SORT_KEY, MATCH_RELEVANCE_SORT_KEY } from './types.ts';
import {
  type BlendComponent,
  type BlendSortExpression,
  DEFAULT_RELEVANCE_WEIGHTS,
  type Filter,
  MAX_BLEND_COMPONENTS,
  type NearSortTarget,
  type RelevanceSignal,
  type RelevanceSortExpression,
  type Sort,
  collectPositiveMatchTerms,
  isRelevanceSort,
} from '../query-v2/query.ts';
import type { CodeRef } from '../index.ts';
import { RELEVANCE_SORT_KEY_NAME, explainNames } from './sort-sql.ts';
import { SEARCH_RANK_SIGNALS, rankFieldsOf } from '../search-intent.ts';
import { filterAnchor } from './filter-sql.ts';
import { SortOrder } from './sort-order.ts';

export abstract class RelevanceSort extends SortOrder {
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
          throw refuse('sort-near-vector-needs', undefined, {
            RELEVANCE_SORT_KEY_NAME,
            value1: JSON.stringify(on),
          });
        }
        of.push(
          signal(meaning, { by: vectorField, on, near: sort.near }, 'meaning'),
        );
      }
    } else if (sort.near != null) {
      throw refuse('sort-near-vector-needs-2', undefined, {
        RELEVANCE_SORT_KEY_NAME,
      });
    }
    if (of.length === 0) {
      throw refuse('sort-has-nothing-rank', undefined, {
        RELEVANCE_SORT_KEY_NAME,
      });
    }
    return {
      by: BLEND_SORT_KEY,
      of: of.slice(0, MAX_BLEND_COMPONENTS),
      direction: sort.direction ?? 'desc',
    };
  }
}
