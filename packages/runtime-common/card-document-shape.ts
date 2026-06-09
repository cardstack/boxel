/**
 * Pure shape-validation predicates for JSON:API card documents.
 *
 * These functions live here (rather than directly in `resource-types.ts`
 * / `document-types.ts` / `code-ref.ts`) so that callers which only need
 * to know whether a payload *looks* like a card document can import them
 * without pulling the transitive runtime chain rooted at
 * `resource-types.ts` → `realm-identifiers.ts` → `loader.ts` →
 * `realm.ts` → `realm-index-query-engine.ts` — a heavy, Node-oriented
 * chain that lightweight callers (e.g. browser or Playwright loaders)
 * should not have to pull in just to shape-check a payload.
 *
 * This module only `import type`s from those neighbors — all runtime
 * type-guards are defined inline — so it has no runtime dependency on
 * that chain.
 *
 * The original `code-ref.ts` / `resource-types.ts` / `document-types.ts`
 * re-export these predicates for backward compat, so existing imports
 * keep working; new callers that must avoid the heavy chain should
 * import from `@cardstack/runtime-common/card-document-shape` directly.
 */

import type { CodeRef, ResolvedCodeRef } from './code-ref.ts';
import type {
  CardFields,
  CardResource,
  CssResource,
  FileMetaResource,
  Meta,
  Relationship,
  RenderedHtmlResource,
  Saved,
} from './resource-types.ts';
import type {
  CardCollectionDocument,
  SingleCardDocument,
} from './document-types.ts';

// Inlined — reading these via a runtime `import` from `resource-types.ts`
// would pull in `code-ref.ts` → `loader.ts`, which is exactly the
// decorator chain this module is meant to bypass. The constants are
// string literals; keep them type-checked against the original
// declarations in `resource-types.ts` via the `CardResource['type']` /
// `FileMetaResource['type']` field types.
const CardResourceType: CardResource['type'] = 'card';
const FileMetaResourceType: FileMetaResource['type'] = 'file-meta';
const RenderedHtmlResourceType: RenderedHtmlResource['type'] = 'rendered-html';
const CssResourceType: CssResource['type'] = 'css';

// ---------------------------------------------------------------------------
// Code refs
// ---------------------------------------------------------------------------

export function isResolvedCodeRef(ref?: CodeRef | {}): ref is ResolvedCodeRef {
  if (ref && 'module' in ref && 'name' in ref) {
    return true;
  }
  return false;
}

export function isCodeRef(ref: any): ref is CodeRef {
  if (!ref || typeof ref !== 'object') {
    return false;
  }
  if (!('type' in ref)) {
    if (!('module' in ref) || !('name' in ref)) {
      return false;
    }
    return typeof ref.module === 'string' && typeof ref.name === 'string';
  } else if (ref.type === 'ancestorOf') {
    if (!('card' in ref)) {
      return false;
    }
    return isCodeRef(ref.card);
  } else if (ref.type === 'fieldOf') {
    if (!('card' in ref) || !('field' in ref)) {
      return false;
    }
    if (typeof ref.card !== 'object' || typeof ref.field !== 'string') {
      return false;
    }
    return isCodeRef(ref.card);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

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
    if (data !== null && 'type' in data && 'lid' in data) {
      let { type, lid } = data;
      if (typeof type !== 'string' || typeof lid !== 'string') {
        return false;
      }
    }
  } else {
    return false;
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

export function isCardResource(resource: any): resource is CardResource {
  if (typeof resource !== 'object' || resource == null) {
    return false;
  }
  if ('id' in resource && typeof resource.id !== 'string') {
    return false;
  }
  if ('lid' in resource && typeof resource.lid !== 'string') {
    return false;
  }
  if ('type' in resource && resource.type !== CardResourceType) {
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
      if (Array.isArray(relationship)) {
        if (relationship.some((entry) => !isRelationship(entry))) {
          return false;
        }
      } else if (!isRelationship(relationship)) {
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

  if (!('adoptsFrom' in meta) || typeof meta.adoptsFrom !== 'object') {
    return false;
  }
  let { adoptsFrom } = meta;
  return isCodeRef(adoptsFrom);
}

export function isFileMetaResource(
  resource: any,
): resource is FileMetaResource {
  if (typeof resource !== 'object' || resource == null) {
    return false;
  }
  if ('id' in resource && typeof resource.id !== 'string') {
    return false;
  }
  if (!('type' in resource) || resource.type !== FileMetaResourceType) {
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
      if (Array.isArray(relationship)) {
        if (relationship.some((entry) => !isRelationship(entry))) {
          return false;
        }
      } else if (!isRelationship(relationship)) {
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

export function isRenderedHtmlResource(
  resource: any,
): resource is RenderedHtmlResource {
  if (typeof resource !== 'object' || resource == null) {
    return false;
  }
  if (resource.type !== RenderedHtmlResourceType) {
    return false;
  }
  if (typeof resource.id !== 'string') {
    return false;
  }
  let { attributes } = resource;
  if (typeof attributes !== 'object' || attributes == null) {
    return false;
  }
  if (
    typeof attributes.html !== 'string' ||
    typeof attributes.cardType !== 'string'
  ) {
    return false;
  }
  // The has-many `styles` relationship is part of the type, so a sound guard
  // must confirm it before a consumer reads the stylesheet links.
  let styles = resource.relationships?.styles;
  return Boolean(styles && Array.isArray(styles.data));
}

export function isCssResource(resource: any): resource is CssResource {
  if (typeof resource !== 'object' || resource == null) {
    return false;
  }
  if (resource.type !== CssResourceType) {
    return false;
  }
  if (typeof resource.id !== 'string') {
    return false;
  }
  if (typeof resource.attributes !== 'object' || resource.attributes == null) {
    return false;
  }
  return typeof resource.attributes.href === 'string';
}

// An "identity-only" card: the server's representation for an HTML-backed
// result — identity (`id`/`meta`/`links.self`) plus a `rendered-html`
// relationship, with the live serialization deliberately withheld (no
// `attributes`; hydration fetches it on demand).
//
// The definitive signal is the explicit `meta.identityOnly` flag the server
// stamps on the wire — NOT the absence of `attributes`, which is a weak tell
// (a full card with only relationship-typed fields can also serialize without
// `attributes`). The flag means a consumer must not treat this resource as a
// complete instance (it must not enter the Store; hydrate via `links.self`).
export function isIdentityOnlyCardResource(
  resource: any,
): resource is CardResource {
  if (!isCardResource(resource)) {
    return false;
  }
  return resource.meta?.identityOnly === true;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

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
