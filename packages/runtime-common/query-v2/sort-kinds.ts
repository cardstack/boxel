// The sort kinds the query schema and its check recognize. The engine reads
// them too (query-engine/types.ts and vector-query.ts import them from here),
// so the schema compiles without the engine beneath it.
import type { BlendSortExpression, NearSortTarget } from '../query.ts';
import type { CodeRef } from '../index.ts';

export const generalSortFields: Record<string, string> = {
  lastModified: 'i.last_modified',
  createdAt: 'i.resource_created_at',
  cardURL: 'i.url COLLATE "POSIX"',
};

// A synthetic sort key (not a column in `generalSortFields`): the full-text
// relevance score of a `matches` query, computed per query from the filter's
// match terms. Sorting by it defaults to `desc` (best match first).
export const MATCH_RELEVANCE_SORT_KEY = '_matchRelevance';

// A relevance sort is recognized by its key alone. The score belongs to the
// query, not to any card type, so an `on` beside it anchors nothing and is
// ignored rather than sending the key down the card-field path, where it
// would resolve as a nonexistent field.
export function isMatchRelevanceSort(sort: { by: string }): boolean {
  return sort.by === MATCH_RELEVANCE_SORT_KEY;
}

// A `_blend` sort fuses several ranking signals with reciprocal rank fusion
// (see `BlendSortExpression` in query.ts).
export const BLEND_SORT_KEY = '_blend';

export function isBlendSort(sort: object): sort is BlendSortExpression {
  return (sort as { by?: unknown }).by === BLEND_SORT_KEY;
}

// A sort by similarity to a vector (`near`).
export function isNearSort(sort: object): sort is {
  by: string;
  on: CodeRef;
  near: NearSortTarget;
  direction?: 'asc' | 'desc';
} {
  return 'near' in sort && (sort as { near?: unknown }).near != null;
}
