import { SearchRequestError } from '../search-utils.ts';

// A card query's `select` (a table of values read off each row, in place of
// entries) is answered by a row of its own. Until that row lands, both search
// routes — a realm's `_search` and `_federated-search` — refuse it with this
// one 400, on either engine, so a caller is told plainly rather than handed
// the newer grammar's table on one route and an unknown member on the other.
// A log query's `select` (`from: { log }`) is answered before this is asked.
//
// Owns: the refusal. Must not: outlive the select row, which deletes it.
export function deferredSelectRefusal(
  payload: unknown,
): SearchRequestError | undefined {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    'select' in payload
  ) {
    return new SearchRequestError(
      'invalid-query',
      'Invalid query: select (a table of values) is not answered yet; ask for entries, and name what each carries with fields',
      'unknown-key',
    );
  }
  return undefined;
}
