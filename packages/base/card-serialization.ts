// --- Type Imports ---

import type {
  Meta,
  LooseCardResource,
  Loader,
  CardDocument,
  CardResource,
  CardResourceMeta,
} from '@cardstack/runtime-common';
import type { BaseDef, BaseDefConstructor, CardDef } from './card-api';
import type { ResourceID } from '@cardstack/runtime-common';

// --- Runtime Imports ---

import { isEqual } from 'lodash';
import {
  assertIsSerializerName,
  fieldSerializer,
  getSerializer,
  humanReadable,
  identifyCard,
  isSingleCardDocument,
  loadCardDef,
  meta,
  primitive,
} from '@cardstack/runtime-common';

// --- Type Exports ---

export type JSONAPIResource =
  | {
      attributes: Record<string, any>;
      relationships?: Record<string, any>;
      meta?: Record<string, any>;
    }
  | {
      attributes?: Record<string, any>;
      relationships: Record<string, any>;
      meta?: Record<string, any>;
    };

export interface JSONAPISingleResourceDocument {
  data: Partial<JSONAPIResource> & { type: string } & { id?: string } & {
    lid?: string;
  };
  included?: (Partial<JSONAPIResource> & ResourceID)[];
}

export interface SerializeOpts {
  includeComputeds?: boolean;
  includeUnrenderedFields?: boolean;
  useAbsoluteURL?: boolean;
  omitFields?: [typeof BaseDef];
  maybeRelativeURL?: (possibleURL: string) => string;
  overrides?: Map<string, typeof BaseDef>;
}

export interface DeserializeOpts {
  ignoreBrokenLinks?: true;
}

// --- Serialization Symbols ---

export const serialize = Symbol.for('cardstack-serialize');
export const deserialize = Symbol.for('cardstack-deserialize');

// --- Serialization Functions ---

function myLoader(): Loader {
  // we know this code is always loaded by an instance of our Loader, which sets
  // import.meta.loader.

  // When type-checking realm-server, tsc sees this file and thinks
  // it will be transpiled to CommonJS and so it complains about this line. But
  // this file is always loaded through our loader and always has access to import.meta.
  // @ts-ignore
  return (import.meta as any).loader;
}

export async function cardClassFromResource<CardT extends BaseDefConstructor>(
  resource: LooseCardResource | undefined,
  fallback: CardT,
  relativeTo: URL | undefined,
): Promise<CardT> {
  let cardIdentity = identifyCard(fallback);
  if (!cardIdentity) {
    throw new Error(
      `bug: could not determine identity for card '${fallback.name}'`,
    );
  }
  if (resource && !isEqual(resource.meta.adoptsFrom, cardIdentity)) {
    let card: typeof BaseDef | undefined = await loadCardDef(
      resource.meta.adoptsFrom,
      {
        loader: myLoader(),
        relativeTo: resource.id ? new URL(resource.id) : relativeTo,
      },
    );
    if (!card) {
      throw new Error(
        `could not find card: '${humanReadable(resource.meta.adoptsFrom)}'`,
      );
    }
    return card as CardT;
  }
  return fallback;
}

export function callSerializeHook(
  card: typeof BaseDef,
  value: any,
  doc: JSONAPISingleResourceDocument,
  visited: Set<string> = new Set(),
  opts?: any,
): any {
  if (value != null) {
    if (primitive in card && fieldSerializer in card) {
      assertIsSerializerName(card[fieldSerializer]);
      let serializer = getSerializer(card[fieldSerializer]);
      return serializer.serialize(value, doc, visited, opts);
    } else {
      return card[serialize](value, doc, visited, opts);
    }
  } else {
    return null;
  }
}

export function getCardMeta<K extends keyof CardResourceMeta>(
  card: CardDef,
  metaKey: K,
): CardResourceMeta[K] | undefined {
  return card[meta]?.[metaKey] as CardResourceMeta[K] | undefined;
}

export function makeMetaForField(
  meta: Partial<Meta> | undefined,
  fieldName: string,
  fallback: typeof BaseDef,
): Meta {
  let adoptsFrom = meta?.adoptsFrom ?? identifyCard(fallback);
  if (!adoptsFrom) {
    throw new Error(`bug: cannot determine identity for field '${fieldName}'`);
  }
  let fields: NonNullable<LooseCardResource['meta']['fields']> = {
    ...(meta?.fields ?? {}),
  };
  return {
    adoptsFrom,
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
  };
}

export function makeRelativeURL(
  maybeURL: string,
  opts?: SerializeOpts,
): string {
  return opts?.maybeRelativeURL && !opts?.useAbsoluteURL
    ? opts.maybeRelativeURL(maybeURL)
    : maybeURL;
}

export function resourceFrom(
  doc: CardDocument | undefined,
  resourceId: string | undefined,
): LooseCardResource | undefined {
  if (doc == null) {
    return;
  }
  let data: CardResource[];
  if (isSingleCardDocument(doc)) {
    if (resourceId === undefined) {
      return undefined;
    }
    if (resourceId === null) {
      return doc.data;
    }
    data = [doc.data];
  } else {
    data = doc.data;
  }
  let res = [...data, ...(doc.included ?? [])].find(
    (resource) => resource.id === resourceId,
  );
  return res;
}
