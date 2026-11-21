import type { DBAdapter } from '../db.ts';
import type { DefinitionLookup } from '../definition-lookup.ts';
import type { VirtualNetwork } from '../virtual-network.ts';
import { IndexQueryEngine as LegacyIndexQueryEngine } from '../index-query-engine.ts';
import { IndexQueryEngine } from './index-query-engine.ts';

// Which query engine each caller reads through, while main's engine
// (`LegacyIndexQueryEngine`) is still beside Query V2's (`IndexQueryEngine`).
//
// Owns: the per-caller default and its override. Each switch row moves one
// caller to Query V2 by changing its default here, once that row's gate (the
// engine differential and the caller's own suites) has proven it.
// Must not: outlive the old engine. This module, and the override, go when
// the old engine is deleted.
// Each production construction site builds its engine through
// `indexQueryEngineFor`, naming its caller, so the override reaches it and
// the guard (realm-server/tests/query-engine-choice-test.ts) can read it.
// A caller that reads through no engine (a log search answers from the log
// line rows, `log-query.ts`) asks `queryEngineFor('<caller>')` at each site
// instead, and on 'legacy' answers as main does; the guard reads those too.
// Temporary: `BOXEL_QUERY_ENGINE=legacy|v2` sends every caller to one engine,
// for the differential and for rolling a deployment back. It is not a
// product setting.

export type QueryEngineCaller =
  // a realm's `_search`, named queries and card reads through its index
  | 'realm-search'
  // an automation's searches over its own realm's index (its index hook and
  // its run limits)
  | 'automations'
  // a skill card's validation searches
  | 'skill-validation'
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
    'realm-search': 'v2',
    automations: 'legacy',
    'skill-validation': 'legacy',
    'realm-logs': 'v2',
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

// Either engine: the methods a caller uses have the same shape on both.
export type AnyIndexQueryEngine = IndexQueryEngine | LegacyIndexQueryEngine;

// The engine `caller` reads through: Query V2's once its switch row moved
// it, main's until then (`queryEngineFor`).
export function indexQueryEngineFor(
  caller: QueryEngineCaller,
  dbAdapter: DBAdapter,
  definitionLookup: DefinitionLookup,
  virtualNetwork: VirtualNetwork,
): AnyIndexQueryEngine {
  return queryEngineFor(caller) === 'v2'
    ? new IndexQueryEngine(dbAdapter, definitionLookup, virtualNetwork)
    : new LegacyIndexQueryEngine(dbAdapter, definitionLookup, virtualNetwork);
}
