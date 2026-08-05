import type { CodeRef } from './code-ref.ts';

export const BOXEL_EXECUTION_PROTOCOL_VERSION = 1;
export const BOXEL_EXECUTION_TRANSPORT_VERSION = 1;
export const BOXEL_SURFACE_PROTOCOL_VERSION = 1;

declare const runtimeHandleBrand: unique symbol;
declare const boxelTypeHandleBrand: unique symbol;
declare const boxelInstanceHandleBrand: unique symbol;

export type RuntimeHandle = string & {
  readonly [runtimeHandleBrand]: true;
};

declare const surfaceHandleBrand: unique symbol;
export type SurfaceHandle = string & {
  readonly [surfaceHandleBrand]: true;
};

export type SurfaceHeightMode = 'intrinsic' | 'allocated';

export interface SurfacePresentation {
  headerColor?: string | null;
  containerBackground?: string | null;
}

export interface SurfaceLayout {
  heightMode: SurfaceHeightMode;
  minimumHeight?: number;
}

export interface SurfaceObservation {
  width: number;
  height: number;
  visible: boolean;
}

export type SurfaceCapabilityRequest =
  | {
      kind: 'boxel-surface-request';
      protocolVersion: number;
      requestId: string;
      operation: 'present';
      surface: SurfaceHandle;
      presentation: SurfacePresentation;
    }
  | {
      kind: 'boxel-surface-request';
      protocolVersion: number;
      requestId: string;
      operation: 'layout';
      surface: SurfaceHandle;
      layout: SurfaceLayout;
    };

export interface SurfaceCapabilityResponse {
  kind: 'boxel-surface-response';
  protocolVersion: number;
  requestId: string;
  ok: boolean;
  error?: string;
}

export interface SurfaceObservationNotification {
  kind: 'boxel-surface-observation';
  protocolVersion: number;
  surface: SurfaceHandle;
  observation: SurfaceObservation;
}
export type BoxelTypeHandle = RuntimeHandle & {
  readonly [boxelTypeHandleBrand]: true;
};
export type BoxelInstanceHandle = RuntimeHandle & {
  readonly [boxelInstanceHandleBrand]: true;
};

export type BoxelRuntimeOperation =
  | 'loadBoxel'
  | 'createFromSerialized'
  | 'describeBoxel'
  | 'getFields'
  | 'getField'
  | 'buildRenderRecord'
  | 'serializeCard'
  | 'serializeCardPatch'
  | 'dispose';

export interface BoxelRuntimeRequest {
  kind: 'boxel-runtime-request';
  transportVersion: number;
  requestId: string;
  operation: BoxelRuntimeOperation;
  args: JSONValue[];
}

export interface BoxelRuntimeSuccess {
  kind: 'boxel-runtime-response';
  transportVersion: number;
  requestId: string;
  ok: true;
  value: JSONValue;
}

export interface BoxelRuntimeFailure {
  kind: 'boxel-runtime-response';
  transportVersion: number;
  requestId: string;
  ok: false;
  error: {
    name: string;
    message: string;
    code?: string;
    stack?: string;
  };
}

export type BoxelRuntimeResponse = BoxelRuntimeSuccess | BoxelRuntimeFailure;

/**
 * Rendering is a process-local effect, not part of the cloneable semantic
 * BoxelRuntime API. The Host may select an opaque child-owned instance and a
 * format, but the component definition and DOM remain in the Sandbox.
 */
export type SandboxRenderRequest =
  | {
      kind: 'boxel-sandbox-render-request';
      transportVersion: number;
      requestId: string;
      operation: 'render';
      card: BoxelInstanceHandle;
      format: string;
    }
  | {
      kind: 'boxel-sandbox-render-request';
      transportVersion: number;
      requestId: string;
      operation: 'clear';
    };

export type SandboxRenderResponse =
  | {
      kind: 'boxel-sandbox-render-response';
      transportVersion: number;
      requestId: string;
      ok: true;
    }
  | {
      kind: 'boxel-sandbox-render-response';
      transportVersion: number;
      requestId: string;
      ok: false;
      error: {
        name: string;
        message: string;
      };
    };

export function assertBoxelExecutionTransportVersion(version: number): void {
  if (version !== BOXEL_EXECUTION_TRANSPORT_VERSION) {
    throw new Error(
      `Unsupported Boxel execution transport version ${version}; expected ${BOXEL_EXECUTION_TRANSPORT_VERSION}`,
    );
  }
}

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue =
  | JSONPrimitive
  | JSONValue[]
  | { [key: string]: JSONValue };

export type BoxelKind = 'card' | 'field' | 'file';

/**
 * Cloneable metadata for one field declared by a Boxel type.
 *
 * This deliberately contains no Field object, CardDef class, serializer,
 * getter, or component definition. Those remain owned by the runtime that
 * loaded the type.
 */
export interface FieldDescription {
  fieldName: string;
  fieldType: CodeRef;
  kind: 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';
  isComputed: boolean;
}

/**
 * A format is an open string so new authored formats do not require a
 * protocol release. The provider identifies which executable owner supplies
 * the format without transferring its component definition.
 */
export interface FormatDescription {
  format: string;
  provider: {
    kind: 'authored' | 'trusted-base';
    ref: CodeRef;
  };
}

export interface TypePresentation {
  displayName: string;
  headerColor: string | null;
  prefersWideFormat: boolean;
}

export interface BoxelDescription {
  protocolVersion: number;
  requiredFeatures: string[];
  ref: CodeRef;
  boxelKind: BoxelKind;
  ancestors: CodeRef[];
  fields: FieldDescription[];
  formats: FormatDescription[];
  presentation: TypePresentation;
  executionHints: {
    prefersFullSandbox: boolean;
  };
}

/**
 * A reference-shaped projection of a nested Boxel value. The referenced
 * value is resolved through the canonical Store; no live instance crosses
 * the runtime boundary.
 */
export interface BoxelValueReference {
  $boxel: {
    id: string | null;
    type: CodeRef;
  };
}

export interface ResolvedField {
  fieldName: string;
  fieldType: CodeRef;
  kind: FieldDescription['kind'];
  value: JSONValue | BoxelValueReference | BoxelValueReference[];
  resolvedConfiguration: JSONValue | null;
  presentation: Record<string, JSONValue>;
  writable: boolean;
}

export interface InstancePresentation {
  title: string | null;
  summary: string | null;
  thumbnailURL: string | null;
  theme: BoxelValueReference | null;
}

/**
 * The cloneable semantic input shared by rendering tiers.
 *
 * Direct rendering has an additional Host-local render slot. That slot is
 * intentionally not represented here because Glimmer component definitions
 * are executable objects and must remain with their execution owner.
 */
export interface BoxelRenderRecord {
  protocolVersion: number;
  boxel: BoxelDescription;
  instance: {
    id: string | null;
    /**
     * Cloneable public model consumed by authored renderers. This includes
     * declared field values plus JSON-safe getters evaluated by the runtime
     * that owns the executable definition.
     */
    model: Record<string, JSONValue>;
    fields: ResolvedField[];
  };
  presentation: InstancePresentation;
}
