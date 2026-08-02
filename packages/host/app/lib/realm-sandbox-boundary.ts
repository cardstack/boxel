import type {
  CodeRef,
  LooseCardResource,
  LooseFileMetaResource,
  LooseSingleCardDocument,
  Relationship,
} from '@cardstack/runtime-common';
import {
  identifyCard,
  moduleFrom,
  resolveRRIReference,
  rri,
} from '@cardstack/runtime-common';

import { isTrustedHostRealmModule } from './realm-sandbox-import-policy';

import type { BaseDef } from '@cardstack/base/card-api';

export interface OpaqueRealmCardTheme {
  css: string;
  id: string;
  scope: string;
}

export interface OpaqueRealmCardPresentation {
  displayName?: string;
  headerColor: string | null;
  prefersWideFormat: boolean;
  theme?: OpaqueRealmCardTheme;
}

export const opaqueRealmCardState = Symbol.for(
  'boxel.realm-sandbox.opaque-card-state',
);

export const opaqueRealmCardTypeState = Symbol.for(
  'boxel.realm-sandbox.opaque-card-type-state',
);

export interface OpaqueRealmCardFieldType {
  module: string;
  name: string;
}

export interface OpaqueRealmCardFieldMetadata {
  kind: 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';
  type: OpaqueRealmCardFieldType;
}

export interface OpaqueRealmCardTypeState {
  typeRef: CodeRef;
  displayName: string;
  fields: Record<string, OpaqueRealmCardFieldMetadata>;
  hasCustomEditTemplate: boolean;
  hasCustomIsolatedTemplate: boolean;
  authoredTemplateFormats?: string[];
  headerColor: string | null;
  prefersWideFormat: boolean;
}

export interface OpaqueRealmCardState {
  typeRef: CodeRef;
  principal: string;
  document: LooseSingleCardDocument;
  snapshot: Record<string, unknown>;
  presentation: OpaqueRealmCardPresentation;
  setField?: (fieldName: string, value: unknown) => void;
  resolveTrustedRelationship?: (
    id: string,
    fieldType: typeof BaseDef,
  ) => BaseDef | undefined;
}

export interface OpaqueRealmCard {
  [opaqueRealmCardState]: OpaqueRealmCardState;
}

export interface OpaqueRealmCardType {
  [opaqueRealmCardTypeState]: OpaqueRealmCardTypeState;
}

export function getOpaqueRealmCardState(
  value: object,
): OpaqueRealmCardState | undefined {
  return (value as Partial<OpaqueRealmCard>)[opaqueRealmCardState];
}

export function getOpaqueRealmCardTypeState(
  value: object,
): OpaqueRealmCardTypeState | undefined {
  let direct = (value as Partial<OpaqueRealmCardType>)[
    opaqueRealmCardTypeState
  ];
  if (direct) {
    return direct;
  }
  let constructor = (value as { constructor?: object }).constructor;
  return constructor
    ? (constructor as Partial<OpaqueRealmCardType>)[opaqueRealmCardTypeState]
    : undefined;
}

// Host UI and tools historically identified a card through its executable
// constructor. Opaque cards intentionally replace that constructor, so the
// host must use the inert type reference carried across the sandbox boundary.
export function identifyRealmCard(
  value: object | undefined,
): CodeRef | undefined {
  let opaqueRef = value
    ? getOpaqueRealmCardTypeState(value)?.typeRef
    : undefined;
  if (opaqueRef) {
    return opaqueRef;
  }
  let definition =
    typeof value === 'function'
      ? value
      : (value as { constructor?: object } | undefined)?.constructor;
  return identifyCard(definition as typeof BaseDef | undefined);
}

export function isTrustedRealmCardDefinition(
  value: object | undefined,
): boolean {
  let ref = identifyRealmCard(value);
  return Boolean(ref && isTrustedHostRealmModule(moduleFrom(ref)));
}

export function serializeOpaqueRealmCard(
  value: BaseDef,
  opts?: { useAbsoluteURL?: boolean },
): LooseSingleCardDocument | undefined {
  let state = getOpaqueRealmCardState(value);
  if (!state) {
    return undefined;
  }
  let document = structuredClone(state.document);
  let attributes = document.data.attributes;
  if (attributes) {
    let relationshipPaths = Object.keys(document.data.relationships ?? {});
    for (let name of Object.keys(attributes)) {
      if (!(name in value)) {
        continue;
      }
      let fieldValue = (value as unknown as Record<string, unknown>)[name];
      let snapshotValue = state.snapshot[name];
      // Object-valued fields are exposed to trusted Host widgets through a
      // reactive Proxy. The proxy mutates this raw snapshot in place, but a
      // Proxy itself cannot cross structuredClone. Serialize the synchronized
      // raw value while keeping primitive/replacement edits on the public
      // field fail-closed below.
      let serializableValue =
        fieldValue !== null &&
        typeof fieldValue === 'object' &&
        snapshotValue !== null &&
        typeof snapshotValue === 'object'
          ? snapshotValue
          : fieldValue;
      try {
        // A contains field can itself contain links (CardInfoField.theme is
        // the common case). The live host projection holds the linked CardDef
        // so trusted edit widgets can render it, but relationships belong in
        // JSON:API `relationships`, never inside the cloned attribute value.
        // Remove those paths before crossing the opaque JSON boundary.
        attributes[name] = structuredClone(
          omitOpaqueRelationshipPaths(
            serializableValue,
            relationshipPaths
              .filter((path) => path.startsWith(`${name}.`))
              .map((path) => path.slice(name.length + 1).split('.')),
          ),
        ) as never;
      } catch (error) {
        let detail = error instanceof Error ? `: ${error.message}` : '';
        throw new Error(
          `Cannot serialize sandboxed card field "${name}" across the opaque JSON boundary${detail}`,
        );
      }
    }
  }
  // Preserve the identity from the boundary document. A newly constructed
  // CardDef can expose a temporary local UUID through `id`; serializing that
  // value as a remote resource id turns a create into a PATCH and conflicts
  // with the realm-assigned URL. Existing cards already carry their canonical
  // URL in state.document.data.id.
  if (opts?.useAbsoluteURL) {
    absolutizeOpaqueDocumentReferences(document);
  }
  return document;
}

function omitOpaqueRelationshipPaths(
  value: unknown,
  paths: string[][],
): unknown {
  if (paths.length === 0 || value == null || typeof value !== 'object') {
    return value;
  }
  let result: Record<string, unknown> | unknown[] = Array.isArray(value)
    ? [...value]
    : { ...(value as Record<string, unknown>) };
  for (let [head, ...tail] of paths) {
    if (!head) {
      continue;
    }
    if (tail.length === 0) {
      delete (result as Record<string, unknown>)[head];
      continue;
    }
    let child = (result as Record<string, unknown>)[head];
    (result as Record<string, unknown>)[head] = omitOpaqueRelationshipPaths(
      child,
      [tail],
    );
  }
  return result;
}

function absolutizeOpaqueDocumentReferences(
  document: LooseSingleCardDocument,
): void {
  let rootBase = document.data.id;
  for (let resource of [document.data, ...(document.included ?? [])]) {
    let resourceBase = resource.id ?? rootBase;
    resource.meta.adoptsFrom = absolutizeCodeRef(
      resource.meta.adoptsFrom,
      resourceBase,
    );
    absolutizeRelationships(resource, resourceBase);
  }
}

function absolutizeCodeRef(ref: CodeRef, base: string | undefined): CodeRef {
  if ('type' in ref) {
    return {
      ...ref,
      card: absolutizeCodeRef(ref.card, base),
    };
  }
  return {
    ...ref,
    module: rri(
      ref.module.startsWith('@')
        ? ref.module
        : absoluteReference(ref.module, base),
    ),
  };
}

function absolutizeRelationships(
  resource: LooseCardResource | LooseFileMetaResource,
  base: string | undefined,
): void {
  for (let value of Object.values(resource.relationships ?? {})) {
    let relationships = Array.isArray(value) ? value : [value];
    for (let relationship of relationships as Relationship[]) {
      let self = relationship.links?.self;
      if (typeof self === 'string') {
        relationship.links!.self = absoluteReference(self, base);
      }
    }
  }
}

function absoluteReference(reference: string, base: string | undefined) {
  if (reference.startsWith('@') || /^[a-z][a-z0-9+.-]*:/i.test(reference)) {
    return reference;
  }
  if (!base) {
    throw new Error(
      'Cannot serialize sandboxed card with absolute references without a source URL',
    );
  }
  return resolveRRIReference(reference, rri(base));
}
