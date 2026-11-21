import type { EntryCollectionDocument } from '../document-types.ts';
import type { Filter, Query } from '../query.ts';
import {
  emptySearchEntryDocument,
  markPolicyScoped,
  parseSearchEntryQueryFromPayload,
  policyScopedQuery,
  type SearchEntryQuery as LegacySearchEntryQuery,
} from '../search-entry.ts';
import { applyServerSearchPageBound } from '../search-bounds.ts';
import {
  emptySearchEntryDocument as v2EmptySearchEntryDocument,
  markPolicyScoped as v2MarkPolicyScoped,
  parseSearchEntryQueryFromPayload as parseV2SearchEntryQuery,
  policyScopedQuery as v2PolicyScopedQuery,
  type SearchEntryQuery as V2SearchEntryQuery,
} from '../query-v2/search-entry.ts';
import { applyServerSearchPageBound as applyV2ServerSearchPageBound } from '../query-v2/search-bounds.ts';
import type { EntryCollectionDocument as V2EntryCollectionDocument } from '../query-v2/document-types.ts';
import type { TypeReferenceContext } from '../query-v2/type-reference.ts';
import { queryEngineFor } from './engine-choice.ts';

// The entry grammar a realm's own `_search` reads a request with: Query V2's
// once the 'realm-search' caller moved to it (`engine-choice.ts`), main's
// under `BOXEL_QUERY_ENGINE=legacy`. Query V2's reads the older spelling as
// main does (ADR 042) and answers or refuses the newer members (`let`,
// facets, collapse, explain, rerank, `timeZone`, the newer filter members)
// with a code. The federated route makes the same choice for 'federated'
// (handle-search.ts).
//
// Owns: which grammar's parse, page bound, policy composition and empty
// answer the realm route uses. Must not: outlive the old engine; with it gone
// the route calls Query V2's functions directly.

export type RealmEntryQuery = LegacySearchEntryQuery | V2SearchEntryQuery;

export interface RealmEntryGrammar {
  v2: boolean;
  // `typeReferences` (Query V2 only): where the request's `$REALM/` modules
  // and prefix-form card ids resolve.
  parse(
    payload: unknown,
    typeReferences?: TypeReferenceContext,
  ): RealmEntryQuery;
  boundPage(query: RealmEntryQuery['itemQuery']): RealmEntryQuery['itemQuery'];
  // `linkedGrants` (Query V2 only): the grants each card a `linkedFrom`
  // names would face on a direct read.
  policyScopedQuery(
    query: RealmEntryQuery,
    grantFilters: Filter[],
    linkedGrants?: Map<string, Filter[] | null>,
  ): RealmEntryQuery;
  emptySearchEntryDocument(query: RealmEntryQuery): EntryCollectionDocument;
  markPolicyScoped(
    doc: EntryCollectionDocument,
    realms: string[],
  ): EntryCollectionDocument;
}

const V2_GRAMMAR: RealmEntryGrammar = {
  v2: true,
  parse: (payload, typeReferences) =>
    parseV2SearchEntryQuery(payload, typeReferences),
  boundPage: (query) =>
    applyV2ServerSearchPageBound(
      query as V2SearchEntryQuery['itemQuery'],
    ) as RealmEntryQuery['itemQuery'],
  policyScopedQuery: (query, grantFilters, linkedGrants) =>
    v2PolicyScopedQuery(
      query as V2SearchEntryQuery,
      grantFilters,
      linkedGrants,
    ),
  emptySearchEntryDocument: (query) =>
    v2EmptySearchEntryDocument(
      query as V2SearchEntryQuery,
    ) as unknown as EntryCollectionDocument,
  markPolicyScoped: (doc, realms) =>
    v2MarkPolicyScoped(
      doc as unknown as V2EntryCollectionDocument,
      realms,
    ) as unknown as EntryCollectionDocument,
};

// Main's grammar parses only main's members, so every query it hands on is
// one main's functions take.
const LEGACY_GRAMMAR: RealmEntryGrammar = {
  v2: false,
  parse: (payload) => parseSearchEntryQueryFromPayload(payload),
  boundPage: (query) => applyServerSearchPageBound(query as Query),
  policyScopedQuery: (query, grantFilters) =>
    policyScopedQuery(query as LegacySearchEntryQuery, grantFilters),
  emptySearchEntryDocument: (query) =>
    emptySearchEntryDocument(query as LegacySearchEntryQuery),
  markPolicyScoped,
};

export function realmEntryGrammar(): RealmEntryGrammar {
  return queryEngineFor('realm-search') === 'v2' ? V2_GRAMMAR : LEGACY_GRAMMAR;
}
