// --- Type Imports ---

import type {
  CardDocument,
  CardResource,
  CardResourceMeta,
  FileMetaResource,
  LooseCardResource,
  LooseFileMetaResource,
  LooseSingleCardDocument,
  LooseSingleFileMetaDocument,
  Meta,
  RealmResourceIdentifier,
  RuntimeDependencyTrackingContext,
  SingleFileMetaDocument,
} from '@cardstack/runtime-common';
import { loaderForModule, type Loader } from '@cardstack/runtime-common';
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
  // Include link fields the card does not actually have. By default
  // serialization keeps only the relationships present in the card's data — a
  // set target or an authored empty `{ self: null }` — plus contained fields
  // (always present); set this to serialize every declared relationship,
  // including never-authored ones (as `{ self: null }`).
  includeUnrenderedFields?: boolean;
  useAbsoluteURL?: boolean;
  omitFields?: [typeof BaseDef];
  omitQueryFields?: boolean;
  // How much of the linked graph rides along in `included[]`. 'all' — the
  // default, and what a direct `serializeCard` call gets — serializes every
  // resident link target. 'local' serializes only the local (unsaved,
  // `lid`-bearing) targets reachable without crossing an excluded one: the
  // write shape, where `included` is a co-creation manifest and saved targets
  // are reference-only. 'none' serializes no link targets at all.
  //
  // An excluded target contributes its relationship entry only, and its own
  // linked graph is not traversed — which is the point: a new card linking
  // into a large saved graph serializes none of that graph on save. Under
  // 'local' that also bounds what a write co-creates to the local targets it
  // reaches directly. An unsaved card hanging off a saved link is not
  // co-created, because nothing the write persists could reference it: the
  // saved link's own file is not rewritten, and the write's response names
  // only the primary card, so its id would never reach the client.
  includedScope?: 'all' | 'local' | 'none';
  maybeRelativeReference?: (possibleReference: string) => string;
  overrides?: Map<string, typeof BaseDef>;
}

export interface DeserializeOpts {
  ignoreBrokenLinks?: true;
  dependencyTrackingContext?: RuntimeDependencyTrackingContext;
  // Opt-in per-field hydration timing. When a caller supplies the collector,
  // `_updateFromSerialized` accumulates each field's inclusive
  // deserialization wall-clock into it, keyed by dotted path, and threads
  // `hydrateFieldPath` down the recursion so a nested field's key names its
  // whole path from the root. Absent for every other caller, which then pays
  // one property read per field and allocates nothing — the interactive app
  // deserializes on its hot path too.
  hydrateFieldsMs?: Record<string, number>;
  // The path of the field whose value is currently being deserialized, i.e.
  // the prefix the next level down qualifies its own field names with. Set
  // only alongside `hydrateFieldsMs`; the root call leaves it unset.
  hydrateFieldPath?: string;
}

// --- Serialization Symbols ---

export const serialize = Symbol.for('cardstack-serialize');
export const deserialize = Symbol.for('cardstack-deserialize');

// --- Serialization Functions ---

function myLoader(): Loader {
  // tsc checks this file as CommonJS output when it checks realm-server, and
  // so rejects the `import.meta` read; the read is all that is suppressed.
  // @ts-ignore
  return loaderForModule(import.meta);
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
        // Every reference in a resource — its `adoptsFrom.module` and its
        // relationship links alike — is transmitted relative to the resource's
        // OWN id, independent of the document that delivered it. So a resource
        // with an id resolves its module against that id, even when it arrived
        // embedded in another document's `included[]`. The caller's `relativeTo`
        // is the base only for an id-less resource (a contained field), which
        // shares its parent's base.
        relativeTo: resource.id ? rri(resource.id) : relativeTo,
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

// Build the reference-relativizer for `model`. Every reference a resource
// carries — its `adoptsFrom.module` and its relationship links — is
// transmitted relative to that resource's OWN id, so each resource in a
// document needs its own relativizer. `rebaseReferencesFor` re-binds this at
// the boundary where a link target becomes an `included[]` resource.
export function relativeReferenceFor(
  model: CardDef | FileDef,
): (possibleReference: string) => string {
  let modelRelativeTo: RealmResourceIdentifier | URL | undefined =
    model.id ?? model[relativeTo];
  return (possibleReference: string) => {
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
  };
}

// Re-base `opts`'s relativizer onto `value`, for serializing a link target as
// its own `included[]` resource. A target without an id has no base of its
// own and keeps the parent's, matching the index engine's `relativizeResource`
// (`resource.id ? toURL(resource.id) : primaryURL`).
export function rebaseReferencesFor(
  value: CardDef | FileDef,
  opts?: SerializeOpts,
): SerializeOpts | undefined {
  if (!opts?.maybeRelativeReference || opts.useAbsoluteURL || !value.id) {
    return opts;
  }
  return { ...opts, maybeRelativeReference: relativeReferenceFor(value) };
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
  let data = serializeCardResource(model, doc, {
    ...opts,
    maybeRelativeReference: relativeReferenceFor(model),
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
  let { includeUnrenderedFields: _includeUnrenderedFields, ...fieldOpts } =
    opts ?? {};
  let { id: _id, ...fields } = getFields(model, {
    ...fieldOpts,
    usedLinksToFieldsOnly: !opts?.includeUnrenderedFields,
  });
  let overrides = getFieldOverrides(model);
  // `serializeCardResource` is reachable without opts — both directly and
  // through the `serialize` symbol, whose `opts` parameter is optional.
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
  let data = serializeCardResource(
    model,
    doc,
    {
      ...opts,
      maybeRelativeReference: relativeReferenceFor(model),
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
