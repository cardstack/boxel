import type {
  CodeRef,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { identifyCard } from '@cardstack/runtime-common';

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
  headerColor: string | null;
  prefersWideFormat: boolean;
}

export interface OpaqueRealmCardState {
  typeRef: CodeRef;
  principal: string;
  document: LooseSingleCardDocument;
  snapshot: Record<string, unknown>;
  presentation: OpaqueRealmCardPresentation;
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

export function serializeOpaqueRealmCard(
  value: BaseDef,
): LooseSingleCardDocument | undefined {
  let state = getOpaqueRealmCardState(value);
  if (!state) {
    return undefined;
  }
  let document = structuredClone(state.document);
  let attributes = document.data.attributes;
  if (attributes) {
    for (let name of Object.keys(attributes)) {
      if (!(name in value)) {
        continue;
      }
      let fieldValue = (value as unknown as Record<string, unknown>)[name];
      try {
        attributes[name] = structuredClone(fieldValue) as never;
      } catch {
        // Host capabilities and other non-cloneable values never cross the
        // opaque JSON boundary. Preserve the last serializable value instead.
      }
    }
  }
  // Preserve the identity from the boundary document. A newly constructed
  // CardDef can expose a temporary local UUID through `id`; serializing that
  // value as a remote resource id turns a create into a PATCH and conflicts
  // with the realm-assigned URL. Existing cards already carry their canonical
  // URL in state.document.data.id.
  return document;
}
