import type { RealmInfo } from './realm';
import { type CodeRef, moduleFrom } from './code-ref';
import type {
  RealmResourceIdentifier,
  RealmIdentifier,
} from './card-reference-resolver';
import type { VirtualNetwork } from './virtual-network';
import type { Query } from './query';

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
// resource
export type Resource = ModuleResource | CardResource | PrerenderedCardResource;
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
};

export type FileMetaResourceResourceMeta = Meta & {
  realmInfo?: RealmInfo;
  realmURL?: RealmIdentifier;
  queryFieldDefs?: Record<string, QueryFieldMeta>;
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
// runtime chain rooted in this file (`card-reference-resolver.ts` →
// `loader.ts` → `realm.ts` → ...). Re-exported here for backward compat.
export {
  isCardResource,
  isFileMetaResource,
  isCardFields,
  isMeta,
  isRelationship,
} from './card-document-shape';

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
