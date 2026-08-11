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
 * The single authority for which height mode a render gets. Both sides of
 * the Sandbox boundary derive from this one function, with the same inputs,
 * so the parent's Surface layout and the child's decision to measure never
 * disagree.
 *
 * Two things allocate a box, and they are different in kind:
 *
 * - `format === 'fitted'`: a tile owner always allocates a fitted card's
 *   box. This is a property of the format itself.
 * - `hostOwnsBox`: the Host slot this render lands in has a definite height
 *   of its own (a stack item, whose box comes from the viewport). Only the
 *   Host knows this — the same format renders into a definite box in one
 *   place and an auto-height panel in another, so it cannot be inferred
 *   from the format string. RP-9.9.
 *
 * Everything else flows at its content's intrinsic height: the child
 * reports it, the Host applies it, and the surrounding stack scrolls — the
 * same reading experience as an in-document card.
 *
 * Why `hostOwnsBox` cannot be dropped in favor of a format rule: a card
 * authored `height: 100%` (main's stack items give one, so authors write
 * them) resolves that percentage against its container. Measure the
 * container from the content instead and the percentage has nothing
 * definite to resolve against, so it collapses to the content's own
 * height — which is what produced it. A card that FILLS its box can never
 * also be the thing that MEASURES it; someone above has to own the box and
 * say so.
 */
export function surfaceHeightModeFor(
  format: string,
  hostOwnsBox = false,
): SurfaceHeightMode {
  return hostOwnsBox || format === 'fitted' ? 'allocated' : 'intrinsic';
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

/**
 * The child has admitted an RPC and begun executing it.
 *
 * This is deliberately distinct from the bootstrap `ready` message. A ready
 * transport can still need to fetch, transpile, and evaluate a cold authored
 * module before `createFromSerialized` can complete. The parent uses this
 * acknowledgement to distinguish a dead/unresponsive peer from useful work
 * that needs the bounded cold-operation budget.
 */
export interface BoxelRuntimeAccepted {
  kind: 'boxel-runtime-accepted';
  transportVersion: number;
  requestId: string;
  operation: BoxelRuntimeOperation;
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
      /**
       * RP-9.9: whether the Host slot this render lands in owns a definite
       * box. Absent means it does not (the format's default applies). The
       * child needs it because a card that fills its box cannot also be the
       * thing that measures it — see `surfaceHeightModeFor`.
       */
      hostOwnsBox?: boolean;
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
    }
  | {
      kind: 'boxel-sandbox-render-request';
      transportVersion: number;
      requestId: string;
      generation: number;
      /**
       * RP-10 across the Sandbox boundary: the Host's context plane cannot
       * flow into a cross-origin child through component tree scope the way
       * it does for Direct/Capsule, so the parent pushes a cloneable
       * SNAPSHOT of the context values a rendered card is entitled to.
       * v1 carries exactly one context: the card's realm `Permissions`
       * (RP-9.1 — without it, every Base-wrapped field editor in the child
       * renders disabled). `null` means "no permissions known" (the child
       * provides undefined, the same as the Host before realm permissions
       * settle). Same generation ordering as every render-family request: a
       * snapshot superseded in flight is dropped, never applied out of
       * order.
       */
      operation: 'updateContext';
      permissions: { canRead: boolean; canWrite: boolean } | null;
    };

/**
 * RP-20.6 child→parent instance write: the Sandbox child's proposal of new
 * state for the ONE card it is rendering — the reverse leg of RP-20.5's
 * parent→child push, carrying a full save-shaped serialized document (not a
 * diff; each write is the instance's complete current state, so a missed one
 * self-heals on the next). `seq` is a child-issued monotonic counter: the
 * parent applies writes in arrival order (MessagePort is FIFO) and drops a
 * request whose seq it has already passed, so a stale document can never be
 * applied after a newer one. The parent — not the child — owns everything
 * downstream of apply: it updates the CANONICAL instance in place
 * (`updateFromSerialized`) and schedules the store's own debounced autosave,
 * so persistence, permissions, and realm arbitration all stay parent-side.
 */
export interface SandboxWriteRequest {
  kind: 'boxel-sandbox-write-request';
  transportVersion: number;
  requestId: string;
  seq: number;
  document: LooseSingleCardDocument;
}

export type SandboxWriteResponse =
  | {
      kind: 'boxel-sandbox-write-response';
      transportVersion: number;
      requestId: string;
      seq: number;
      ok: true;
    }
  | {
      kind: 'boxel-sandbox-write-response';
      transportVersion: number;
      requestId: string;
      seq: number;
      ok: false;
      error: SandboxProjectedError;
      /**
       * True when the parent chose not to apply this write because a newer
       * seq had already been applied — informational, not a failure of the
       * child's state (the newer write already carried it).
       */
      dropped?: boolean;
    };

/**
 * Child→parent request to open a card that was rendered inside an
 * origin-isolated Sandbox. Base's `cardComponentModifier` supplies this
 * semantic identity at the render site; the child forwards only the card
 * identifier and the same format/relationship metadata that main's
 * ElementTracker passes to `viewCard`.
 *
 * This is deliberately a UI capability, not data authority. The child does
 * not receive the Host router, Store, or a card instance. The parent remains
 * responsible for resolving the identifier and enforcing ordinary read
 * permissions when operator mode handles the request.
 */
export interface SandboxViewCardRequest {
  kind: 'boxel-sandbox-view-card-request';
  transportVersion: number;
  requestId: string;
  cardId: string;
  format: string;
  fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany';
  fieldName?: string;
}

export type SandboxViewCardResponse =
  | {
      kind: 'boxel-sandbox-view-card-response';
      transportVersion: number;
      requestId: string;
      ok: true;
    }
  | {
      kind: 'boxel-sandbox-view-card-response';
      transportVersion: number;
      requestId: string;
      ok: false;
      error: SandboxProjectedError;
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
