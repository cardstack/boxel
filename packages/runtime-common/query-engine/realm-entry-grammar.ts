import type { EntryCollectionDocument } from '../document-types.ts';
import type { Filter } from '../query.ts';
import {
  emptySearchEntryDocument as v2EmptySearchEntryDocument,
  markPolicyScoped as v2MarkPolicyScoped,
  parseSearchEntryQueryFromPayload as parseV2SearchEntryQuery,
  policyScopedQuery as v2PolicyScopedQuery,
  type SearchEntryQuery as V2SearchEntryQuery,
} from '../search-entry.ts';
import { applyServerSearchPageBound } from '../search-bounds.ts';
import type { TypeReferenceContext } from '../query-v2/type-reference.ts';

// The entry grammar a realm's own `_search` reads a request with: Query V2's.
// It reads the older spelling as main's did (ADR 042) and answers or refuses
// the newer members (`let`, facets, collapse, explain, rerank, `timeZone`,
// the newer filter members) with a code.
//
// Owns: the parse, page bound, policy composition and empty answer the realm
// route uses.

export type RealmEntryQuery = V2SearchEntryQuery;

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
    applyServerSearchPageBound(
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
    v2MarkPolicyScoped(doc, realms) as unknown as EntryCollectionDocument,
};

export function realmEntryGrammar(): RealmEntryGrammar {
  return V2_GRAMMAR;
}
