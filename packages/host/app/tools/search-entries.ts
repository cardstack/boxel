import { service } from '@ember/service';

import {
  MATCH_RELEVANCE_SORT_KEY,
  assertQuery,
  collectPositiveMatchTerms,
  excludeCardInstanceFileRows,
  isFileMetaResource,
  resourceIdentity,
  searchEntryWireQueryFromQuery,
  type CardResource,
  type EntryCollectionDocument,
  type FileMetaResource,
  type Query,
  type Saved,
  type SearchEntryScope,
} from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';
import { hasNarrowingPositiveTypeRef } from '../utils/search/query-builder';

import type StoreService from '../services/store';
import type * as BaseToolModule from '@cardstack/base/command';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

const SCOPES: SearchEntryScope[] = ['cards', 'files', 'all'];

// The fixed projection each row carries. Everything a discovery pass needs to
// judge a candidate rides the row itself (including the full readMe), so no
// per-hit follow-up read is required; the fieldset stays internal so a caller
// can never request full serializations that blow up the result size.
const PROJECTION_FIELDS = [
  'item.cardTitle',
  'item.cardDescription',
  'item.specType',
  'item.readMe',
  'item.ref',
  // `name` is the file-meta display handle — without it a file row's summary
  // carries nothing but its URL. Card rows have no `name` attribute, so the
  // sparse fieldset simply omits it there.
  'item.name',
];

interface EntrySummary {
  url: string;
  kind: 'card' | 'file';
  ref?: unknown;
  specType?: string;
  cardTitle?: string;
  cardDescription?: string;
  name?: string;
  readMe?: string;
  matchRelevance?: number;
}

function resolveScope(scope: string | undefined): SearchEntryScope {
  if (scope == null || scope === '') {
    return 'all';
  }
  if (!SCOPES.includes(scope as SearchEntryScope)) {
    throw new Error(
      `Invalid scope "${scope}": must be one of 'cards', 'files', 'all'`,
    );
  }
  return scope as SearchEntryScope;
}

// Prepares a caller's card-rooted query for the entry endpoint: under the
// mixed 'all' scope a card matches both its instance row and its dual-indexed
// `.json` file row, so the filter gains the card-instance-file exclusion —
// unless it already carries a kind-narrowing positive type ref, which matches
// only one of the two. A filter with a positive full-text `matches` term and
// no explicit sort gains the relevance sort (the server rejects that sort
// without such a term, so it is never added unconditionally).
// `addedRelevanceSort` reports the sort addition: the tool re-sorts merged
// rows client-side only for an ordering it imposed itself, never over one the
// caller chose (a caller's own sort may legally include `_matchRelevance`).
export function composeSearchEntriesQuery(
  query: Query,
  scope: SearchEntryScope,
): { query: Query; addedRelevanceSort: boolean } {
  let filter = query.filter;
  if (scope === 'all' && !hasNarrowingPositiveTypeRef(filter)) {
    filter = filter
      ? { every: [filter, excludeCardInstanceFileRows()] }
      : excludeCardInstanceFileRows();
  }
  let sort = query.sort;
  let addedRelevanceSort = false;
  if (!sort && collectPositiveMatchTerms(query.filter).length > 0) {
    sort = [{ by: MATCH_RELEVANCE_SORT_KEY, direction: 'desc' }];
    addedRelevanceSort = true;
  }
  return {
    query: {
      ...query,
      ...(filter ? { filter } : {}),
      ...(sort ? { sort } : {}),
    },
    addedRelevanceSort,
  };
}

function summarizeEntries(doc: EntryCollectionDocument): EntrySummary[] {
  let itemsByIdentity = new Map<
    string,
    CardResource<Saved> | FileMetaResource
  >();
  for (let resource of doc.included ?? []) {
    if (resource.type === 'card' || resource.type === 'file-meta') {
      itemsByIdentity.set(
        resourceIdentity(resource.type, resource.id),
        resource,
      );
    }
  }
  let summaries: EntrySummary[] = [];
  for (let entry of doc.data) {
    let itemRef = entry.relationships?.item?.data;
    if (!entry.id || !itemRef) {
      continue;
    }
    let item = itemsByIdentity.get(resourceIdentity(itemRef.type, itemRef.id));
    if (!item) {
      continue;
    }
    let attributes = (item.attributes ?? {}) as Record<string, unknown>;
    summaries.push({
      url: entry.id,
      kind: isFileMetaResource(item) ? 'file' : 'card',
      ref: attributes.ref,
      specType: attributes.specType as string | undefined,
      cardTitle: attributes.cardTitle as string | undefined,
      cardDescription: attributes.cardDescription as string | undefined,
      name: attributes.name as string | undefined,
      readMe: attributes.readMe as string | undefined,
      matchRelevance: entry.meta?._matchRelevance,
    });
  }
  return summaries;
}

export default class SearchEntriesTool extends HostBaseTool<
  typeof BaseToolModule.SearchEntriesInput,
  typeof BaseToolModule.SearchEntriesResult
> {
  @service declare private store: StoreService;

  static actionVerb = 'Search';

  description =
    'Search across realms for existing cards, specs, listings, themes, and files — ' +
    'the primary tool for discovery: always check what already exists before creating ' +
    'anything new. Takes a card query (`filter` supporting `type`/`on`/`eq`/`contains`/' +
    '`range`/`any`/`every`/`not` and full-text `matches`, plus optional `sort`), optional ' +
    '`realms` (realm URLs; defaults to every realm you can read), optional `scope` ' +
    "('cards' | 'files' | 'all', default 'all'), and optional `limit` (default " +
    `${DEFAULT_LIMIT}, max ${MAX_LIMIT}). Returns lightweight entry summaries — url, ` +
    'ref, specType, title, description, file name, full readMe, and full-text match ' +
    'relevance — not live card instances. A result with `incomplete: true` is ' +
    'partial: at least one searched realm failed to answer, so matches may be ' +
    'missing and `total` undercounts. When you need instances to attach, open, or ' +
    'patch, use the card-instance search tools instead.';

  requireInputFields = ['query'];

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.SearchEntriesInput;
  }

  protected async run(
    input: BaseToolModule.SearchEntriesInput,
  ): Promise<BaseToolModule.SearchEntriesResult> {
    assertQuery(input.query);
    let scope = resolveScope(input.scope);
    let limit = Math.min(
      Math.max(Math.floor(input.limit ?? DEFAULT_LIMIT), 1),
      MAX_LIMIT,
    );

    let { query, addedRelevanceSort } = composeSearchEntriesQuery(
      input.query,
      scope,
    );
    let wireQuery = searchEntryWireQueryFromQuery(query, {
      fields: PROJECTION_FIELDS,
      scope,
    });
    wireQuery.page = { ...wireQuery.page, size: limit };

    let realms = input.realms?.length ? [...input.realms] : undefined;
    let doc = await this.store.searchEntries(wireQuery, realms);

    let rows = summarizeEntries(doc);
    if (addedRelevanceSort) {
      // The federated merge concatenates per-realm results without re-ranking
      // across realms; relevance rides each entry so the merged page can be.
      // Only the tool's own default ordering is re-imposed here — a caller's
      // explicit sort (which may itself include `_matchRelevance`) stands.
      rows = [...rows].sort(
        (a, b) => (b.matchRelevance ?? -1) - (a.matchRelevance ?? -1),
      );
    }

    let commandModule = await this.loadToolModule();
    let { SearchEntriesResult, SearchEntrySummaryField } = commandModule;
    return new SearchEntriesResult({
      results: rows.map((row) => new SearchEntrySummaryField(row)),
      total: doc.meta.page.total,
      // A realm that fails (or never resolves) during the federated fan-out is
      // reported through this flag rather than a thrown error — the realms
      // that answered still return; the flag keeps their partiality visible.
      incomplete: doc.meta.incomplete === true,
      cardDescription: `Query: ${JSON.stringify(input.query.filter ?? {})}`,
    });
  }
}
