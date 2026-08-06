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

/**
 * Semantic-record version check (RP-14.3). Every consumer of a
 * BoxelDescription, BoxelRenderRecord, or TemplateBundle calls this before
 * acting on the record; an unsupported version fails closed so the caller
 * can retain last-known-good output.
 */
export function assertBoxelExecutionProtocolVersion(version: number): void {
  if (version !== BOXEL_EXECUTION_PROTOCOL_VERSION) {
    throw new Error(
      `Unsupported Boxel execution protocol version ${version}; expected ${BOXEL_EXECUTION_PROTOCOL_VERSION}`,
    );
  }
}

/**
 * Feature negotiation (RP-14.3). A record's requiredFeatures must all be
 * supported by the consumer; an unknown required feature rejects the whole
 * record rather than silently rendering a partial semantic.
 */
export function assertSupportedFeatures(
  requiredFeatures: readonly string[],
  supportedFeatures: ReadonlySet<string>,
): void {
  let unsupported = requiredFeatures.filter(
    (feature) => !supportedFeatures.has(feature),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported Boxel execution protocol features: ${unsupported.join(', ')}`,
    );
  }
}

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue =
  | JSONPrimitive
  | JSONValue[]
  | { [key: string]: JSONValue };

/**
 * The reduced projection of a DOM event target that may cross an execution
 * boundary (RP-14.1). Only allowlisted scalar members and the string dataset
 * survive; the live Element never crosses.
 */
export interface SafeEventTarget {
  tagName: string;
  checked?: boolean;
  id?: string;
  name?: string;
  selectedIndex?: number;
  type?: string;
  value?: string | number | boolean;
  dataset?: Record<string, string>;
}

/**
 * The reduced projection of a browser event delivered to authored action
 * handlers in Capsule and Sandbox tiers (RP-14.1). Scalar members beyond the
 * required ones are present only when the source event carried a scalar
 * value for that allowlisted property.
 */
export interface SafeEvent {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  composed: boolean;
  defaultPrevented: boolean;
  target: SafeEventTarget | null;
  currentTarget: SafeEventTarget | null;
  altKey?: boolean;
  button?: number;
  buttons?: number;
  clientX?: number;
  clientY?: number;
  code?: string;
  ctrlKey?: boolean;
  data?: string | null;
  deltaMode?: number;
  deltaX?: number;
  deltaY?: number;
  inputType?: string;
  isPrimary?: boolean;
  key?: string;
  metaKey?: boolean;
  pageX?: number;
  pageY?: number;
  pointerId?: number;
  pointerType?: string;
  repeat?: boolean;
  screenX?: number;
  screenY?: number;
  shiftKey?: boolean;
}

/**
 * One entry in a captured template's scope (RP-14.1). `authored-component`
 * points at another captured template in the same bundle;
 * `trusted-export` names a Host-resolved trusted module export; and
 * `literal-value` carries a cloneable literal. An unknown kind rejects the
 * whole bundle (assertKnownRenderDependencies), never a partial render.
 *
 * The finer trusted-component / trusted-helper / safe-modifier split is a
 * planned refinement that requires capture-time classification in the
 * Capsule adapter; until it ships, `trusted-export` is the single trusted
 * kind and the Host validates each export against its vocabulary at
 * resolution time.
 */
export type RenderDependency =
  | { kind: 'authored-component'; component: string }
  | { kind: 'trusted-export'; module: string; name: string }
  | { kind: 'literal-value'; value: JSONValue };

export interface TemplateComponentInstanceDescriptor {
  handle: string;
  state: Record<string, JSONValue>;
  getters: string[];
  actions: string[];
}

export interface TemplateDescriptor {
  id: string;
  block: string;
  moduleName: string;
  isStrictMode: boolean;
  stylesheets: string[];
  scope: RenderDependency[];
  instance: TemplateComponentInstanceDescriptor;
}

/**
 * Validated Glimmer wire data plus explicit references (RP-14.1). It never
 * contains an executable authored closure; the Host reifies it into private
 * component definitions after validation.
 */
export interface TemplateBundle {
  protocolVersion: number;
  root: string;
  templates: Record<string, TemplateDescriptor>;
}

const knownRenderDependencyKinds: ReadonlySet<string> = new Set([
  'authored-component',
  'trusted-export',
  'literal-value',
]);

/**
 * Rejects a bundle whose version or dependency vocabulary this consumer
 * does not understand, before any of it is reified (RP-14.1, RP-14.3).
 */
export function assertKnownRenderDependencies(bundle: TemplateBundle): void {
  assertBoxelExecutionProtocolVersion(bundle.protocolVersion);
  for (let descriptor of Object.values(bundle.templates)) {
    for (let reference of descriptor.scope) {
      if (!knownRenderDependencyKinds.has(reference.kind)) {
        throw new Error(
          `Capsule template '${descriptor.id}' contains an unknown render dependency kind '${(reference as { kind: string }).kind}'`,
        );
      }
    }
  }
}

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
  /**
   * The `data-boxel-theme-scope` token main stamps on a themed card's
   * container (`themeScope()` in
   * `@cardstack/boxel-ui/helpers/theme-scoped-css.ts`: the theme card's id
   * plus a content fingerprint of its CSS, e.g. `<themeId>-<fingerprint>`).
   * Computed once, Host-side, from the live linked Theme card (RP-5.4) and
   * crossed as a plain cloneable string — never the live Theme card itself —
   * so a boundary tier can stamp the identical attribute its own trusted
   * `CardContainer` invocation needs to match the theme stylesheet already
   * installed in the shared document. `null` when the instance has no theme.
   */
  themeScope: string | null;
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
