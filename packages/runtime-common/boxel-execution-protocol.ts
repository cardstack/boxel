/**
 * Every shape that crosses a trust boundary between the Host and code the
 * Host does not trust (RP-14).
 *
 * Three properties make this module what it is, and each one is a constraint
 * on what may be added here:
 *
 * 1. **No Ember imports, and nothing that pulls the Host's module graph.**
 *    This module is evaluated inside a SES Compartment and inside an
 *    origin-isolated iframe child, neither of which has that graph. Every
 *    import here is either `import type`, erased entirely, or a pure shape
 *    predicate from `card-document-shape.ts` — a module that exists precisely
 *    so a caller can recognize a shape without pulling the heavy runtime
 *    chain rooted at `code-ref.ts`.
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

import { isCodeRef } from './card-document-shape.ts';
import type { CodeRef } from './code-ref.ts';
import type { Format } from './formats.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';

/**
 * The inert-data check. `Cloneable<T>` resolves to `T`, so it costs consumers
 * nothing, but a member typed as a function, a class instance, a DOM node, a
 * `Map`, `Set`, `Date`, `Promise`, `RegExp`, `symbol`, `bigint`, `object`, or
 * `unknown` fails the constraint and the module does not compile.
 *
 * What it does not catch is `any`, which satisfies the constraint at any
 * depth — `any` opts out of the type system here exactly as it does
 * everywhere else. A record member typed `any` gets no check at all.
 *
 * The constraint rests on the implicit index signature TypeScript infers for
 * an object type alias, so two consequences follow. Records here are type
 * aliases: an interface *without* an index signature cannot satisfy the
 * constraint however inert its members are (one *with* an index signature
 * satisfies it fine — that is why `JSONTypes.Value`, built from interfaces,
 * works throughout). And a member whose type transitively resolves to an
 * index-signature-less interface is rejected, so turning a neighbor's type
 * alias into an interface surfaces as an error here rather than there.
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
  'BOXEL_RECORD_MALFORMED',
  'BOXEL_PROTOCOL_VERSION_UNSUPPORTED',
  'BOXEL_TRANSPORT_VERSION_UNSUPPORTED',
  'BOXEL_PROTOCOL_FEATURE_UNSUPPORTED',
  'BOXEL_TEMPLATE_DEPENDENCY_KIND_UNKNOWN',
  'BOXEL_TEMPLATE_BUNDLE_INCOMPLETE',
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
    // Defined, not assigned. `name` is inherited from `Error.prototype`, which
    // SES's lockdown() freezes, and a strict-mode assignment through a frozen
    // non-writable inherited property throws. Assigning here would make this
    // class unconstructible inside a Compartment — turning every refusal in
    // the module into the raw TypeError it exists to replace, in exactly the
    // environment the module exists to serve.
    Object.defineProperty(this, 'name', {
      value: 'ProtocolRefusal',
      writable: true,
      configurable: true,
    });
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
  let { protocolVersion, requiredFeatures } = readEnvelope(record);
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
      `record requires features this consumer does not implement: ${joinTokens(
        unsupported.map((feature) => describeValue(feature)),
      )}`,
    );
  }
}

/**
 * How much of a boundary-supplied string a diagnostic repeats.
 *
 * A refusal is written to a log, and the string that triggered it is chosen by
 * the code being refused. Caged code that emits one malformed record per
 * render would otherwise put a megabyte into the log stream on every attempt.
 */
const DIAGNOSTIC_TOKEN_LIMIT = 64;

/**
 * How many offending items a diagnostic names before summarizing the rest.
 *
 * Bounding each token is not enough on its own: the far side also chooses how
 * many there are, so fifty thousand short names is the same megabyte of log
 * by a different route.
 */
const DIAGNOSTIC_LIST_LIMIT = 10;

/**
 * Quotes a boundary-supplied string for a diagnostic: JSON-escaped, so an
 * embedded newline cannot forge a log line, and truncated to a length the
 * far side does not choose.
 */
function quoteToken(value: string): string {
  return JSON.stringify(
    value.length > DIAGNOSTIC_TOKEN_LIMIT
      ? `${value.slice(0, DIAGNOSTIC_TOKEN_LIMIT)}…`
      : value,
  );
}

/** Joins offending items for a diagnostic, bounded in count as well as size. */
function joinTokens(items: string[], separator = ', '): string {
  let shown = items.slice(0, DIAGNOSTIC_LIST_LIMIT);
  let withheld = items.length - shown.length;
  return withheld > 0
    ? `${shown.join(separator)} (and ${withheld} more)`
    : shown.join(separator);
}

/**
 * How deep a literal value may nest before it is refused.
 *
 * Doubles as the cycle guard: a value that loops back on itself runs the depth
 * down and is refused rather than walked forever.
 */
const MAX_LITERAL_VALUE_DEPTH = 32;

/**
 * Whether an object carries `key` as an own data property holding inert JSON.
 * Never reads through an accessor.
 */
function isJsonDataProperty(source: object, key: string): boolean {
  let descriptor = Object.getOwnPropertyDescriptor(source, key);
  return (
    descriptor !== undefined &&
    'value' in descriptor &&
    isJsonData(descriptor.value)
  );
}

/**
 * Whether a value is inert JSON data all the way down.
 *
 * Accessors are refused rather than read: a getter is not data, and invoking
 * one to find out would run far-side code inside the gate. Prototypes other
 * than `Object.prototype` are refused for the same reason a class instance is
 * — the members that matter would not be the own ones.
 */
function isJsonData(value: unknown, depth = MAX_LITERAL_VALUE_DEPTH): boolean {
  if (value === null) {
    return true;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'object' || depth <= 0) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonData(entry, depth - 1));
  }
  let prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  return Object.keys(value).every((key) => {
    let descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      'value' in descriptor &&
      isJsonData(descriptor.value, depth - 1)
    );
  });
}

/**
 * Names a rejected value in a diagnostic. A scalar is named by its value,
 * because the value is the whole content of the complaint; a string goes
 * through `quoteToken`; anything else is named by its type, since the type is
 * what was wrong with it.
 */
function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'an array';
  }
  if (typeof value === 'string') {
    return quoteToken(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return typeof value;
}

/**
 * The envelope, read as untrusted input rather than as the type it claims.
 *
 * A record's producer is on the far side of a trust boundary, so the record's
 * own shape is the first thing in doubt. Every refusal here has to be a
 * `ProtocolRefusal` for the same reason the version and feature refusals do:
 * a consumer catches that one type, and a `TypeError` from an absent or
 * mistyped member would escape it unhandled — discarding the last-known-good
 * output the refusal exists to protect, and skipping the one diagnostic
 * RP-14.3 asks for.
 */
function readEnvelope(record: ProtocolEnvelope): {
  protocolVersion: number;
  requiredFeatures: string[];
} {
  let candidate: unknown = record;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `expected a record object, received ${describeValue(candidate)}`,
    );
  }
  let { protocolVersion, requiredFeatures } =
    candidate as Partial<ProtocolEnvelope>;
  if (
    typeof protocolVersion !== 'number' ||
    !Number.isFinite(protocolVersion)
  ) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `protocolVersion must be a finite number, received ${describeValue(protocolVersion)}`,
    );
  }
  if (
    !Array.isArray(requiredFeatures) ||
    // Spread first: `some` and `filter` skip the holes in a sparse array, so
    // `[, ,]` would pass as "an array of strings" and then be carried as two
    // features named `undefined`.
    ![...requiredFeatures].every((feature) => typeof feature === 'string')
  ) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `requiredFeatures must be an array of strings, received ${describeValue(requiredFeatures)}`,
    );
  }
  return { protocolVersion, requiredFeatures };
}

/**
 * The transport counterpart, checked on a message envelope before its payload
 * is dispatched to a lane.
 *
 * The supported version is the constant, not a parameter: one build carries
 * one transport implementation, so a caller-supplied "supported" value could
 * only ever weaken the gate.
 */
export function assertExecutionTransportVersion(
  transportVersion: number,
): void {
  if (transportVersion !== BOXEL_EXECUTION_TRANSPORT_VERSION) {
    throw new ProtocolRefusal(
      'BOXEL_TRANSPORT_VERSION_UNSUPPORTED',
      `message declares transport version ${describeValue(
        transportVersion,
      )}; this endpoint implements ${BOXEL_EXECUTION_TRANSPORT_VERSION}`,
    );
  }
}

/**
 * Why an instance is being materialized. `createFromSerialized` carries it,
 * because the answer changes what a runtime is allowed to be lenient about:
 * an indexing pass must fail loudly on a definition it cannot identify, where
 * an interactive surface shows an error card and carries on. Collapsing the
 * two lets an indexing failure ride as a rendering failure — which is how a
 * single unidentifiable card takes a whole indexing shard with it.
 */
export const MATERIALIZATION_PURPOSES = [
  'host-display',
  'code-preview',
  'interactive-edit',
  'command-validation',
  'indexing',
] as const;
export type MaterializationPurpose = (typeof MATERIALIZATION_PURPOSES)[number];

/**
 * The operations a tier's runtime offers, and nothing else (RP-14.2). The set
 * is closed: a tier that cannot express a behavior through these is a spec
 * change, not a new operation on one adapter.
 *
 * Mutation is absent on purpose. Writing is not an operation any tier may
 * perform on its own — it is a `set` capability the Host grants, revokes, and
 * re-authorizes on every use (RP-9.8).
 *
 * `getRenderSlot` is the one operation whose result is not uniformly
 * cloneable, and the tiers differ in why. Where the slot is a component
 * definition it is executable and stays with the runtime that owns it, so only
 * the request for one crosses. Where the slot names a trusted Base component
 * for the Host to resolve, it is an ordinary code ref and does cross. A tier's
 * adapter answers for its own slot; the name is shared, the shape is not.
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
 * This is the one definition of *this* cascade for every consumer outside
 * Base's own field components, and it mirrors `defaultFieldFormats` in
 * `@cardstack/base/field-component.gts`. A second copy renders nested cards
 * in the wrong format on whichever tier holds it — a divergence invisible in
 * that tier's own tests, since they would agree with its copy.
 *
 * It is the default cascade and nothing more. Three sibling rules narrow the
 * answer afterwards and are not expressible through this signature, which
 * sees neither the field's kind nor the target's definition kind:
 *
 * - RP-2.7: in `edit`, a linked CardDef or FileDef target renders `fitted` —
 *   a linked card is never edited inline — while a linked FieldDef keeps
 *   `edit` (`getChildFormat`, `@cardstack/base/card-api.gts`).
 * - RP-2.5: a computed field never renders `edit`; it is rewritten to
 *   `embedded` at format resolution.
 * - RP-2.4: an explicit `@format` that is in the renderable inventory
 *   **replaces** this answer on both axes rather than narrowing it, and one
 *   outside the inventory is silently ignored rather than treated as an error
 *   (`determineFormats`). Note that an explicit format does not take this
 *   function out of the picture: Base feeds the *effective* format — explicit
 *   or defaulted — straight back through the cascade to seed the children's
 *   ambient defaults, so a tier that skips it under an explicit `@format`
 *   breaks every nested render beneath that node.
 *
 * A tier that applies only this function renders a linked card inline-
 * editable, which RP-2.7 says never happens.
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
      //
      // `head` carries a known gap forward (RP-2.9, carried per RP-17.3):
      // FieldDef declares no `head` slot, so a contained field inside a
      // `head` template resolves to nothing and fails the render. Reproducing
      // it is deliberate — main behaves this way — and a fallback would be a
      // versioned change, not a fix applied here.
      return { fieldDef: containingFormat, cardDef: containingFormat };
    default:
      // isolated, embedded, fitted — and every unrecognized format, which
      // Base degrades the same way.
      return { fieldDef: 'embedded', cardDef: 'fitted' };
  }
}

// Stated as types rather than as `as const` arrays: an exported array reads
// as a vocabulary a gate enforces, and nothing enforces these two. The gate
// that would — a per-record shape check over a `BoxelDescription` — belongs
// with the projection pipeline that produces one.
export type BoxelKind = 'card' | 'field' | 'file';
export type FieldKind = 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';

/**
 * One field a Boxel type declares.
 *
 * Deliberately no `Field` object, no field-class constructor, no serializer,
 * no getter, and no component definition: those stay with the runtime that
 * loaded the type.
 *
 * The member names deliberately avoid `fieldType`. Main's own descriptor
 * (RP-3.6) uses that name for the *kind* string — `contains`, `linksTo` — so
 * reusing it here for the type's code ref would give one name two meanings
 * across two sections of the same spec. `type` is the ref, `kind` is the kind,
 * and neither reads as the other.
 *
 * Configuration is absent here on purpose. Resolution runs with the owning
 * root instance as `this` and memoizes per `(instance, fieldName)`
 * (RP-5.1–5.2), so a description of a *type* has nothing to resolve against.
 * The resolved data belongs to `ResolvedField`, which an instance-aware
 * operation produces.
 */
export type FieldDescription = Cloneable<{
  fieldName: string;
  type: CodeRef;
  kind: FieldKind;
  isComputed: boolean;
}>;

/**
 * One field as an instance actually has it: the type's declaration plus the
 * configuration resolved against the instance that owns it.
 *
 * This is what `getFields`/`getField` answer with. `resolvedConfiguration` is
 * the resolved configuration *data*, never the functions that produced it — a
 * configuration function runs with its semantic owner and only its result
 * crosses (RP-5.4) — and is `null` for a field that configures nothing.
 *
 * The field's *value* is deliberately absent: it lives in the instance
 * projection's `model`, and carrying it twice would let the two disagree.
 */
export type ResolvedField = Cloneable<{
  fieldName: string;
  type: CodeRef;
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
 *
 * `type` is checked as a real `CodeRef`, not merely as an object, because
 * this predicate narrows and its caller resolves that ref through the Store.
 * A structurally plausible ref — `{}`, a `{module}` with no `name`, an
 * `ancestorOf` whose `card` is garbage — would otherwise arrive there
 * carrying the authority of a check that never happened.
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
  return (id === null || typeof id === 'string') && isExactCodeRef(type);
}

/**
 * How deep an `ancestorOf` / `fieldOf` chain may nest before it is refused.
 * Real refs are one or two levels; the bound exists because the value is the
 * far side's to shape.
 */
const MAX_CODE_REF_DEPTH = 16;

/**
 * A code ref carrying its own members and nothing else.
 *
 * Stricter than `isCodeRef`, deliberately. That predicate answers "can this be
 * read as a ref", which is right for a document whose resources may carry
 * more than one reader needs; here the question is whether a value is a
 * reference *instead of* data. A ref admitting extra members lets an entire
 * card ride inside `type` — the expanded graph the marker's own exactness
 * check was written to refuse, one level further down.
 */
function isExactCodeRef(ref: unknown, depth = MAX_CODE_REF_DEPTH): boolean {
  // A predicate whose contract is to answer must not throw instead. The
  // traversal is this function's own, and `isCodeRef` is only ever handed a
  // leaf — it recurses without a bound of its own, so a nested chain would
  // blow the stack inside it before this guard could apply.
  if (depth <= 0 || !isPlainRecord(ref)) {
    return false;
  }
  let keys = Object.keys(ref).sort();
  let { type, card, field } = ref as {
    type?: unknown;
    card?: unknown;
    field?: unknown;
  };
  if (type === 'ancestorOf') {
    return (
      keys.length === 2 &&
      keys[0] === 'card' &&
      keys[1] === 'type' &&
      isExactCodeRef(card, depth - 1)
    );
  }
  if (type === 'fieldOf') {
    return (
      keys.length === 3 &&
      keys[0] === 'card' &&
      keys[1] === 'field' &&
      keys[2] === 'type' &&
      typeof field === 'string' &&
      isExactCodeRef(card, depth - 1)
    );
  }
  // The leaf's own member types are the repo's predicate to judge, not a
  // second opinion written here.
  return (
    keys.length === 2 &&
    keys[0] === 'module' &&
    keys[1] === 'name' &&
    isCodeRef(ref)
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
    presentation: InstancePresentation;
  }
>;

/**
 * What the Host's own chrome needs in order to wrap an instance, derived
 * Host-side and crossed as data.
 *
 * The theme members are why this record exists rather than being read out of
 * `model`. A themed card's stylesheet lives on a *linked* Theme card, which a
 * projection carries only as a reference — resolving it is exactly the graph
 * walk the projection forbids. So the Host resolves the theme once, against
 * the canonical instance, and the three derived strings cross:
 *
 * - `themeScope` is the `data-boxel-theme-scope` token, a content hash of the
 *   theme's id and CSS (RP-11.3), so shared themes emit one stylesheet and
 *   prerendered HTML stays stable across processes.
 * - `themeCss` is the theme's raw custom-property block, from which the
 *   scoped stylesheet compiles.
 * - `cssImports` are the stylesheet imports the theme depends on, typically
 *   font faces.
 *
 * A tier makes the same trusted `CardContainer` invocation main makes from
 * these; without them a themed card renders unthemed, which is not a degraded
 * theme but a different design.
 *
 * `isThemed` is carried rather than derived, because neither `theme` nor
 * `themeCss` implies it. Base answers the question two different ways
 * (`hasTheme`, `field-component.gts`): an ordinary card is themed when it
 * links a Theme, but a Theme card previewing its own CSS is themed when that
 * CSS is non-empty — and such a card links no Theme at all, so `theme` is
 * `null` while the three derived strings are not. Reading `theme !== null` as
 * "themed" renders a Theme card's own preview without the CSS it exists to
 * show; reading `themeCss !== null` gets the converse wrong, since a card
 * linking a Theme whose variables are empty is still themed.
 */
export type InstancePresentation = Cloneable<{
  title: string | null;
  summary: string | null;
  thumbnailURL: string | null;
  isThemed: boolean;
  theme: BoxelValueReference | null;
  themeScope: string | null;
  themeCss: string | null;
  cssImports: string[] | null;
}>;

/**
 * What a name in a captured template resolves to. Every entry is a token the
 * Host redeems against a vocabulary — never the value itself, and never
 * anything executable.
 *
 * A `trusted-export` is a portal token — the module and export name of
 * something the Host owns. Whether that export may be used as a component, a
 * helper, or a modifier is decided where the token is redeemed, against the
 * Host's vocabulary for the position it appears in; a token naming a real
 * export used in the wrong position is refused there rather than invoked.
 * Splitting the token itself by category would require the capture side to
 * classify an export it only holds a reference to.
 *
 * An `authored-component` names another captured template in the same bundle,
 * which goes through capture, validation, and rebuild exactly like the one
 * referencing it.
 *
 * A `literal-value` is the plain data a template closed over: a module-level
 * constant a template interpolates is neither a component nor a Host export,
 * and it crosses as cloned JSON.
 *
 * Three kinds, because scope classification has three outcomes. A vocabulary
 * admitting a fourth that no producer emits would be a kind the Host has no
 * rule to redeem and no rule to refuse it against, which is the wrong default
 * for a boundary.
 *
 * A name that fits none of these kinds — a locally defined function used as a
 * template helper, most often — has no safe category and is refused by name
 * at capture time rather than smuggled across.
 */
export const TEMPLATE_DEPENDENCY_KINDS = [
  'trusted-export',
  'authored-component',
  'literal-value',
] as const;
export type TemplateDependencyKind = (typeof TEMPLATE_DEPENDENCY_KINDS)[number];

export type TemplateDependency = Cloneable<
  | { kind: 'trusted-export'; module: string; name: string }
  // `templateId` keys into the bundle's `templates` map. Not `template`,
  // which reads as the template itself — that is `TemplateDescriptor.block`.
  | { kind: 'authored-component'; templateId: string }
  | { kind: 'literal-value'; value: JSONTypes.Value }
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
 *
 * A dangling reference is that same failure reached by a different route, so
 * it is refused here too: a `root` or an `authored-component` naming a
 * template the bundle does not carry would otherwise reify into a component
 * whose scope resolves to nothing at render time, past every gate.
 */
export function assertKnownTemplateDependencies(
  bundle: TemplateBundle,
  support: ProtocolSupport,
): void {
  assertUsableExecutionRecord(bundle, support);

  let { root, templates } = bundle as Partial<TemplateBundle>;
  if (
    typeof templates !== 'object' ||
    templates === null ||
    Array.isArray(templates)
  ) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `template bundle's templates must be an object keyed by template id, received ${describeValue(templates)}`,
    );
  }
  if (typeof root !== 'string') {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `template bundle's root must be a template id, received ${describeValue(root)}`,
    );
  }

  let unrecognized: string[] = [];
  let dangling: string[] = [];
  // Own keys only. `in` would resolve `root: 'toString'` against
  // Object.prototype and report a template the bundle does not carry.
  let carried = new Set(Object.keys(templates));
  if (!carried.has(root)) {
    dangling.push(`root ${quoteToken(root)}`);
  }
  for (let [key, descriptor] of Object.entries(templates)) {
    if (
      typeof descriptor !== 'object' ||
      descriptor === null ||
      Array.isArray(descriptor) ||
      !Array.isArray(descriptor.scope)
    ) {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `template ${quoteToken(key)} must be a descriptor carrying a scope array, received ${describeValue(descriptor)}`,
      );
    }
    assertReifiableDescriptor(key, descriptor);
    for (let dependency of descriptor.scope) {
      if (
        typeof dependency !== 'object' ||
        dependency === null ||
        typeof (dependency as { kind?: unknown }).kind !== 'string'
      ) {
        throw new ProtocolRefusal(
          'BOXEL_RECORD_MALFORMED',
          `template ${quoteToken(key)} carries a scope entry that is not a dependency, received ${describeValue(dependency)}`,
        );
      }
      if (!templateDependencyKinds.has(dependency.kind)) {
        unrecognized.push(`${quoteToken(key)}: ${quoteToken(dependency.kind)}`);
      } else if (
        !hasReifiableDependencyPayload(dependency as TemplateDependency)
      ) {
        throw new ProtocolRefusal(
          'BOXEL_RECORD_MALFORMED',
          `template ${quoteToken(key)} carries a ${quoteToken(
            dependency.kind,
          )} dependency without the members that kind requires`,
        );
      } else if (
        dependency.kind === 'authored-component' &&
        !carried.has(dependency.templateId)
      ) {
        dangling.push(
          `${quoteToken(key)} references authored component ${quoteToken(
            dependency.templateId,
          )}`,
        );
      }
    }
  }

  if (unrecognized.length > 0) {
    throw new ProtocolRefusal(
      'BOXEL_TEMPLATE_DEPENDENCY_KIND_UNKNOWN',
      `template bundle ${quoteToken(root)} names dependency kinds this consumer does not recognize — ${joinTokens(unrecognized, '; ')}`,
    );
  }
  if (dangling.length > 0) {
    throw new ProtocolRefusal(
      'BOXEL_TEMPLATE_BUNDLE_INCOMPLETE',
      `template bundle ${quoteToken(root)} cannot be reified — ${joinTokens(dangling, '; ')}`,
    );
  }
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && [...value].every((v) => typeof v === 'string');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a dependency carries the members its own kind is redeemed through.
 *
 * The kind allowlist alone establishes almost nothing: a `trusted-export` with
 * no `module` passes it and then fails at resolution, past every gate, which
 * is the class of escape this gate exists to prevent.
 */
function hasReifiableDependencyPayload(
  dependency: TemplateDependency,
): boolean {
  switch (dependency.kind) {
    case 'trusted-export':
      return (
        typeof dependency.module === 'string' &&
        typeof dependency.name === 'string'
      );
    case 'authored-component':
      return typeof dependency.templateId === 'string';
    case 'literal-value':
      // The kind that carries an arbitrary value is the one most worth
      // checking. An own `value` — `in` would accept one inherited from a
      // prototype — that is inert JSON all the way down. A function here
      // survives to the redeemer, where it either fails `structuredClone`
      // with a bare error past every gate, or on a tier that shares a heap
      // and does not clone, reaches authored scope as the live object.
      // Read the descriptor, not the member: `dependency.value` would invoke
      // an accessor, running far-side code inside the gate — and a getter that
      // throws would escape as its own error rather than as a refusal.
      return isJsonDataProperty(dependency, 'value');
  }
}

/**
 * Whether a descriptor carries what a consumer reads when it reifies one.
 *
 * Checked here rather than left to the consumer because `block` is compiled,
 * `stylesheets` is iterated, and `instance` is dereferenced — so a descriptor
 * that is merely shaped like one turns into a compile of arbitrary data, a
 * loop over the characters of a string, or the same bare TypeError this
 * module refuses everywhere else.
 */
function assertReifiableDescriptor(
  key: string,
  descriptor: TemplateDescriptor,
): void {
  let faults: string[] = [];
  // Deliberately NOT `descriptor.id === key`. The map key is the bundle's own
  // reference space and the descriptor's id is the compiler's, and the two are
  // allowed to differ — a class inheriting its template from an ancestor
  // legitimately yields two entries carrying one compiler id. What a consumer
  // needs is that the id is nameable at all, since it names the reified
  // factory.
  if (typeof descriptor.id !== 'string') {
    faults.push(
      `id must be a string, received ${describeValue(descriptor.id)}`,
    );
  }
  if (typeof descriptor.block !== 'string') {
    faults.push(
      `block must be the compiled template, received ${describeValue(descriptor.block)}`,
    );
  }
  if (typeof descriptor.moduleName !== 'string') {
    faults.push(
      `moduleName must be a string, received ${describeValue(descriptor.moduleName)}`,
    );
  }
  if (typeof descriptor.isStrictMode !== 'boolean') {
    faults.push(
      `isStrictMode must be a boolean, received ${describeValue(descriptor.isStrictMode)}`,
    );
  }
  if (!isStringArray(descriptor.stylesheets)) {
    faults.push(
      `stylesheets must be an array of urls, received ${describeValue(descriptor.stylesheets)}`,
    );
  }
  let instance: unknown = descriptor.instance;
  if (!isPlainRecord(instance)) {
    faults.push(
      `instance must be a component descriptor, received ${describeValue(instance)}`,
    );
  } else {
    if (typeof instance.handle !== 'string') {
      faults.push(
        `instance.handle must be a string, received ${describeValue(instance.handle)}`,
      );
    }
    if (!isPlainRecord(instance.state) || !isJsonData(instance.state)) {
      faults.push(
        `instance.state must be a record of data, received ${describeValue(instance.state)}`,
      );
    }
    if (!isStringArray(instance.getters)) {
      faults.push(
        `instance.getters must be an array of names, received ${describeValue(instance.getters)}`,
      );
    }
    if (!isStringArray(instance.actions)) {
      faults.push(
        `instance.actions must be an array of names, received ${describeValue(instance.actions)}`,
      );
    }
  }
  if (faults.length > 0) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `template ${quoteToken(key)} cannot be reified — ${joinTokens(faults, '; ')}`,
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

  let { generation, changed, effects } = update as Partial<ComponentUpdate>;
  // The generation is the guard that stops superseded output being applied, so
  // a generation that cannot be compared defeats it silently.
  if (typeof generation !== 'number' || !Number.isFinite(generation)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `component update's generation must be a finite number, received ${describeValue(generation)}`,
    );
  }
  if (!isPlainRecord(changed) || !isJsonData(changed)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `component update's changed must be a record of data, received ${describeValue(changed)}`,
    );
  }
  if (!Array.isArray(effects)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `component update's effects must be an array, received ${describeValue(effects)}`,
    );
  }
  let unrecognized: string[] = [];
  for (let effect of effects) {
    if (
      typeof effect !== 'object' ||
      effect === null ||
      typeof (effect as { kind?: unknown }).kind !== 'string'
    ) {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `component update carries an entry that is not an effect, received ${describeValue(effect)}`,
      );
    }
    if (!componentEffectKinds.has(effect.kind)) {
      unrecognized.push(effect.kind);
    }
  }
  if (unrecognized.length > 0) {
    throw new ProtocolRefusal(
      'BOXEL_COMPONENT_EFFECT_KIND_UNKNOWN',
      `component update names effect kinds this consumer does not recognize: ${joinTokens(
        unrecognized.map((kind) => quoteToken(kind)),
      )}`,
    );
  }
}

/**
 * How far a `ProjectedError`'s `cause` chain is followed. Bounded because the
 * chain is built from data the far side controls, and an unbounded walk over a
 * cyclic or adversarial chain is a hang rather than a diagnostic.
 */
export const PROJECTED_ERROR_MAX_CAUSE_DEPTH = 8;

type ProjectedErrorShape = {
  name: string;
  message: string;
  stack?: string;
  cause?: ProjectedErrorShape;
};

/**
 * A failure, as data.
 *
 * An `Error` is a class instance and cannot cross a boundary, so a tier that
 * fails projects it into this. The `stack` and the `cause` chain ride along
 * because the error a boundary hands back is usually the wrapper, not the
 * fault: presenting `name`/`message` alone shows "render failed" where the
 * root cause said which getter threw and where.
 */
export type ProjectedError = Cloneable<ProjectedErrorShape>;

/**
 * Projects a thrown value into the cloneable record, following `cause` no
 * further than `PROJECTED_ERROR_MAX_CAUSE_DEPTH`.
 *
 * The bound is what makes the depth limit real rather than advisory. A cause
 * chain is built from data the far side controls and `structuredClone`
 * preserves cycles, so a chain that loops back on itself arrives intact; a
 * consumer walking it without a bound hangs instead of reporting.
 */
/**
 * How much of a projected error's text crosses.
 *
 * Generous enough for a real stack, bounded because the text is chosen by the
 * side that failed, and this record reaches the Host's error presentation.
 */
export const PROJECTED_ERROR_MAX_TEXT_LENGTH = 8192;

function boundText(value: string): string {
  return value.length > PROJECTED_ERROR_MAX_TEXT_LENGTH
    ? `${value.slice(0, PROJECTED_ERROR_MAX_TEXT_LENGTH)}…`
    : value;
}

export function projectError(
  error: unknown,
  depth: number = PROJECTED_ERROR_MAX_CAUSE_DEPTH,
): ProjectedError {
  let source = (
    isPlainRecord(error) ? error : { message: String(error) }
  ) as Partial<{
    name: unknown;
    message: unknown;
    stack: unknown;
    cause: unknown;
  }>;
  let projected: ProjectedErrorShape = {
    name: boundText(typeof source.name === 'string' ? source.name : 'Error'),
    message: boundText(
      typeof source.message === 'string' ? source.message : String(error),
    ),
  };
  if (typeof source.stack === 'string') {
    projected.stack = boundText(source.stack);
  }
  if (source.cause != null && depth > 1) {
    projected.cause = projectError(source.cause, depth - 1);
  }
  return projected;
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

/**
 * The dataset namespaces Base stamps its own identifiers under.
 *
 * In the camelCase form a `DOMStringMap` exposes, not the attribute spelling:
 * `data-boxel-card-id` reads back as `boxelCardId`, and a filter written
 * against the attribute name matches nothing.
 *
 * Both namespaces, because Base stamps a card's canonical URL twice on the
 * same element — `data-boxel-card-id` and `data-test-card` carry the identical
 * `card.id` (`field-component.gts`), and nothing strips the test spelling on
 * the way to a realm. Filtering one and not the other filters nothing.
 *
 * A denylist, and therefore only as complete as this list: a namespace Base
 * adds later leaks until it is named here. It is a denylist rather than an
 * allowlist because the alternative — knowing which keys the author's own
 * template wrote — is not answerable from a `DOMStringMap`, whose element may
 * be Host-rendered chrome the author never wrote.
 */
export const HOST_OWNED_DATASET_PREFIXES = ['boxel', 'test'] as const;

// Anchored on a camelCase boundary, so an author's own `boxelish` or
// `testimonial` key is theirs and survives.
const hostOwnedDatasetKey = new RegExp(
  `^(?:${HOST_OWNED_DATASET_PREFIXES.join('|')})(?:[A-Z]|$)`,
);

function isHostOwnedDatasetKey(key: string): boolean {
  return hostOwnedDatasetKey.test(key);
}

/**
 * The dataset an event target may hand an authored handler.
 *
 * Every other member of `SafeEventTarget` is drawn from a per-member
 * allowlist; a dataset cannot be, since its keys are whatever the author
 * wrote. What makes it safe is subtraction rather than enumeration: Base
 * stamps the Host's own identifiers into these namespaces — `data-boxel-card-id`
 * and `data-test-card` both carry a card's canonical URL (RP-11.4) — and a card
 * is entitled to its own data attributes but not to those.
 *
 * Concretely: an authored template containing `<@fields.vendor />` renders a
 * Base container stamped with the vendor's id. A click landing there bubbles
 * to the author's own handler, and a dataset copied wholesale would hand it
 * the canonical URL of a card the author holds only a reference to.
 *
 * A pure string function, so it lives here with the shape it guards rather
 * than with the projection: it needs no `Event`, no `Element`, and no DOM.
 */
export function projectDataset(
  dataset: Record<string, string>,
): Record<string, string> {
  // Null prototype: a `__proto__` key would otherwise be swallowed by an
  // ordinary object literal, or set the result's prototype outright.
  let projected: Record<string, string> = Object.create(null);
  for (let [key, value] of Object.entries(dataset)) {
    if (!isHostOwnedDatasetKey(key)) {
      projected[key] = value;
    }
  }
  return projected;
}

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
    /**
     * The element's `data-*` attributes, less the ones the Host owns — see
     * `projectDataset`, which is how a projection produces this member.
     */
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
