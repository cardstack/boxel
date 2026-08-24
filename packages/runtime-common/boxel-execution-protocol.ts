/**
 * Every shape that crosses a trust boundary between the Host and code the
 * Host does not trust (RP-14).
 *
 * Three properties make this module what it is, and each one is a constraint
 * on what may be added here:
 *
 * 1. **No Ember imports, and no runtime imports at all.** This module is
 *    evaluated inside a SES Compartment and inside an origin-isolated iframe
 *    child, neither of which has the Host's module graph. Every import below
 *    is `import type`, so nothing survives to run.
 * 2. **Inert data only.** No live object crosses a boundary — no store,
 *    loader, service, class, component instance, callback, DOM node, or
 *    browser event. Each record type below is declared through `Cloneable`,
 *    which proves at compile time that it is `structuredClone`-able JSON
 *    data.
 * 3. **Versioned.** Every record carries the protocol version and the
 *    features it requires; a consumer checks both before it applies any part
 *    of a record, and fails closed to its last-known-good output otherwise
 *    (RP-14.3).
 *
 * This module is deliberately absent from `index.ts`: reaching it through the
 * `@cardstack/runtime-common` barrel would drag the barrel's own graph in,
 * which defeats property 1 for the two consumers that need it most. Import it
 * by path — `@cardstack/runtime-common/boxel-execution-protocol`.
 */

import type * as JSONTypes from 'json-typescript';

import type { CodeRef } from './code-ref.ts';
import type { Format } from './formats.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';

/**
 * The inert-data proof. `Cloneable<T>` resolves to `T`, so it costs consumers
 * nothing, but a member typed as a function, a class instance, a DOM node, a
 * `Map`/`Set`, or `unknown` fails the constraint and the module does not
 * compile.
 *
 * Records here are type aliases rather than interfaces because the proof
 * rests on the implicit index signature TypeScript infers for an object type
 * alias and does not infer for an interface: an interface cannot satisfy the
 * constraint at all, however inert its members are.
 */
type JsonData =
  | JSONTypes.Primitive
  | undefined
  | readonly JsonData[]
  | { readonly [key: string]: JsonData };
type Cloneable<T extends JsonData> = T;

// The semantic version: the meaning of the records below — what a
// description, a projection, or a template bundle says about a card.
export const BOXEL_EXECUTION_PROTOCOL_VERSION = 1;

// The transport version: the envelope shape of messages on the Sandbox
// tier's private channel. Deliberately a separate number, because the wire
// format and the card semantics it carries change for unrelated reasons and
// on unrelated schedules (RP-14.3). Both are enforced.
export const BOXEL_EXECUTION_TRANSPORT_VERSION = 1;

/**
 * Optional semantics a producer may depend on and a consumer may lack. A
 * record names the ones it needs in `requiredFeatures`; a consumer that does
 * not recognize one of them rejects the entire record.
 *
 * Version 1 defines none: every v1 producer emits an empty list. The
 * mechanism exists ahead of its first feature because the alternative —
 * introducing it with the feature — leaves every already-deployed consumer
 * unable to recognize that it is missing something.
 *
 * There is no central registry of supported features, by design. Support is a
 * property of a consumer, not of the protocol, so each consumer passes the
 * set it implements (see `ProtocolSupport`).
 */
export type ProtocolEnvelope = Cloneable<{
  protocolVersion: number;
  requiredFeatures: string[];
}>;

/**
 * What one consumer can honor. Consumers differ; the protocol does not.
 *
 * The one shape here that is not a record: support is a fact about the local
 * endpoint, so it never crosses a boundary and carries a `Set` rather than
 * the JSON a record is limited to.
 */
export interface ProtocolSupport {
  protocolVersion: number;
  features: ReadonlySet<string>;
}

export const PROTOCOL_REFUSAL_CODES = [
  'BOXEL_PROTOCOL_VERSION_UNSUPPORTED',
  'BOXEL_TRANSPORT_VERSION_UNSUPPORTED',
  'BOXEL_PROTOCOL_FEATURE_UNSUPPORTED',
  'BOXEL_TEMPLATE_DEPENDENCY_KIND_UNKNOWN',
  'BOXEL_COMPONENT_EFFECT_KIND_UNKNOWN',
] as const;
export type ProtocolRefusalCode = (typeof PROTOCOL_REFUSAL_CODES)[number];

/**
 * A refusal to apply a record. The `code` is the stable identity a diagnostic
 * catalog, a log query, or a test can key on; the message says which record
 * and which member forced it.
 */
export class ProtocolRefusal extends Error {
  readonly code: ProtocolRefusalCode;

  constructor(code: ProtocolRefusalCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'ProtocolRefusal';
    this.code = code;
  }
}

/**
 * The gate every consumer of a versioned record passes before it reads any
 * member of that record (RP-14.3).
 *
 * Rejection is atomic by construction: this throws, so a caller that gates
 * first has applied nothing and its previous output still stands. Unknown
 * features are collected and reported together rather than one per call, so
 * the single diagnostic a fail-closed consumer emits names everything it
 * could not honor.
 */
export function assertUsableExecutionRecord(
  record: ProtocolEnvelope,
  support: ProtocolSupport,
): void {
  // Read once, up front: the envelope is the whole basis of the decision, and
  // reading it exactly once is what makes that checkable.
  let { protocolVersion, requiredFeatures } = record;
  if (protocolVersion !== support.protocolVersion) {
    throw new ProtocolRefusal(
      'BOXEL_PROTOCOL_VERSION_UNSUPPORTED',
      `record declares protocol version ${protocolVersion}; this consumer implements ${support.protocolVersion}`,
    );
  }
  let unsupported = requiredFeatures.filter(
    (feature) => !support.features.has(feature),
  );
  if (unsupported.length > 0) {
    throw new ProtocolRefusal(
      'BOXEL_PROTOCOL_FEATURE_UNSUPPORTED',
      `record requires features this consumer does not implement: ${unsupported.join(', ')}`,
    );
  }
}

/**
 * The transport counterpart, checked on a message envelope before its payload
 * is dispatched to a lane.
 */
export function assertExecutionTransportVersion(
  transportVersion: number,
  supported = BOXEL_EXECUTION_TRANSPORT_VERSION,
): void {
  if (transportVersion !== supported) {
    throw new ProtocolRefusal(
      'BOXEL_TRANSPORT_VERSION_UNSUPPORTED',
      `message declares transport version ${transportVersion}; this endpoint implements ${supported}`,
    );
  }
}

/**
 * The operations a tier's runtime offers, and nothing else (RP-14.2). The set
 * is closed: a tier that cannot express a behavior through these is a spec
 * change, not a new operation on one adapter.
 *
 * Mutation is absent on purpose. Writing is not an operation any tier may
 * perform on its own — it is a `set` capability the Host grants, revokes, and
 * re-authorizes on every use (RP-9.8).
 *
 * `getRenderSlot` is the one operation whose result is not cloneable: a
 * component definition is executable and stays with the runtime that owns it.
 * Rendering is a process-local effect, so the slot never crosses a boundary —
 * only the request for one does.
 */
export const BOXEL_RUNTIME_OPERATIONS = [
  'loadBoxel',
  'describeBoxel',
  'createFromSerialized',
  'getFields',
  'getField',
  'getRenderSlot',
  'invokeAction',
  'serializeCard',
  'dispose',
] as const;
export type BoxelRuntimeOperation = (typeof BOXEL_RUNTIME_OPERATIONS)[number];

/**
 * The child-format cascade: the formats `<@fields.x />` resolves to inside a
 * template rendering as `containingFormat`, when the author names none
 * (RP-2.6).
 *
 * This is the one definition of the cascade for every consumer outside Base's
 * own field components, and it mirrors `defaultFieldFormats` in
 * `@cardstack/base/field-component.gts`. A second copy renders nested cards
 * in the wrong format on whichever tier holds it — a divergence invisible in
 * that tier's own tests, since they would agree with its copy.
 *
 * `containingFormat` is a plain string, not `Format`: an unknown format is
 * not an error here, it degrades to the display default exactly as it does in
 * Base.
 */
export function childFieldFormatsFor(containingFormat: string): {
  fieldDef: Format;
  cardDef: Format;
} {
  switch (containingFormat) {
    case 'edit':
      return { fieldDef: 'edit', cardDef: 'edit' };
    case 'atom':
    case 'head':
    case 'markdown':
      // Each of these recurses in itself, which is what makes it a fixed
      // point: a field inside a markdown template delegates to the child's
      // markdown template rather than to embedded/fitted HTML, so the
      // composed output is uniformly markdown text.
      return { fieldDef: containingFormat, cardDef: containingFormat };
    default:
      // isolated, embedded, fitted — and every unrecognized format, which
      // Base degrades the same way.
      return { fieldDef: 'embedded', cardDef: 'fitted' };
  }
}

export const BOXEL_KINDS = ['card', 'field', 'file'] as const;
export type BoxelKind = (typeof BOXEL_KINDS)[number];

export const FIELD_KINDS = [
  'contains',
  'containsMany',
  'linksTo',
  'linksToMany',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/**
 * One field a Boxel type declares.
 *
 * Deliberately no `Field` object, no field-class constructor, no serializer,
 * no getter, and no component definition: those stay with the runtime that
 * loaded the type.
 *
 * `resolvedConfiguration` is the resolved configuration *data*, never the
 * functions that produced it — a configuration function runs with its
 * semantic owner and only its result crosses (RP-5.4). It is `null` in a
 * description built without an owning instance, because resolution takes the
 * owning root instance as `this` (RP-5.1).
 */
export type FieldDescription = Cloneable<{
  fieldName: string;
  fieldType: CodeRef;
  kind: FieldKind;
  isComputed: boolean;
  resolvedConfiguration: JSONTypes.Value | null;
}>;

/**
 * One format a type can render, and who supplies it. The format is an open
 * string so a new authored format needs no protocol release; the provider
 * identifies the executable owner without transferring its definition.
 */
export type FormatDescription = Cloneable<{
  format: string;
  provider: {
    kind: 'authored' | 'trusted-base';
    ref: CodeRef;
  };
}>;

/** The author-declared statics the Host reads to present a type (RP-11.1). */
export type TypePresentation = Cloneable<{
  displayName: string;
  headerColor: string | null;
  prefersWideFormat: boolean;
}>;

/** Everything a consumer needs to know about a type, as data. */
export type BoxelDescription = Cloneable<
  ProtocolEnvelope & {
    ref: CodeRef;
    boxelKind: BoxelKind;
    ancestors: CodeRef[];
    fields: FieldDescription[];
    formats: FormatDescription[];
    presentation: TypePresentation;
    executionHints: {
      // An author may always ask for a stronger cage; nothing here can ask
      // for a weaker one (RP-6.1).
      prefersFullSandbox: boolean;
    };
  }
>;

/**
 * How a linked value appears in a projection: an identity and a type, which
 * the recipient resolves through the canonical Store — never the linked
 * card's own data. A card holding a link to a card holding a link does not
 * hand its recipient a graph to walk.
 */
export type BoxelValueReference = Cloneable<{
  $boxel: {
    id: RealmResourceIdentifier | null;
    type: CodeRef;
  };
}>;

/**
 * Whether a projected value is a link reference rather than data.
 *
 * Exact by design: a `$boxel` marker carrying anything beyond `id` and
 * `type`, or sitting beside sibling members, is an expanded graph wearing a
 * reference's clothes and answers `false` here rather than being accepted as
 * a reference.
 */
export function isBoxelValueReference(
  value: unknown,
): value is BoxelValueReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  let keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== '$boxel') {
    return false;
  }
  let marker = (value as { $boxel: unknown }).$boxel;
  if (typeof marker !== 'object' || marker === null || Array.isArray(marker)) {
    return false;
  }
  let markerKeys = Object.keys(marker).sort();
  if (
    markerKeys.length !== 2 ||
    markerKeys[0] !== 'id' ||
    markerKeys[1] !== 'type'
  ) {
    return false;
  }
  let { id, type } = marker as { id: unknown; type: unknown };
  return (
    (id === null || typeof id === 'string') &&
    typeof type === 'object' &&
    type !== null &&
    !Array.isArray(type)
  );
}

/**
 * One instance's state, as data.
 *
 * `model` carries declared field values and the JSON-safe results of getters
 * the owning runtime evaluated. Linked values appear as
 * `BoxelValueReference`s — the projection is one instance deep, never an
 * expanded graph. The type system cannot state that rule (a reference is
 * structurally an object like any other), so the producer holds it: the
 * projection pipeline knows each field's kind and emits a reference for every
 * `linksTo`/`linksToMany`. `isBoxelValueReference` is how a consumer tells
 * the two apart.
 *
 * `revision` orders projections of one instance against each other. It is not
 * an etag and carries no server meaning — main's write path has no revision
 * token (RP-9.6) — it exists so a recipient can drop a projection that a
 * newer one has already superseded in flight.
 */
export type InstanceProjection = Cloneable<
  ProtocolEnvelope & {
    id: RealmResourceIdentifier | null;
    type: CodeRef;
    revision: number;
    model: Record<string, JSONTypes.Value>;
  }
>;

/**
 * What a name in a captured template resolves to. Every entry is a token the
 * Host redeems against a vocabulary — never the value itself, and never
 * anything executable.
 *
 * The three trusted kinds carry the same `module`/`name` pair and differ only
 * in kind, which is the point: the Host resolves a component reference, a
 * helper reference, and a modifier reference against three different
 * allowlists, and a token that names a real export of the wrong category is
 * refused rather than invoked.
 *
 * An `authored-component` names another captured template in the same bundle,
 * which goes through capture, validation, and rebuild exactly like the one
 * referencing it.
 *
 * A name that fits none of these kinds — a locally defined function used as a
 * template helper, most often — has no safe category and is refused by name
 * at capture time rather than smuggled across.
 */
export const TEMPLATE_DEPENDENCY_KINDS = [
  'trusted-component',
  'authored-component',
  'trusted-helper',
  'safe-modifier',
  'block',
] as const;
export type TemplateDependencyKind = (typeof TEMPLATE_DEPENDENCY_KINDS)[number];

export type TemplateDependency = Cloneable<
  | { kind: 'trusted-component'; module: string; name: string }
  | { kind: 'trusted-helper'; module: string; name: string }
  | { kind: 'safe-modifier'; module: string; name: string }
  | { kind: 'authored-component'; template: string }
  | { kind: 'block'; name: string }
>;

/**
 * The projected state of one captured component instance. The authored
 * instance itself stays with its execution owner; this is the cloneable view
 * of it a rebuilt Host component reads, and the baseline that a
 * `ComponentUpdate` reports changes against.
 */
export type ComponentInstanceDescriptor = Cloneable<{
  handle: string;
  state: Record<string, JSONTypes.Value>;
  getters: string[];
  actions: string[];
}>;

export type TemplateDescriptor = Cloneable<{
  id: string;
  block: string;
  moduleName: string;
  isStrictMode: boolean;
  stylesheets: string[];
  scope: TemplateDependency[];
  instance: ComponentInstanceDescriptor;
}>;

/**
 * Validated template instructions plus their resolved names. It never holds
 * an authored closure; the Host reifies it into private component definitions
 * only after validation.
 */
export type TemplateBundle = Cloneable<
  ProtocolEnvelope & {
    root: string;
    templates: Record<string, TemplateDescriptor>;
  }
>;

const templateDependencyKinds: ReadonlySet<string> = new Set(
  TEMPLATE_DEPENDENCY_KINDS,
);

/**
 * The gate a consumer passes before it reifies any part of a bundle.
 *
 * A single unrecognized dependency kind rejects the whole generation, not the
 * one template that carries it: a bundle is a template and everything its
 * templates reference, so reifying the recognized part of it would render a
 * component whose scope is missing exactly the name nobody understood. Every
 * unrecognized kind is reported at once, so one diagnostic names all of them.
 */
export function assertKnownTemplateDependencies(
  bundle: TemplateBundle,
  support: ProtocolSupport,
): void {
  assertUsableExecutionRecord(bundle, support);
  let unrecognized: string[] = [];
  for (let descriptor of Object.values(bundle.templates)) {
    for (let dependency of descriptor.scope) {
      if (!templateDependencyKinds.has(dependency.kind)) {
        unrecognized.push(`${descriptor.id}: '${dependency.kind}'`);
      }
    }
  }
  if (unrecognized.length > 0) {
    throw new ProtocolRefusal(
      'BOXEL_TEMPLATE_DEPENDENCY_KIND_UNKNOWN',
      `template bundle '${bundle.root}' names dependency kinds this consumer does not recognize — ${unrecognized.join('; ')}`,
    );
  }
}

/**
 * What caged code asks the Host to do, expressed as intent rather than
 * action. Each kind names one of the capabilities the Host's own surface
 * service owns (RP-16.1); holding an effect grants nothing, and the Host
 * re-authorizes every one before performing it.
 *
 * `payload` is deliberately open: each capability's argument shape belongs to
 * that capability's own spec section, which versions independently of this
 * envelope.
 */
export const COMPONENT_EFFECT_KINDS = [
  'presentation',
  'layout',
  'observe',
  'view-card',
  'patch',
] as const;
export type ComponentEffectKind = (typeof COMPONENT_EFFECT_KINDS)[number];

export type ComponentEffect = Cloneable<{
  kind: ComponentEffectKind;
  payload: JSONTypes.Value;
}>;

/**
 * What one turn of caged component code produced: the projected state that
 * changed, and the capability requests it queued.
 *
 * `generation` is the render-family sequence number the request carried. A
 * consumer applies an update only for the generation it is still waiting on,
 * so a burst of rapid edits or format switches cannot resurrect superseded
 * output.
 */
export type ComponentUpdate = Cloneable<
  ProtocolEnvelope & {
    generation: number;
    changed: Record<string, JSONTypes.Value>;
    effects: ComponentEffect[];
  }
>;

const componentEffectKinds: ReadonlySet<string> = new Set(
  COMPONENT_EFFECT_KINDS,
);

/**
 * The gate a consumer passes before it applies an update or dispatches its
 * effects. An unrecognized effect kind rejects the whole update, changed
 * state included: applying the state while dropping the request that was
 * supposed to accompany it is how a surface ends up showing a half-performed
 * intent.
 */
export function assertKnownComponentEffects(
  update: ComponentUpdate,
  support: ProtocolSupport,
): void {
  assertUsableExecutionRecord(update, support);
  let unrecognized = update.effects
    .map((effect) => effect.kind)
    .filter((kind) => !componentEffectKinds.has(kind));
  if (unrecognized.length > 0) {
    throw new ProtocolRefusal(
      'BOXEL_COMPONENT_EFFECT_KIND_UNKNOWN',
      `component update names effect kinds this consumer does not recognize: ${unrecognized.join(', ')}`,
    );
  }
}

/**
 * The event members that may cross into an authored handler, grouped by the
 * scalar type each one projects to.
 *
 * These arrays are the allowlist itself, not a copy of one: the `SafeEvent`
 * type is derived from them, so a member added to the type and a member
 * admitted at runtime cannot drift apart. Grouping by type is what lets the
 * projection admit `clientX: 42` and refuse `clientX: '42'` — one flat list
 * would type every projected member as `string | number | boolean | null`
 * and accept any scalar in any slot.
 */
export const SAFE_EVENT_BOOLEAN_PROPERTIES = [
  'altKey',
  'ctrlKey',
  'isPrimary',
  'metaKey',
  'repeat',
  'shiftKey',
] as const;
export const SAFE_EVENT_NUMBER_PROPERTIES = [
  'button',
  'buttons',
  'clientX',
  'clientY',
  'deltaMode',
  'deltaX',
  'deltaY',
  'pageX',
  'pageY',
  'pointerId',
  'screenX',
  'screenY',
] as const;
export const SAFE_EVENT_STRING_PROPERTIES = [
  'code',
  'inputType',
  'key',
  'pointerType',
] as const;
export const SAFE_EVENT_NULLABLE_STRING_PROPERTIES = ['data'] as const;

/** The same allowlist discipline for the element an event came from. */
export const SAFE_EVENT_TARGET_BOOLEAN_PROPERTIES = ['checked'] as const;
export const SAFE_EVENT_TARGET_NUMBER_PROPERTIES = ['selectedIndex'] as const;
export const SAFE_EVENT_TARGET_STRING_PROPERTIES = [
  'id',
  'name',
  'type',
] as const;
export const SAFE_EVENT_TARGET_SCALAR_PROPERTIES = ['value'] as const;

/**
 * What an event's target reduces to. The live `Element` never crosses: a
 * handler receives the element's tag name, its allowlisted scalar members,
 * and its string dataset — no parent, no children, no methods, and no way
 * back to the document.
 */
export type SafeEventTarget = Cloneable<
  {
    tagName: string;
    dataset?: Record<string, string>;
  } & {
    [K in (typeof SAFE_EVENT_TARGET_BOOLEAN_PROPERTIES)[number]]?: boolean;
  } & {
    [K in (typeof SAFE_EVENT_TARGET_NUMBER_PROPERTIES)[number]]?: number;
  } & {
    [K in (typeof SAFE_EVENT_TARGET_STRING_PROPERTIES)[number]]?: string;
  } & {
    [K in (typeof SAFE_EVENT_TARGET_SCALAR_PROPERTIES)[number]]?:
      | string
      | number
      | boolean;
  }
>;

/**
 * What a browser event reduces to before it reaches an authored handler.
 *
 * The required members are the ones every event has. The optional ones are
 * present when the source event carried a value of the right type for that
 * member — a click has no `key`, and its `SafeEvent` has none either. Nothing
 * here can be used to reach the page: no `preventDefault`, no `stopPropagation`,
 * no `view`, no `relatedTarget`, no `path`.
 */
export type SafeEvent = Cloneable<
  ProtocolEnvelope & {
    type: string;
    bubbles: boolean;
    cancelable: boolean;
    composed: boolean;
    defaultPrevented: boolean;
    target: SafeEventTarget | null;
    currentTarget: SafeEventTarget | null;
  } & {
    [K in (typeof SAFE_EVENT_BOOLEAN_PROPERTIES)[number]]?: boolean;
  } & {
    [K in (typeof SAFE_EVENT_NUMBER_PROPERTIES)[number]]?: number;
  } & {
    [K in (typeof SAFE_EVENT_STRING_PROPERTIES)[number]]?: string;
  } & {
    [K in (typeof SAFE_EVENT_NULLABLE_STRING_PROPERTIES)[number]]?:
      | string
      | null;
  }
>;
