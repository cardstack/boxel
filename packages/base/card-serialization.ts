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
import type { ResourceID, VirtualNetwork } from '@cardstack/runtime-common';

// --- Runtime Imports ---

import { isEqual, merge } from 'lodash';
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
  maybeURL,
  meta,
  primitive,
  relativeTo,
  rri,
} from '@cardstack/runtime-common';
import {
  getFieldOverrides,
  getFields,
  peekAtField,
  serializedGet,
} from './field-support';

// [SERIALIZE-DIAG] TEMPORARY (cs-meta-wedge-diag). The unprofiled
// render.meta wedge hangs inside `serializeCard` — META-DIAG proves the
// thread enters `serialize-start` and never reaches `serialize-done`, but
// absence-of-log can't say WHERE inside. These breadcrumbs log each
// top-level field right before its `serializedGet` (peekAtField →
// computeVia → field.serialize). The last `field-start` with no matching
// `field-done` names the hung field — a positive signal, not an inference
// from silence. Module-level depth counter so we only print the top of the
// serialize tree (nested cards stay quiet), gated to the prerender render
// context so the shared serializer stays silent in the host app and tests
// and the handful of logs can't drown the timing-sensitive wedge.
let __serializeDiagDepth = 0;

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
  // The VirtualNetwork to consult for prefix/RRI resolution during
  // serialization. Required — every caller must thread a VN.
  virtualNetwork: VirtualNetwork;
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
  let vn = opts.virtualNetwork;
  let data = serializeCardResource(model, doc, {
    ...opts,
    ...{
      maybeRelativeReference(possibleReference: string) {
        // Registered prefix refs (e.g. @cardstack/catalog/foo) are already
        // in their canonical portable form — return as-is.
        if (vn.isRegisteredPrefix(possibleReference)) {
          return possibleReference;
        }
        let modelRelativeToForURL: URL | undefined =
          typeof modelRelativeTo === 'string'
            ? vn.toURL(modelRelativeTo)
            : modelRelativeTo;
        let url = maybeURL(possibleReference, modelRelativeToForURL);
        if (!url) {
          throw new Error(
            `could not determine url from '${possibleReference}' relative to ${modelRelativeTo}`,
          );
        }
        if (!modelRelativeTo) {
          return url.href;
        }
        const realmURLString = getCardMeta(model, 'realmURL');
        const realmURL = realmURLString ? new URL(realmURLString) : undefined;
        return maybeRelativeReference(url, modelRelativeTo, realmURL);
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
  __serializeDiagDepth++;
  let d = __serializeDiagDepth;
  // Top of the serialize tree only, inside the prerender render context
  // (where the wedge lives). Depth 1 is the rendered card. A prior depth-2
  // build (per-field breadcrumbs INTO the customer card) ran clean — the
  // extra ~hundreds of synchronous logs in the linked-card subtree shifted
  // the timing enough to mask the race, the same way CPU profiling does. So
  // this build stays at depth 1 (same log volume as the build that DID
  // reproduce) and instead splits each RELATIONSHIP field's serializedGet
  // into peekAtField (loading the linked card) vs field.serialize
  // (recursing + computing the linked card's aggregates). The split is
  // observational — the real serialization still runs through the
  // unchanged serializedGet below; we only call peekAtField an extra,
  // idempotent time to bracket it. `field=customer` with a peek-start and
  // no peek-done ⇒ the hang is loading the Customer link; a serialize-start
  // with no serialize-done ⇒ it is recursing into Customer (the policies
  // query / aggregates). ~4 extra lines per link field, no masking.
  let diag =
    __serializeDiagDepth === 1 &&
    Boolean((globalThis as any).__boxelRenderContext);
  let diagId = diag ? ((model as any).id ?? '<unsaved>') : '';
  try {
    if (diag) {
      // eslint-disable-next-line no-console
      console.log(`[SERIALIZE-DIAG] resource-enter d=${d} id=${diagId}`);
    }
    let adoptsFrom = identifyCard(
      model.constructor,
      opts?.useAbsoluteURL ? undefined : opts?.maybeRelativeReference,
    );
    if (!adoptsFrom) {
      throw new Error(
        `bug: could not identify card: ${model.constructor.name}`,
      );
    }
    let { includeUnrenderedFields: _remove, ...fieldOpts } = opts ?? {};
    let { id: _removedIdField, ...fields } = getFields(model, {
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
    let entries = Object.entries(fields)
      .filter(
        ([_fieldName, field]) =>
          !(opts?.omitQueryFields && field.queryDefinition !== undefined),
      )
      .filter(([_fieldName, field]) =>
        opts?.omitFields ? !opts.omitFields.includes(field.card) : true,
      );
    if (diag) {
      // eslint-disable-next-line no-console
      console.log(
        `[SERIALIZE-DIAG] fields-resolved d=${d} id=${diagId} nFields=${entries.length} fields=${entries
          .map(([n]) => n)
          .join(',')}`,
      );
    }
    let fieldResources = entries.map(([fieldName, field]) => {
      let isRel =
        field.fieldType === 'linksTo' || field.fieldType === 'linksToMany';
      if (diag) {
        // eslint-disable-next-line no-console
        console.log(
          `[SERIALIZE-DIAG] field-start d=${d} id=${diagId} field=${fieldName} type=${field.fieldType}`,
        );
        if (isRel) {
          // Observational only — does not change serialization. peekAtField
          // is idempotent for a link (returns the loaded instance / sentinel),
          // so calling it here to bracket the load is safe; the real value is
          // re-read inside serializedGet below.
          // eslint-disable-next-line no-console
          console.log(
            `[SERIALIZE-DIAG] peek-start id=${diagId} field=${fieldName}`,
          );
          peekAtField(model, fieldName);
          // eslint-disable-next-line no-console
          console.log(
            `[SERIALIZE-DIAG] peek-done id=${diagId} field=${fieldName}`,
          );
          // eslint-disable-next-line no-console
          console.log(
            `[SERIALIZE-DIAG] serialize-start id=${diagId} field=${fieldName}`,
          );
        }
      }
      let resource = serializedGet(model, fieldName, doc, visited, opts);
      if (diag) {
        if (isRel) {
          // eslint-disable-next-line no-console
          console.log(
            `[SERIALIZE-DIAG] serialize-done id=${diagId} field=${fieldName}`,
          );
        }
        // eslint-disable-next-line no-console
        console.log(
          `[SERIALIZE-DIAG] field-done d=${d} id=${diagId} field=${fieldName}`,
        );
      }
      return resource;
    });
    let realmURL = getCardMeta(model, 'realmURL');
    if (diag) {
      // eslint-disable-next-line no-console
      console.log(`[SERIALIZE-DIAG] all-fields-done d=${d} id=${diagId}`);
    }
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
  } finally {
    __serializeDiagDepth--;
  }
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
  let vn = opts.virtualNetwork;
  let data = serializeCardResource(
    model,
    doc,
    {
      ...opts,
      ...{
        maybeRelativeReference(possibleReference: string) {
          // Registered prefix refs (e.g. @cardstack/catalog/foo) are
          // already in their canonical portable form — return as-is.
          if (vn.isRegisteredPrefix(possibleReference)) {
            return possibleReference;
          }
          let modelRelativeToForURL: URL | undefined =
            typeof modelRelativeTo === 'string'
              ? vn.toURL(modelRelativeTo)
              : modelRelativeTo;
          let url = maybeURL(possibleReference, modelRelativeToForURL);
          if (!url) {
            throw new Error(
              `could not determine url from '${possibleReference}' relative to ${modelRelativeTo}`,
            );
          }
          if (!modelRelativeTo) {
            return url.href;
          }
          const realmURLString = getCardMeta(model, 'realmURL');
          const realmURL = realmURLString ? new URL(realmURLString) : undefined;
          return maybeRelativeReference(url, modelRelativeTo, realmURL);
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
