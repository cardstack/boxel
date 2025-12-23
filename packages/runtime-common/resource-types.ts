import type { RealmInfo } from './realm';
import { type CodeRef, isCodeRef, moduleFrom } from './code-ref';

// resource
export type Resource = ModuleResource | CardResource | PrerenderedCardResource;
export type ResourceMeta = ModuleMeta | Meta;

//modules
export type ModuleMeta = {};

export interface ModuleResource {
  id?: string;
  type: 'source';
  attributes?: { content: string };
  meta: ModuleMeta;
}

//cards
export type Saved = string;
export type Unsaved = string | undefined;
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
  realmURL?: string;
};

export interface CardResource<Identity extends Unsaved = Saved> {
  id?: Identity;
  lid?: string;
  type: 'card';
  attributes?: Record<string, any>;
  relationships?: {
    [fieldName: string]: Relationship | Relationship[];
  };
  meta: CardResourceMeta;
  links?: {
    self?: string;
  };
}

export type LooseCardResource = Omit<CardResource, 'id' | 'type'> & {
  type?: 'card';
  id?: string;
};

//prerendered cards
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

//validation - cards
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
