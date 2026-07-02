// --- Type Imports ---

import type {
  CardDocument,
  CardResource,
  CardResourceMeta,
  FileMetaResource,
  Loader,
  LooseCardResource,
  LooseFileMetaResource,
  LooseSingleCardDocument,
  LooseSingleFileMetaDocument,
  Meta,
  RealmResourceIdentifier,
  RuntimeDependencyTrackingContext,
  SingleFileMetaDocument,
} from '@cardstack/runtime-common';
import type { BaseDef, BaseDefConstructor, CardDef } from './card-api';
import type { FileDef } from './file-api';
import type { ResourceID } from '@cardstack/runtime-common';

// --- Runtime Imports ---

import { isEqual, merge } from 'lodash-es';
import {
  assertIsSerializerName,
  CardResourceType,
  fieldSerializer,
  FileMetaResourceType,
  getSerializer,
  humanReadable,
  identifyCard,
  isSingleCardDocument,
  isSingleFileMetaDocument,
  loadCardDef,
  localId,
  maybeRelativeReference,
  meta,
  primitive,
  relativeTo,
  resolveRRIReference,
  rri,
} from '@cardstack/runtime-common';
import { getFieldOverrides, getFields, serializedGet } from './field-support';

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
  omitQueryFields?: boolean;
  maybeRelativeReference?: (possibleReference: string) => string;
  overrides?: Map<string, typeof BaseDef>;
}

export interface DeserializeOpts {
  ignoreBrokenLinks?: true;
  dependencyTrackingContext?: RuntimeDependencyTrackingContext;
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
  resource: LooseCardResource | CardResource | FileMetaResource | undefined,
  fallback: CardT,
  relativeTo: RealmResourceIdentifier | URL | undefined,
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
        relativeTo: relativeTo ?? (resource.id ? rri(resource.id) : undefined),
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
  card: BaseDef,
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
  return opts?.maybeRelativeReference && !opts?.useAbsoluteURL
    ? opts.maybeRelativeReference(maybeURL)
    : maybeURL;
}

export function resourceFrom(
  doc: CardDocument | SingleFileMetaDocument | undefined,
  resourceId: string | undefined,
): CardResource | FileMetaResource | undefined {
  if (doc == null) {
    return;
  }
  let data: (CardResource | FileMetaResource)[];
  if (isSingleCardDocument(doc) || isSingleFileMetaDocument(doc)) {
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

export function serializeCard(
  model: CardDef,
  opts: SerializeOpts,
): LooseSingleCardDocument {
  let doc = {
    data: {
      type: 'card',
      ...(model.id != null ? { id: model.id } : { lid: model[localId] }),
    },
  };
  let modelRelativeTo: RealmResourceIdentifier | URL | undefined =
    model.id ?? model[relativeTo];
  let data = serializeCardResource(model, doc, {
    ...opts,
    ...{
      maybeRelativeReference(possibleReference: string) {
        // Prefix-form RRIs (e.g. @cardstack/catalog/foo) are already in their
        // canonical portable form — return as-is.
        if (possibleReference.startsWith('@')) {
          return possibleReference;
        }
        // Identifiers are canonical RRI, so resolve relative refs to their
        // absolute form with plain path math (no VirtualNetwork), then
        // relativize against the model's own id.
        let absolute = resolveRRIReference(possibleReference, modelRelativeTo);
        if (!modelRelativeTo) {
          return absolute;
        }
        const realmURLString = getCardMeta(model, 'realmURL');
        const realmURL = realmURLString ? new URL(realmURLString) : undefined;
        return maybeRelativeReference(rri(absolute), modelRelativeTo, realmURL);
      },
    },
  });
  merge(doc, { data });
  if (!isSingleCardDocument(doc)) {
    throw new Error(
      `Expected serialized card to be a SingleCardDocument, but is was: ${JSON.stringify(
        doc,
        null,
        2,
      )}`,
    );
  }
  return doc;
}

export function serializeCardResource(
  model: CardDef | FileDef,
  doc: JSONAPISingleResourceDocument,
  opts?: SerializeOpts,
  visited: Set<string> = new Set(),
  resourceType: string = CardResourceType,
): LooseCardResource | LooseFileMetaResource {
  let adoptsFrom = identifyCard(
    model.constructor,
    opts?.useAbsoluteURL ? undefined : opts?.maybeRelativeReference,
  );
  if (!adoptsFrom) {
    throw new Error(`bug: could not identify card: ${model.constructor.name}`);
  }
  let { includeUnrenderedFields: remove, ...fieldOpts } = opts ?? {};
  let { id: removedIdField, ...fields } = getFields(model, {
    ...fieldOpts,
    usedLinksToFieldsOnly: !opts?.includeUnrenderedFields,
  });
  let overrides = getFieldOverrides(model);
  // `serializeCardResource` is reachable from the recursive field-serialize
  // symbol path without opts (e.g. callSerializeHook with no opts arg).
  // That path doesn't read `opts.virtualNetwork`, so the synthesized
  // working opts can lack it; cast through SerializeOpts | undefined to
  // satisfy the required-VN type while preserving runtime behavior.
  opts = { ...(opts ?? {}), overrides } as SerializeOpts | undefined;
  let fieldResources = Object.entries(fields)
    .filter(
      ([_fieldName, field]) =>
        !(opts?.omitQueryFields && field.queryDefinition !== undefined),
    )
    .filter(([_fieldName, field]) =>
      opts?.omitFields ? !opts.omitFields.includes(field.card) : true,
    )
    .map(([fieldName]) => serializedGet(model, fieldName, doc, visited, opts));
  let realmURL = getCardMeta(model, 'realmURL');
  return merge(
    {
      attributes: {},
    },
    ...fieldResources,
    {
      type: resourceType,
      meta: { adoptsFrom, ...(realmURL ? { realmURL } : {}) },
    },
    // Only CardDef instances can be unsaved (without an id), so when model.id
    // is falsy we know the model is a CardDef which has [localId].
    model.id ? { id: model.id } : { lid: (model as CardDef)[localId] },
  );
}

export function serializeFileDef(
  model: FileDef,
  opts: SerializeOpts,
): LooseSingleFileMetaDocument {
  let doc = {
    data: {
      type: FileMetaResourceType,
      ...(model.id != null ? { id: model.id } : {}),
    },
  };
  let modelRelativeTo: RealmResourceIdentifier | URL | undefined =
    model.id ?? model[relativeTo];
  let data = serializeCardResource(
    model,
    doc,
    {
      ...opts,
      ...{
        maybeRelativeReference(possibleReference: string) {
          // Prefix-form RRIs (e.g. @cardstack/catalog/foo) are already in
          // their canonical portable form — return as-is.
          if (possibleReference.startsWith('@')) {
            return possibleReference;
          }
          // Identifiers are canonical RRI, so resolve relative refs to their
          // absolute form with plain path math (no VirtualNetwork), then
          // relativize against the model's own id.
          let absolute = resolveRRIReference(
            possibleReference,
            modelRelativeTo,
          );
          if (!modelRelativeTo) {
            return absolute;
          }
          const realmURLString = getCardMeta(model, 'realmURL');
          const realmURL = realmURLString ? new URL(realmURLString) : undefined;
          return maybeRelativeReference(
            rri(absolute),
            modelRelativeTo,
            realmURL,
          );
        },
      },
    },
    undefined,
    FileMetaResourceType,
  );
  merge(doc, { data });
  if (!isSingleFileMetaDocument(doc)) {
    throw new Error(
      `Expected serialized file def to be a SingleFileMetaDocument, but it was: ${JSON.stringify(
        doc,
        null,
        2,
      )}`,
    );
  }
  return doc as LooseSingleFileMetaDocument;
}
