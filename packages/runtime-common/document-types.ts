import type { RealmInfo } from './realm';
import type { QueryResultsMeta, PrerenderedCard } from './index-query-engine';
import type { CardTypeSummary } from './index-structure';
import {
  type CardResource,
  type PrerenderedCardResource,
  type Saved,
  type Unsaved,
  isCardResource,
  isPrerenderedCardResource,
} from './resource-types';

export interface SingleCardDocument<Identity extends Unsaved = Saved> {
  data: CardResource<Identity>;
  included?: CardResource<Saved>[];
}
export interface CardCollectionDocument<Identity extends Unsaved = Saved> {
  data: CardResource<Identity>[];
  included?: CardResource<Saved>[];
  meta: QueryResultsMeta;
}

export interface PrerenderedCardCollectionDocument {
  data: PrerenderedCardResource[];
  meta: QueryResultsMeta & {
    scopedCssUrls?: string[];
    realmInfo?: RealmInfo;
  };
}

export type CardDocument = SingleCardDocument | CardCollectionDocument;

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

export function isSingleCardDocument(doc: any): doc is SingleCardDocument {
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
  return isCardResource(data);
}

export function isCardCollectionDocument(
  doc: any,
): doc is CardCollectionDocument {
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
  return data.every((resource) => isCardResource(resource));
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
  meta: QueryResultsMeta & { scopedCssUrls?: string[]; realmInfo?: RealmInfo };
}): PrerenderedCardCollectionDocument {
  let { prerenderedCards, scopedCssUrls, meta } = results;

  let data = prerenderedCards.map((card) => {
    let resource: PrerenderedCardResource = {
      type: 'prerendered-card',
      id: card.url,
      attributes: {
        html: card.html || '',
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

function isIncluded(included: any): included is CardResource<Saved>[] {
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
    if (!isCardResource(resource)) {
      return false;
    }
  }
  return true;
}
