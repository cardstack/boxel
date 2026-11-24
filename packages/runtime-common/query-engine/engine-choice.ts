// Which query engine each caller reads through, while main's engine
// (`LegacyIndexQueryEngine`) is still beside Query V2's (`IndexQueryEngine`).
//
// Owns: the per-caller default and its override. Each switch row moves one
// caller to Query V2 by changing its default here, once that row's gate (the
// engine differential and the caller's own suites) has proven it.
// Must not: outlive the old engine. This module, and the override, go when
// the old engine is deleted.
// Temporary: `BOXEL_QUERY_ENGINE=legacy|v2` sends every caller to one engine,
// for the differential and for rolling a deployment back. It is not a
// product setting.

export type QueryEngineCaller =
  // a realm's `_search`, named queries and card reads through its index
  | 'realm-search'
  // a realm's log search and a policy's log grants
  | 'realm-logs'
  // a federated `_search` and a realm union
  | 'federated'
  // query-backed fields
  | 'query-fields'
  // the host's live searches over its SQLite index
  | 'host';

export type QueryEngineChoice = 'legacy' | 'v2';

const DEFAULTS: Readonly<Record<QueryEngineCaller, QueryEngineChoice>> =
  Object.freeze({
    'realm-search': 'legacy',
    'realm-logs': 'legacy',
    federated: 'legacy',
    'query-fields': 'legacy',
    host: 'legacy',
  });

export function queryEngineFor(
  caller: QueryEngineCaller,
  override: string | undefined = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.BOXEL_QUERY_ENGINE,
): QueryEngineChoice {
  if (override === 'legacy' || override === 'v2') {
    return override;
  }
  return DEFAULTS[caller];
}
