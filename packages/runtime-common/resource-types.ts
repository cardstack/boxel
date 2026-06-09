import { md5 } from 'super-fast-md5';
import type { RealmInfo } from './realm.ts';
import { type CodeRef, moduleFrom } from './code-ref.ts';
import type {
  RealmResourceIdentifier,
  RealmIdentifier,
} from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';
import type { Query } from './query.ts';

// Metadata for a query-based linksTo/linksToMany field on a FileDef subclass,
// extracted during file prerendering so that file-meta responses can populate
// query relationships without a runtime definition lookup (which would
// deadlock when the request is served during card prerendering).
export interface QueryFieldMeta {
  type: 'linksTo' | 'linksToMany';
  query: Query;
  fieldOrCard: CodeRef;
}

export const CardResourceType = 'card';
export const FileMetaResourceType = 'file-meta';
export const RenderedHtmlResourceType = 'rendered-html';
export const CssResourceType = 'css';
// resource
export type Resource =
  | ModuleResource
  | CardResource
  | PrerenderedCardResource
  | RenderedHtmlResource
  | CssResource;
export type ResourceMeta = ModuleMeta | Meta;
export type LinkableResource = CardResource | FileMetaResource;

//modules
export type ModuleMeta = {};

export interface ModuleResource {
  id?: string;
  type: 'source';
  attributes?: { content: string };
  meta: ModuleMeta;
}

//cards
export type Saved = RealmResourceIdentifier;
export type Unsaved = RealmResourceIdentifier | undefined;
export interface Meta {
  adoptsFrom: CodeRef;
  fields?: CardFields;
}
export interface CardFields {
  [fieldName: string]: Partial<Meta> | Partial<Meta>[];
}

export type ResourceID = ResourceRemoteID | ResourceLocalID;

interface ResourceRemoteID {
  type: string;
  id: string;
}

interface ResourceLocalID {
  type: string;
  lid: string;
}

export type Relationship = {
  links?: {
    // there are other valid items for links in the spec, but we don't
    // anticipate using them
    self?: string | null;
    related?: string | null;
    search?: string | null;
  };
  data?: ResourceID | ResourceID[] | null;
  meta?: Record<string, any>;
};

export type CardResourceMeta = Meta & {
  lastModified?: number;
  resourceCreatedAt?: number;
  realmInfo?: RealmInfo;
  realmURL?: RealmIdentifier;
  // Set by the server on an HTML-backed result to mark this `card` as
  // identity-only: identity + a `rendered-html` relationship, with the live
  // serialization deliberately withheld (no `attributes`; hydration fetches it
  // on demand). The authoritative wire signal that a consumer must not treat
  // this resource as a complete instance — see `isIdentityOnlyCardResource`.
  identityOnly?: boolean;
};

export type FileMetaResourceResourceMeta = Meta & {
  realmInfo?: RealmInfo;
  realmURL?: RealmIdentifier;
  queryFieldDefs?: Record<string, QueryFieldMeta>;
  // See CardResourceMeta.identityOnly — a file-meta result can likewise be
  // HTML-backed and identity-only.
  identityOnly?: boolean;
};

export interface CardResource<Identity extends Unsaved = Saved> {
  id?: Identity;
  lid?: string;
  type: typeof CardResourceType;
  attributes?: Record<string, any>;
  relationships?: {
    [fieldName: string]: Relationship | Relationship[];
  } & {
    // The card's rendering, when the server resolves this row to prerendered
    // HTML. A reserved platform key (see RenderedHtmlResourceType) that can
    // never collide with a userland @field name.
    'rendered-html'?: Relationship;
  };
  meta: CardResourceMeta;
  links?: {
    self?: string;
  };
}

export interface FileMetaResource {
  id?: Saved;
  type: typeof FileMetaResourceType;
  attributes?: Record<string, any>;
  relationships?: {
    [fieldName: string]: Relationship | Relationship[];
  } & {
    'rendered-html'?: Relationship;
  };
  meta: FileMetaResourceResourceMeta;
  links?: {
    self?: string;
  };
}

// One prerendered presentation of a card/file (a single format per response).
// Its `id` is the bare card/file URL — the same id as the `card`/`file-meta`
// resource it renders; `type` is what distinguishes them. The scoped CSS the
// rendering needs travels as first-class `css` resources linked through
// `styles` (deduped in `included` by identity).
export interface RenderedHtmlResource {
  id: string;
  type: typeof RenderedHtmlResourceType;
  attributes: {
    html: string;
    cardType: string;
    iconHtml?: string;
    isError?: boolean;
  };
  relationships: {
    styles: {
      data: { type: typeof CssResourceType; id: string }[];
    };
  };
  // The ancestor type the HTML was rendered as (echoed from the request's
  // resolved render type).
  meta?: {
    renderType?: CodeRef;
  };
}

// A scoped stylesheet referenced by a `rendered-html` resource. The scoped-CSS
// URL base64-embeds the whole stylesheet, so it travels exactly once here in
// `attributes.href` (the host loads it via `loader.import`); the `id` is a
// stable content hash of that URL (see `cssResourceId`) so `styles.data[].id`
// references stay short and `included` dedupes identical stylesheets for free.
export interface CssResource {
  id: string;
  type: typeof CssResourceType;
  attributes: {
    href: string;
  };
}

export type LooseLinkableResource<T extends LinkableResource> = Omit<
  T,
  'id' | 'type'
> & {
  type?: T['type'];
  id?: string;
};

export type LooseCardResource = LooseLinkableResource<CardResource>;
export type LooseFileMetaResource = LooseLinkableResource<FileMetaResource>;

//prerendered cards
export interface PrerenderedCardResource {
  id: string;
  type: 'prerendered-card';
  attributes: {
    html: string;
    cardType?: string;
    iconHtml?: string;
    isError?: true;
  };
  relationships: {
    'prerendered-card-css': {
      data: { id: string }[];
    };
  };
  meta: Partial<Meta>;
  links?: {
    self?: string;
  };
}

//validation - modules
export function isModuleResource(resource: any): resource is ModuleResource {
  if (typeof resource !== 'object' || resource == null) {
    return false;
  }
  return resource.type === 'source';
}

// Pure shape predicates live in `card-document-shape.ts` so callers that
// only need to recognize a JSON:API resource don't pull the transitive
// runtime chain rooted in this file (`realm-identifiers.ts` →
// `loader.ts` → `realm.ts` → ...). Re-exported here for backward compat.
export {
  isCardResource,
  isFileMetaResource,
  isCardFields,
  isMeta,
  isRelationship,
  isRenderedHtmlResource,
  isCssResource,
  isIdentityOnlyCardResource,
} from './card-document-shape.ts';

// The `css` resource id: a content hash of the (base64-embedding) scoped-CSS
// URL. Server and host compute it through this one helper so identical
// stylesheets dedupe to the same `(type, id)` in `included`. md5 is our
// standing convention for non-security fingerprints (see `transpile.ts`).
export function cssResourceId(href: string): string {
  return md5(href);
}

export function extractRelationshipIds(
  relationship: Relationship,
  baseUrl: string | URL,
  virtualNetwork: VirtualNetwork,
): RealmResourceIdentifier[] {
  let ids: RealmResourceIdentifier[] = [];
  let data = relationship.data;
  if (!data || typeof data !== 'object') {
    return ids;
  }
  let resolveId = (id: string): RealmResourceIdentifier => {
    try {
      return virtualNetwork.resolveURL(id, baseUrl)
        .href as RealmResourceIdentifier;
    } catch {
      return id as RealmResourceIdentifier;
    }
  };
  if (Array.isArray(data)) {
    for (let item of data) {
      if (item && typeof item === 'object' && 'id' in item) {
        let id = (item as { id?: string }).id;
        if (typeof id === 'string') {
          ids.push(resolveId(id));
        }
      }
    }
    return ids;
  }
  if ('id' in data) {
    let id = (data as { id?: string }).id;
    if (typeof id === 'string') {
      ids.push(resolveId(id));
    }
  }
  return ids;
}

//validation - prerendered cards
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

export function modulesConsumedInMeta(meta: Partial<Meta>): string[] {
  let modules: string[] = [];
  if (meta.adoptsFrom) {
    modules.push(moduleFrom(meta.adoptsFrom));
  }
  for (let fieldMeta of Object.values(meta.fields ?? {})) {
    if (Array.isArray(fieldMeta)) {
      for (let item of fieldMeta) {
        modules.push(...modulesConsumedInMeta(item));
      }
    } else {
      modules.push(...modulesConsumedInMeta(fieldMeta));
    }
  }
  return [...new Set(modules)];
}
