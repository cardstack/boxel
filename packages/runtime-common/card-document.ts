import { type CodeRef, isCodeRef } from './code-ref';
import { RealmInfo } from './realm';
import { QueryResultsMeta, PrerenderedCard } from './index-query-engine';
import { type CardTypeSummary } from './index-structure';

export type Saved = string;
export type Unsaved = string | undefined;
export interface Meta {
  adoptsFrom: CodeRef;
  fields?: CardFields;
}
export interface CardFields {
  [fieldName: string]: Partial<Meta> | Partial<Meta>[];
}

interface ResourceID {
  type: string;
  id: string;
}

export type Relationship = {
  links: {
    // there are other valid items for links in the spec, but we don't
    // anticipate using them
    self: string | null;
    related?: string | null;
  };
  data?: ResourceID | ResourceID[] | null;
  meta?: Record<string, any>;
};

export type CardResourceMeta = Meta & {
  lastModified?: number;
  resourceCreatedAt?: number;
  realmInfo?: RealmInfo;
  realmURL?: string;
};

export interface CardResource<Identity extends Unsaved = Saved> {
  id: Identity;
  type: 'card';
  attributes?: Record<string, any>;
  relationships?: {
    [fieldName: string]: Relationship;
  };
  meta: CardResourceMeta;
  links?: {
    self?: string;
  };
}
export interface SingleCardDocument<Identity extends Unsaved = Saved> {
  data: CardResource<Identity>;
  included?: CardResource<Saved>[];
}
export interface CardCollectionDocument<Identity extends Unsaved = Saved> {
  data: CardResource<Identity>[];
  included?: CardResource<Saved>[];
}

export interface PrerenderedCardCollectionDocument {
  data: PrerenderedCardResource[];
  meta: QueryResultsMeta & {
    scopedCssUrls?: string[];
    realmInfo?: RealmInfo;
  };
}

export type CardDocument = SingleCardDocument | CardCollectionDocument;

export function isCardResource(resource: any): resource is CardResource {
  if (typeof resource !== 'object' || resource == null) {
    return false;
  }
  if ('id' in resource && typeof resource.id !== 'string') {
    return false;
  }
  if ('type' in resource && resource.type !== 'card') {
    return false;
  }
  if ('attributes' in resource && typeof resource.attributes !== 'object') {
    return false;
  }
  if ('relationships' in resource) {
    let { relationships } = resource;
    if (typeof relationships !== 'object' || relationships == null) {
      return false;
    }
    for (let [fieldName, relationship] of Object.entries(relationships)) {
      if (typeof fieldName !== 'string') {
        return false;
      }
      if (!isRelationship(relationship)) {
        return false;
      }
    }
  }
  if (!('meta' in resource) || typeof resource.meta !== 'object') {
    return false;
  }
  let { meta } = resource;

  if ('fields' in meta) {
    if (!isCardFields(meta.fields)) {
      return false;
    }
  }

  if (!('adoptsFrom' in meta) && typeof meta.adoptsFrom !== 'object') {
    return false;
  }
  let { adoptsFrom } = meta;
  return isCodeRef(adoptsFrom);
}

export function isCardFields(fields: any): fields is CardFields {
  if (typeof fields !== 'object') {
    return false;
  }
  for (let [fieldName, fieldItem] of Object.entries(
    fields as { [fieldName: string | symbol]: any },
  )) {
    if (typeof fieldName !== 'string') {
      return false;
    }
    if (Array.isArray(fieldItem)) {
      if (fieldItem.some((f) => !isMeta(f, true))) {
        return false;
      }
    } else if (!isMeta(fieldItem, true)) {
      return false;
    }
  }
  return true;
}

export function isMeta(meta: any, allowPartial: true): meta is Partial<Meta>;
export function isMeta(meta: any): meta is Meta;
export function isMeta(meta: any, allowPartial = false) {
  if (typeof meta !== 'object' || meta == null) {
    return false;
  }
  if ('adoptsFrom' in meta) {
    let { adoptsFrom } = meta;
    if (!isCodeRef(adoptsFrom)) {
      return false;
    }
  } else {
    if (!allowPartial) {
      return false;
    }
  }
  if ('fields' in meta) {
    if (!isCardFields(meta.fields)) {
      return false;
    }
  }
  return true;
}

export function isRelationship(
  relationship: any,
): relationship is Relationship {
  if (typeof relationship !== 'object' || relationship == null) {
    return false;
  }
  if ('meta' in relationship && typeof relationship.meta !== 'object') {
    return false;
  }
  if ('links' in relationship) {
    let { links } = relationship;
    if (typeof links !== 'object' || links == null) {
      return false;
    }
    if (!('self' in links)) {
      return false;
    }
    let { self } = links;
    if (typeof self !== 'string' && self !== null) {
      return false;
    }
    if ('related' in links) {
      if (typeof links.related !== 'string' && links.related !== null) {
        return false;
      }
    }
  } else if ('data' in relationship) {
    let { data } = relationship;
    if (typeof data !== 'object') {
      return false;
    }
    if (data !== null && 'type' in data && 'id' in data) {
      let { type, id } = data;
      if (typeof type !== 'string' || typeof id !== 'string') {
        return false;
      }
    }
  } else {
    return false;
  }
  return true;
}

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

export interface PrerenderedCardResource {
  id: string;
  type: 'prerendered-card';
  attributes: {
    html: string;
    isError?: true;
  };
  relationships: {
    'prerendered-card-css': {
      data: { id: string }[];
    };
  };
  meta: Meta & {};
  links?: {
    self?: string;
  };
}

export function isPrerenderedCardResource(
  resource: any,
): resource is PrerenderedCardResource {
  if (typeof resource !== 'object' || resource == null) {
    return false;
  }
  if ('id' in resource && typeof resource.id !== 'string') {
    return false;
  }
  if ('type' in resource && resource.type !== 'prerendered-card') {
    return false;
  }
  if ('attributes' in resource && typeof resource.attributes !== 'object') {
    return false;
  }
  return true;
}

function isIncluded(included: any): included is CardResource<Saved>[] {
  if (!Array.isArray(included)) {
    return false;
  }
  for (let resource of included) {
    if (typeof resource !== 'object' || !resource) {
      return false;
    }
    if (!('id' in resource) || typeof resource.id !== 'string') {
      return false;
    }
    if (!isCardResource(resource)) {
      return false;
    }
  }
  return true;
}

export function transformResultsToPrerenderedCardsDoc(results: {
  prerenderedCards: PrerenderedCard[];
  scopedCssUrls: string[];
  meta: QueryResultsMeta & { scopedCssUrls?: string[]; realmInfo?: RealmInfo };
}) {
  let { prerenderedCards, scopedCssUrls, meta } = results;

  let data = prerenderedCards.map((card) => ({
    type: 'prerendered-card',
    id: card.url,
    attributes: {
      html: card.html,
      usedRenderType: card.usedRenderType,
      ...(card.isError ? { isError: true as const } : {}),
    },
  }));

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
