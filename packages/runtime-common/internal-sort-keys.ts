// The engine's internal sort keys. A query is lowered to them, so the engine
// reads them, but they are not part of the grammar an author writes: a blend
// is `{ blend }`, an expression `{ expression }`, a boost `{ boost }`, and the
// relevance sorts are `{ relevance }` and `{ by: 'textRelevance' }`. Every
// place an author's query comes in refuses them: the search request, and a
// query-backed field's query, which the indexer runs in-process and the
// client sends over the wire, so both legs refuse it alike.
const INTERNAL_SORT_KEYS = new Set([
  '_blend',
  '_expr',
  '_when',
  '_relevance',
  '_matchRelevance',
]);

// The first internal sort key in `sort`, with where it is, or undefined.
export function internalSortKeyIn(
  sort: unknown,
  path = 'sort',
): { path: string; by: string } | undefined {
  if (!Array.isArray(sort)) return undefined;
  for (let i = 0; i < sort.length; i++) {
    let entry = sort[i];
    if (entry == null || typeof entry !== 'object') continue;
    let by = (entry as Record<string, unknown>).by;
    if (
      typeof by === 'string' &&
      INTERNAL_SORT_KEYS.has(by.replace(/^item\./, ''))
    ) {
      return { path: `${path}[${i}]/by`, by };
    }
    for (let key of ['of', 'blend']) {
      let found = internalSortKeyIn(
        (entry as Record<string, unknown>)[key],
        `${path}[${i}]/${key}`,
      );
      if (found) return found;
    }
  }
  return undefined;
}
