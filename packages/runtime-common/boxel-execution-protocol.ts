import type { CodeRef } from './code-ref.ts';
import type { LooseSingleCardDocument } from './index.ts';

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

/**
 * The single authority for which height mode a render format gets. Fitted
 * cards live in tiles whose size the tile owner allocates; every other
 * format flows at its content's intrinsic height (the child reports it, the
 * Host applies it, and the surrounding stack scrolls — the same reading
 * experience as an in-document card). Both sides of the Sandbox boundary
 * derive from this one function so the parent's Surface layout and the
 * child's decision to measure never disagree.
 */
export function surfaceHeightModeFor(format: string): SurfaceHeightMode {
  return format === 'fitted' ? 'allocated' : 'intrinsic';
}

/**
 * Main's child-format cascade, verbatim (`defaultFieldFormats` in
 * `@cardstack/base/field-component.gts`, RP-2.6): the formats `<@fields.x />`
 * resolves to inside a template rendering as `containingFormat` when the
 * author names none. This is the ONE definition for every execution tier
 * that reproduces the cascade outside Base's own field components (the Host
 * renderer's Capsule slot, the Capsule facade's `DefaultFormatsContextName`
 * answer) — a drifted copy renders nested cards in the wrong format on that
 * tier only, which is exactly the class of divergence RP conformance exists
 * to prevent.
 */
export function childFieldFormatsFor(containingFormat: string): {
  cardDef: string;
  fieldDef: string;
} {
  switch (containingFormat) {
    case 'edit':
      return { cardDef: 'edit', fieldDef: 'edit' };
    case 'atom':
    case 'head':
    case 'markdown':
      return { cardDef: containingFormat, fieldDef: containingFormat };
    default:
      // isolated | fitted | embedded (and any unknown format degrades the
      // same way main degrades it)
      return { cardDef: 'fitted', fieldDef: 'embedded' };
  }
}

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
 *
 * `generation` (RP-17.1's HMR un-deferral for the Sandbox tier) is a
 * monotonic sequence number the Host bumps for every render-family request
 * it issues on one process (render, clear, and `draft` alike) — never reused
 * across processes or reset except by an explicit hard reload. The child
 * echoes it back on the matching response and uses it to drop a request
 * that arrives (or is still in flight) after a newer one has already
 * superseded it, so a burst of rapid edits or format switches never
 * resurrects stale output. `draft` carries only the edited module's exact
 * URL, not its source — the source crosses separately, through the
 * existing module-fetch channel's per-URL draft override (see
 * `SandboxRuntimeProcess`'s draft override map), keeping this control
 * message small and reusing the one channel that already carries module
 * bytes rather than duplicating that payload here.
 */
export type SandboxRenderRequest =
  | {
      kind: 'boxel-sandbox-render-request';
      transportVersion: number;
      requestId: string;
      generation: number;
      operation: 'render';
      card: BoxelInstanceHandle;
      format: string;
    }
  | {
      kind: 'boxel-sandbox-render-request';
      transportVersion: number;
      requestId: string;
      generation: number;
      operation: 'clear';
    }
  | {
      kind: 'boxel-sandbox-render-request';
      transportVersion: number;
      requestId: string;
      generation: number;
      operation: 'draft';
      url: string;
    }
  | {
      kind: 'boxel-sandbox-render-request';
      transportVersion: number;
      requestId: string;
      generation: number;
      /**
       * RP-20.5: parent→child instance-data push. The Host serializes the
       * canonical instance's CURRENT state (the same projected execution
       * document `createFromSerialized` consumed) and the child applies it
       * to its already-materialized copy IN PLACE (`updateFromSerialized` —
       * main's reload path), so the child's own tracking re-renders every
       * binding without remounting the component. Generation ordering
       * (shared with render/clear/draft) is the revision guard: a push
       * superseded in flight is dropped, never applied out of order.
       */
      operation: 'updateInstance';
      document: LooseSingleCardDocument;
    };

/**
 * A structured-clone-safe projection of a child-side Error. `stack` and the
 * (depth-bounded) `cause` chain ride along so the Host's error presentation
 * can show the render's ROOT cause — a bare name/message pair from a boundary
 * wrapper hides the failure that actually matters.
 */
export interface SandboxProjectedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SandboxProjectedError;
}

export type SandboxRenderResponse =
  | {
      kind: 'boxel-sandbox-render-response';
      transportVersion: number;
      requestId: string;
      generation: number;
      ok: true;
    }
  | {
      kind: 'boxel-sandbox-render-response';
      transportVersion: number;
      requestId: string;
      generation: number;
      ok: false;
      error: SandboxProjectedError;
      /**
       * True when the child chose not to run this generation at all (or
       * abandoned it mid-flight) because a newer one already superseded it
       * — informational, not a genuine render/draft failure. The parent's
       * own generation bookkeeping (comparing this response's `generation`
       * against the latest one it has issued) is what actually decides
       * whether to surface an error; this flag only distinguishes "chose
       * not to run it" from "ran it and it threw."
       */
      dropped?: boolean;
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
  /**
   * The theme's raw CSS custom-property definitions (`cssVariables` on the
   * Theme card, or on the instance itself when it is theme-shaped) — the
   * exact string main's `field-component.gts` hands `CardContainer`'s
   * `@themeCss`, from which `themeScopedCss(themeScope, themeCss)` compiles
   * the scoped stylesheet. Crossed as a plain string for the same reason as
   * `themeScope`: the boundary tier's Host-owned wrapper must be able to
   * make the identical trusted `CardContainer` invocation main makes, since
   * the live Theme card never crosses. `null` when the instance has no
   * theme CSS.
   */
  themeCss: string | null;
  /**
   * The theme's `cssImports` URL list (`CardContainer @cssImports` on
   * main): stylesheet `@import`s — typically font faces — the theme
   * depends on. Same Host-side derivation and same trusted emission point
   * as `themeCss`.
   */
  cssImports: string[] | null;
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
