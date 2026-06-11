import type { RealmInfo } from './realm.ts';
import type {
  QueryResultsMeta,
  PrerenderedCard,
} from './index-query-engine.ts';
import type { CardTypeSummary, RealmMetaValue } from './index-structure.ts';
import type { CodeRef } from './code-ref.ts';
import {
  type CardResource,
  type CssResource,
  type FileMetaResource,
  type HtmlResource,
  type PrerenderedCardResource,
  type RenderedHtmlResource,
  type Saved,
  type SearchEntryResource,
  type Unsaved,
  isCardResource,
  isFileMetaResource,
  isPrerenderedCardResource,
} from './resource-types.ts';

export interface SingleCardDocument<Identity extends Unsaved = Saved> {
  data: CardResource<Identity>;
  included?: (FileMetaResource | CardResource<Saved>)[];
}
export interface CardCollectionDocument<Identity extends Unsaved = Saved> {
  data: CardResource<Identity>[];
  included?: (FileMetaResource | CardResource<Saved>)[];
  meta: QueryResultsMeta;
}

export interface PrerenderedCardCollectionDocument {
  data: PrerenderedCardResource[];
  meta: QueryResultsMeta & {
    scopedCssUrls?: string[];
    realmInfo?: RealmInfo;
    isFileMeta?: boolean;
  };
}

// The unified search response is heterogeneous, per row: a result resolves
// either to a full live `card`/`file-meta` (its `attributes`/`relationships`
// shipped in `data`, exactly as `/_search` returns today) or — preferentially —
// to prerendered HTML, in which case `data` carries an identity-only `card`
// (no `attributes`) and the rendering rides in `included` as a `rendered-html`
// plus its deduped `css` stylesheets.
export type UnifiedSearchIncludedResource =
  | CardResource<Saved>
  | FileMetaResource
  | RenderedHtmlResource
  | CssResource;

export interface UnifiedSearchCollectionDocument<
  Identity extends Unsaved = Saved,
> {
  data: (CardResource<Identity> | FileMetaResource)[];
  included?: UnifiedSearchIncludedResource[];
  meta: QueryResultsMeta & {
    // The render type resolved for this search, echoed at the collection level
    // so a live/fallback row renders as the same ancestor type as its HTML
    // siblings.
    renderType?: CodeRef;
  };
}

// The v2 search response: heterogeneous `search-entry` resources in `data`,
// with everything they compose — `html` renderings (plus their deduped `css`
// stylesheets) and/or `card`/`file-meta` `item` serializations — riding in
// `included`. Which branches appear per entry is governed by the query's
// sparse fieldset (default: prefer `html`, fall back to `item`).
export type SearchEntryIncludedResource =
  | HtmlResource
  | CssResource
  | CardResource<Saved>
  | FileMetaResource;

export interface SearchEntryCollectionDocument {
  data: SearchEntryResource[];
  included?: SearchEntryIncludedResource[];
  meta: QueryResultsMeta;
}

export interface SingleFileMetaDocument {
  data: FileMetaResource;
  included?: (FileMetaResource | CardResource<Saved>)[];
}
export interface FileMetaCollectionDocument {
  data: FileMetaResource[];
  included?: (FileMetaResource | CardResource<Saved>)[];
  meta: QueryResultsMeta;
}

export interface LinkableCollectionDocument {
  data: (CardResource<Saved> | FileMetaResource)[];
  included?: (FileMetaResource | CardResource<Saved>)[];
  meta: QueryResultsMeta;
}

export type CardDocument = SingleCardDocument | CardCollectionDocument;
export type FileMetaDocument =
  | SingleFileMetaDocument
  | FileMetaCollectionDocument;
export type LinkableDocument = CardDocument | FileMetaDocument;

export function isCardDocument(doc: any): doc is CardDocument {
  return isSingleCardDocument(doc) || isCardCollectionDocument(doc);
}

export function isCardDocumentString(maybeJsonString: string) {
  try {
    let doc = JSON.parse(maybeJsonString);
    return isSingleCardDocument(doc) || isCardCollectionDocument(doc);
  } catch (err) {
    return false;
  }
}

// Pure shape predicates for card documents live in `card-document-shape.ts`
// so callers that only need to recognize a card document don't pull the
// transitive runtime chain. Re-exported here for backward compat; the
// local imports let the remainder of this file call them directly.
import {
  isSingleCardDocument,
  isCardCollectionDocument,
} from './card-document-shape.ts';
export { isSingleCardDocument, isCardCollectionDocument };

export function isFileMetaCollectionDocument(
  doc: any,
): doc is FileMetaCollectionDocument {
  if (typeof doc !== 'object' || doc == null) {
    return false;
  }
  if (!('data' in doc)) {
    return false;
  }
  let { data } = doc;
  if (!Array.isArray(data)) {
    return false;
  }
  if ('included' in doc) {
    let { included } = doc;
    if (!isIncluded(included)) {
      return false;
    }
  }
  return data.every((resource) => isFileMetaResource(resource));
}

export function isLinkableCollectionDocument(
  doc: any,
): doc is LinkableCollectionDocument {
  return isCardCollectionDocument(doc) || isFileMetaCollectionDocument(doc);
}

export function isPrerenderedCardCollectionDocument(
  doc: any,
): doc is PrerenderedCardCollectionDocument {
  if (typeof doc !== 'object' || doc == null) {
    return false;
  }
  if (!('data' in doc) || !('meta' in doc)) {
    return false;
  }
  let { data } = doc;
  if (!Array.isArray(data)) {
    return false;
  }
  return data.every((resource) => isPrerenderedCardResource(resource));
}

export function transformResultsToPrerenderedCardsDoc(results: {
  prerenderedCards: PrerenderedCard[];
  scopedCssUrls: string[];
  meta: QueryResultsMeta & {
    scopedCssUrls?: string[];
    realmInfo?: RealmInfo;
    isFileMeta?: boolean;
  };
}): PrerenderedCardCollectionDocument {
  let { prerenderedCards, scopedCssUrls, meta } = results;

  let data = prerenderedCards.map((card) => {
    let resource: PrerenderedCardResource = {
      type: 'prerendered-card',
      id: card.url,
      attributes: {
        html: card.html || '',
        ...(card.cardType ? { cardType: card.cardType } : {}),
        ...(card.iconHtml ? { iconHtml: card.iconHtml } : {}),
        ...(card.isError ? { isError: true as const } : {}),
      },
      relationships: {
        'prerendered-card-css': {
          data: [],
        },
      },
      meta: {},
    };
    if (card.usedRenderType) {
      resource.meta.adoptsFrom = card.usedRenderType;
    }
    return resource;
  });

  meta.scopedCssUrls = scopedCssUrls;

  return {
    data,
    meta,
  };
}

export type CardTypeSummaryKind = 'instance' | 'file';

// JSON:API representation of one entry from `realm_meta.value`. Clients
// partition the flat array by `kind` on read — see CardsGrid's
// `loadFilterList`. Keeping a single resource shape with a discriminator
// (rather than two parallel `data` arrays) preserves the existing contract for
// callers that only care about one kind.
export interface CardTypeSummaryEntry {
  type: 'card-type-summary';
  id: string;
  attributes: {
    displayName: string;
    total: number;
    iconHTML: string;
    kind: CardTypeSummaryKind;
  };
}

function summaryToEntry(
  summary: CardTypeSummary,
  kind: CardTypeSummaryKind,
): CardTypeSummaryEntry {
  return {
    type: 'card-type-summary',
    id: summary.code_ref,
    attributes: {
      displayName: summary.display_name,
      total: summary.total,
      iconHTML: summary.icon_html,
      kind,
    },
  };
}

// Accepts either the partitioned RealmMetaValue (current shape) or a bare
// CardTypeSummary[] (legacy callers that pre-filtered to instances). In both
// cases the output is a flat list of entries discriminated by `kind`.
export function makeCardTypeSummaryDoc(
  summaries: RealmMetaValue | CardTypeSummary[],
) {
  let value: RealmMetaValue;
  if (Array.isArray(summaries)) {
    value = { instances: summaries, files: [] };
  } else {
    value = summaries;
  }
  let data: CardTypeSummaryEntry[] = [
    ...value.instances.map((s) => summaryToEntry(s, 'instance')),
    ...value.files.map((s) => summaryToEntry(s, 'file')),
  ];
  return { data };
}

export interface FederatedCardTypeSummaryEntry {
  type: 'card-type-summary';
  id: string;
  attributes: {
    displayName: string;
    total: number;
    iconHTML: string;
    kind: CardTypeSummaryKind;
  };
  meta: {
    realmURL: string;
  };
}

export function makeFederatedCardTypeSummaryDoc(
  entries: FederatedCardTypeSummaryEntry[],
  total: number,
) {
  return {
    data: entries,
    meta: {
      page: { total },
    },
  };
}

function isIncluded(
  included: any,
): included is (CardResource<Saved> | FileMetaResource)[] {
  if (!Array.isArray(included)) {
    return false;
  }
  for (let resource of included) {
    if (typeof resource !== 'object' || !resource) {
      return false;
    }
    if (
      (!('id' in resource) || typeof resource.id !== 'string') &&
      (!('lid' in resource) || typeof resource.lid !== 'string')
    ) {
      return false;
    }
    if (!isCardResource(resource) && !isFileMetaResource(resource)) {
      return false;
    }
  }
  return true;
}

export function isSingleFileMetaDocument(
  doc: any,
): doc is SingleFileMetaDocument {
  if (typeof doc !== 'object' || doc == null) {
    return false;
  }
  if (!('data' in doc)) {
    return false;
  }
  let { data } = doc;
  if (Array.isArray(data)) {
    return false;
  }
  if ('included' in doc) {
    let { included } = doc;
    if (!isIncluded(included)) {
      return false;
    }
  }
  return isFileMetaResource(data);
}
