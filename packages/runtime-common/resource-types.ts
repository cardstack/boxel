import { md5 } from 'super-fast-md5';
import type { ErrorEntry } from './error.ts';
import type { RealmInfo } from './realm.ts';
import { type CodeRef, type ResolvedCodeRef, moduleFrom } from './code-ref.ts';
import type { PrerenderedHtmlFormat } from './prerendered-html-format.ts';
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
export const CssResourceType = 'css';
export const SearchEntryResourceType = 'search-entry';
export const HtmlResourceType = 'html';
export const IconResourceType = 'icon';
// resource
export type Resource =
  | ModuleResource
  | CardResource
  | CssResource
  | SearchEntryResource
  | HtmlResource
  | IconResource;
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
  // Set on a field-limited serialization: the names of the fields it carries.
  // Presence marks the resource sparse — distinguishing "only these fields
  // were loaded" from "a full card whose other fields happen to be empty" —
  // and a sparse resource must never enter the Store (it would misrepresent
  // the instance and could clobber a correctly-loaded full one). Absence
  // marks the serialization full.
  sparseFields?: string[];
  // The result's error doc, when this serialization stands in for a card that
  // failed to render/index. Present => the live `item` cannot render, so a
  // consumer falls through to the host error component (the terminal rung of
  // the resolution chain) and never deposits the resource into the Store.
  error?: ErrorEntry;
};

export type FileMetaResourceResourceMeta = Meta & {
  realmInfo?: RealmInfo;
  realmURL?: RealmIdentifier;
  queryFieldDefs?: Record<string, QueryFieldMeta>;
  // See CardResourceMeta.sparseFields — a file-meta serialization can likewise
  // be field-limited.
  sparseFields?: string[];
  // See CardResourceMeta.error — a file-meta serialization can likewise carry
  // the result's error doc when it failed to render.
  error?: ErrorEntry;
};

export interface CardResource<Identity extends Unsaved = Saved> {
  id?: Identity;
  lid?: string;
  type: typeof CardResourceType;
  attributes?: Record<string, any>;
  relationships?: {
    [fieldName: string]: Relationship | Relationship[];
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
  };
  meta: FileMetaResourceResourceMeta;
  links?: {
    self?: string;
  };
}

// A scoped stylesheet referenced by an `html` rendering. The scoped-CSS
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

// A card type's presentation descriptor — the per-type data that is identical
// across every result of that type (its icon, display name, and code ref), so
// it rides as its own deduped resource rather than repeated on each rendering.
// Its `id` is the type's internal key (the `<module>/<name>` form already
// carried as a row's `types[0]`), so identical types collapse to one
// `(type, id)` in `included`. Reached from the `search-entry` (not the `html`)
// so item-only / no-HTML rows resolve their type descriptor too.
export interface IconResource {
  id: string;
  type: typeof IconResourceType;
  attributes: {
    iconHtml: string;
    // The card def's display name (e.g. "Author").
    displayName: string;
    // The card def's resolved code ref — the structured form of the
    // `<module>/<name>` the `id` encodes, so consumers needn't re-parse it.
    codeRef: ResolvedCodeRef;
  };
}

// The synthesized rendering-selection query bound on a `search-entry` (the
// "htmlQuery"): a boolean sub-query over the rendering dimensions — `eq`
// leaves composed with `every`/`any`/`not`, with real boolean semantics
// (`not(not(q))` selects exactly what `q` selects). It selects which of an
// entry's indexed renderings (formats × ancestor render types) populate the
// `html` has-many; it never affects entry membership.
export type HtmlQuery =
  | { eq: HtmlQueryLeaf }
  | { every: HtmlQuery[] }
  | { any: HtmlQuery[] }
  | { not: HtmlQuery };

// An `eq` leaf over the rendering dimensions; several keys in one leaf are
// conjoined, and at least one must be present (an unconstrained leaf is
// unsupported).
export interface HtmlQueryLeaf {
  format?: PrerenderedHtmlFormat;
  renderType?: CodeRef;
}

// One v2 search result. A platform resource — never a userland card — so its
// relationships cannot collide with user `@field` names. Its `id` is the bare
// card/file URL, shared with its `item` (`card`/`file-meta`) serialization;
// `type` is the discriminator. The branches are composition: the `html`
// has-many carries the renderings selected by the query's htmlQuery (an empty
// array = the entry matched but no rendering satisfies the htmlQuery yet);
// `item` points at the live serialization. Which branches appear is governed
// by the query's sparse fieldset (default: the selected renderings, falling
// back to `item` — with the `html` relationship omitted — where none match).
export interface SearchEntryResource {
  id: string;
  type: typeof SearchEntryResourceType;
  relationships: {
    html?: {
      data: { type: typeof HtmlResourceType; id: string }[];
    };
    item?: {
      data: {
        type: typeof CardResourceType | typeof FileMetaResourceType;
        id: string;
      };
    };
    // The result's card-type icon, deduped across entries of the same type.
    // Present whenever the row carries an `icon_html`; reached here (not on
    // `html`) so item-only / no-HTML rows resolve it too.
    icon?: {
      data: { type: typeof IconResourceType; id: string };
    };
  };
}

// One prerendered rendering of a card/file: a v2 resource whose `id` is the
// (card URL, format, renderType) composite (see `htmlResourceId`), so each
// rendering of a card — per format × render type — is an independently
// cacheable/dedupable resource. The scoped CSS it needs travels as
// first-class `css` resources linked through `styles`.
export interface HtmlResource {
  id: string;
  type: typeof HtmlResourceType;
  attributes: {
    // Absent only on an error rendering with no last-known-good HTML.
    html?: string;
    cardType: string;
    isError?: boolean;
    format: PrerenderedHtmlFormat;
    // The type this rendering was rendered as — the result's own native type
    // unless the query asked for an ancestor. A file rendering carries no
    // renderType (files render natively; there is no ancestor coercion).
    renderType?: ResolvedCodeRef;
  };
  relationships: {
    styles: {
      data: { type: typeof CssResourceType; id: string }[];
    };
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
  isCssResource,
  isIconResource,
  isSearchEntryResource,
  isHtmlResource,
  isSparseItemResource,
} from './card-document-shape.ts';

// The map/set key for a JSON:API `(type, id)` identity pair lives in its own
// dependency-free module so it is importable outside the card-api graph; it is
// re-exported here so the index and existing call sites keep resolving it from
// `resource-types`.
export {
  RESOURCE_IDENTITY_SEPARATOR,
  resourceIdentity,
} from './resource-identity.ts';

// The `css` resource id: a content hash of the (base64-embedding) scoped-CSS
// URL. Server and host compute it through this one helper so identical
// stylesheets dedupe to the same `(type, id)` in `included`. md5 is our
// standing convention for non-security fingerprints (see `transpile.ts`).
export function cssResourceId(href: string): string {
  return md5(href);
}

// The `html` resource id: the (card URL, format, renderType) composite that
// makes each rendering an independently cacheable resource. Consumers treat
// it as an opaque cache key — the readable format/renderType live in the
// resource's attributes. `#` is the composite delimiter at both joints
// (neither card URLs nor module URLs contain one); the `/` inside the
// renderType segment is just the renderType key's own `<module>/<name>`
// encoding (the same string the `used_render_type` SQL column carries). A
// file rendering has no renderType, so its id is just `<fileURL>#<format>`.
export function htmlResourceId(args: {
  url: string;
  format: PrerenderedHtmlFormat;
  renderType?: ResolvedCodeRef;
}): string {
  let { url, format, renderType } = args;
  return `${url}#${format}${
    renderType ? `#${renderType.module}/${renderType.name}` : ''
  }`;
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

// True when `key` is `fieldName` followed by a plain array index (e.g.
// `items.1`), the shape `meta.fields` uses for a primitive polymorphic
// containsMany. Excludes deeper paths like `items.1.nested`.
export function isDirectIndexedFieldKey(
  key: string,
  fieldName: string,
): boolean {
  let prefix = `${fieldName}.`;
  if (!key.startsWith(prefix)) {
    return false;
  }
  let suffix = key.slice(prefix.length);
  let index = Number(suffix);
  return Number.isInteger(index) && index >= 0 && String(index) === suffix;
}

// Remove the field metadata describing an array attribute that a patch fully
// replaces. A merge that overwrites arrays in `attributes` still deep-merges the
// `meta.fields` object, so without this the removed elements' per-index metadata
// survives and can be re-applied to a new entry when the array grows again.
// Covers both serialization shapes: the array-valued `meta.fields[fieldName]` of
// a composite containsMany and the per-index `meta.fields['fieldName.0']` keys of
// a primitive polymorphic containsMany.
export function clearReplacedArrayFieldMeta(
  meta: Partial<Meta> | undefined,
  attributes: Record<string, unknown> | undefined,
): void {
  if (!meta?.fields || !attributes) {
    return;
  }
  let fields = meta.fields;
  for (let [fieldName, value] of Object.entries(attributes)) {
    if (!Array.isArray(value)) {
      continue;
    }
    delete fields[fieldName];
    for (let metaKey of Object.keys(fields)) {
      if (isDirectIndexedFieldKey(metaKey, fieldName)) {
        delete fields[metaKey];
      }
    }
  }
  if (Object.keys(fields).length === 0) {
    delete meta.fields;
  }
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
