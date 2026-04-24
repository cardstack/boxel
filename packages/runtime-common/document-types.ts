import type { RealmInfo } from './realm';
import type { QueryResultsMeta, PrerenderedCard } from './index-query-engine';
import type { CardTypeSummary } from './index-structure';
import {
  type CardResource,
  type FileMetaResource,
  type PrerenderedCardResource,
  type Saved,
  type Unsaved,
  isCardResource,
  isFileMetaResource,
  isPrerenderedCardResource,
} from './resource-types';

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
} from './card-document-shape';
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

export function makeCardTypeSummaryDoc(summaries: CardTypeSummary[]) {
  let data = summaries.map((summary) => ({
    type: 'card-type-summary',
    id: summary.code_ref,
    attributes: {
      displayName: summary.display_name,
      total: summary.total,
      iconHTML: summary.icon_html,
    },
  }));

  return { data };
}

export interface FederatedCardTypeSummaryEntry {
  type: 'card-type-summary';
  id: string;
  attributes: {
    displayName: string;
    total: number;
    iconHTML: string;
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
