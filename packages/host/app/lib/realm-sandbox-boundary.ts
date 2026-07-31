import type {
  CodeRef,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';

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

export function getOpaqueRealmCardState(
  value: object,
): OpaqueRealmCardState | undefined {
  return (value as Partial<OpaqueRealmCard>)[opaqueRealmCardState];
}
