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
 * 3. **Versioned.** Every record that crosses on its own carries the protocol
 *    version and the features it requires; a consumer checks both before it
 *    applies any part of a record, and fails closed to its last-known-good
 *    output otherwise (RP-14.3). Records that only ever travel inside another
 *    — `ResolvedField` in an operation's result, `ProjectedError` in a
 *    rejection — are versioned by the record or the response carrying them,
 *    and carry no envelope of their own.
 *
 * This module is deliberately absent from `index.ts`: reaching it through the
 * `@cardstack/runtime-common` barrel would drag the barrel's own graph in,
 * which defeats property 1 for the two consumers that need it most. Import it
 * by path — `@cardstack/runtime-common/boxel-execution-protocol`.
 */

import type * as JSONTypes from 'json-typescript';

import { isCodeRef } from './card-document-shape.ts';
import type { CodeRef } from './code-ref.ts';
import type { LooseSingleCardDocument } from './index.ts';
import type { LooseCardResource } from './resource-types.ts';
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
): ProtocolEnvelope {
  return asRefusal(() => gateEnvelope(record, support));
}

function gateEnvelope(
  record: ProtocolEnvelope,
  support: ProtocolSupport,
): ProtocolEnvelope {
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
  return { protocolVersion, requiredFeatures };
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
 * How many values one normalization may visit.
 *
 * Depth alone does not bound the work. `structuredClone` preserves sharing, so
 * a directed acyclic graph arrives as a handful of objects and expands
 * exponentially when walked as a tree — a 27-object payload exhausts memory
 * while sitting comfortably inside the depth limit. The memo below restores
 * the sharing, and this budget bounds what remains.
 */
const MAX_LITERAL_VALUE_NODES = 100_000;

/**
 * Assigns an own data property, whatever it is named.
 *
 * `normalized[key] = value` invokes the `Object.prototype.__proto__` setter
 * for that one key: no own property is created, and the object the consumer
 * receives answers ordinary lookups with producer-chosen values while
 * reporting no keys at all. A legal JSON `__proto__` member would also be
 * silently lost, which `structuredClone` — the contract this module states —
 * does not do.
 */
function defineMember(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Runs a gate so that nothing but a `ProtocolRefusal` can come out of it.
 *
 * Reading through descriptors removes the accessors a gate would otherwise
 * run, but it cannot remove every route: a `Proxy` can throw from its own
 * `getOwnPropertyDescriptor` or `get` trap, and a value can be hostile in ways
 * no enumeration anticipates. A consumer catches one type, so anything else
 * escaping unhandled discards the last-known-good output the refusal exists to
 * protect. This turns "no far-side code runs inside the gate" from an
 * aspiration into an outcome: whatever happens in there leaves as a refusal.
 */
function asRefusal<T>(gate: () => T): T {
  try {
    return gate();
  } catch (error) {
    if (error instanceof ProtocolRefusal) {
      throw error;
    }
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `reading the record raised ${
        error instanceof Error ? quoteToken(error.name) : describeValue(error)
      }`,
    );
  }
}

/**
 * Reads one member of an untrusted record as own data.
 *
 * Plain property access is not available to a gate. It runs an accessor — far
 * side code, inside the gate, free to throw straight past the refusal
 * contract — and it re-reads a member a Proxy may answer differently every
 * time. Every read below goes through here, once per member, and what a gate
 * returns is built from those reads rather than from the object they came
 * out of.
 */
function readMember(source: object, key: string): unknown {
  let descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor === undefined) {
    return undefined;
  }
  if (!('value' in descriptor)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `${quoteToken(key)} is an accessor; a record carries data, not behavior`,
    );
  }
  return descriptor.value;
}

/**
 * Returns `value` as inert JSON data, or refuses.
 *
 * Normalizing rather than inspecting is the whole point. An inspection answers
 * a question about the caller's object and then hands that same object on, so
 * a Proxy, a non-enumerable member, or a symbol-keyed one can differ between
 * the check and the use. What this returns has none of those: every leaf was
 * read once as own data, and the result is a plain graph a consumer can hold.
 */
function normalizeJsonData(
  value: unknown,
  depth = MAX_LITERAL_VALUE_DEPTH,
  budget: { remaining: number } = { remaining: MAX_LITERAL_VALUE_NODES },
  seen: Map<object, JSONTypes.Value> = new Map(),
): JSONTypes.Value {
  if (value === null) {
    return null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    // Every number, `NaN` and the infinities included: the contract this
    // module states is `structuredClone`, which carries them, and refusing
    // them would reject a value the record's own type declares legal.
    return value;
  }
  if (typeof value === 'undefined') {
    // `structuredClone` carries an undefined-valued member, and `Cloneable`
    // admits one, so refusing it here would reject a record the type declares
    // legal — an effect with no payload, or a spread that left a member unset.
    return undefined as unknown as JSONTypes.Value;
  }
  if (typeof value !== 'object') {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `not data: ${describeValue(value)}`,
    );
  }
  if (depth <= 0) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `nested past ${MAX_LITERAL_VALUE_DEPTH} levels`,
    );
  }
  if (--budget.remaining < 0) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `more than ${MAX_LITERAL_VALUE_NODES} values in one record`,
    );
  }
  // Restores the sharing the input had. Without it a shared subgraph is walked
  // once per path that reaches it, which is the exponential blow-up the node
  // budget would otherwise have to absorb.
  let memoized = seen.get(value);
  if (memoized !== undefined) {
    return memoized;
  }
  if (Array.isArray(value)) {
    let entries: JSONTypes.Value[] = [];
    seen.set(value, entries);
    let length = readMember(value, 'length');
    if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `an array's length must be a non-negative integer, received ${describeValue(length)}`,
      );
    }
    for (let index = 0; index < length; index++) {
      entries.push(
        normalizeJsonData(
          readMember(value, String(index)),
          depth - 1,
          budget,
          seen,
        ),
      );
    }
    return entries;
  }
  let prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      'a value with a prototype of its own is an object, not data',
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      'a value carrying symbol-keyed members is not data',
    );
  }
  let normalized: Record<string, JSONTypes.Value> = {};
  seen.set(value, normalized);
  // getOwnPropertyNames, not keys: a non-enumerable member is still reachable
  // by whoever holds the object, so skipping it proves nothing about what a
  // consumer would be handed.
  for (let key of Object.getOwnPropertyNames(value)) {
    defineMember(
      normalized,
      key,
      normalizeJsonData(readMember(value, key), depth - 1, budget, seen),
    );
  }
  return normalized;
}

function normalizeJsonRecord(
  value: unknown,
  label: string,
): Record<string, JSONTypes.Value> {
  let normalized = normalizeJsonData(value);
  if (
    typeof normalized !== 'object' ||
    normalized === null ||
    Array.isArray(normalized)
  ) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `${label} must be a record of data, received ${describeValue(value)}`,
    );
  }
  return normalized;
}

function normalizeStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `${label} must be an array, received ${describeValue(value)}`,
    );
  }
  let entries: string[] = [];
  let length = readMember(value, 'length');
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `${label} must have a non-negative integer length, received ${describeValue(length)}`,
    );
  }
  for (let index = 0; index < length; index++) {
    let entry = readMember(value, String(index));
    if (typeof entry !== 'string') {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `${label} must hold strings, received ${describeValue(entry)}`,
      );
    }
    entries.push(entry);
  }
  return entries;
}

function normalizeString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `${label} must be a string, received ${describeValue(value)}`,
    );
  }
  return value;
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
  let protocolVersion = readMember(candidate, 'protocolVersion');
  let requiredFeatures = readMember(candidate, 'requiredFeatures');
  if (
    typeof protocolVersion !== 'number' ||
    !Number.isFinite(protocolVersion)
  ) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `protocolVersion must be a finite number, received ${describeValue(protocolVersion)}`,
    );
  }
  // Index-by-index rather than `some`/`every`, which skip the holes in a
  // sparse array — `[, ,]` would otherwise pass as "an array of strings" and
  // be carried as two features named `undefined`.
  return {
    protocolVersion,
    requiredFeatures: normalizeStringArray(
      requiredFeatures,
      'requiredFeatures',
    ),
  };
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
 * A runtime-local identity for an object that never leaves its runtime.
 *
 * The handle is a string, so it is cloneable and crosses freely; what it names
 * — a loaded class, a materialized instance — does not.
 *
 * A handle is an identifier, NOT a capability, and the distinction is the
 * issuing runtime's to enforce. Nothing about the type makes a handle
 * unguessable or scopes it to the consumer it was issued to; a registry that
 * mints sequential ids and resolves any handle for any caller satisfies this
 * type completely. A channel that accepts a handle from across a boundary
 * must therefore check that the peer sending it was the peer it was issued
 * to — holding a well-formed handle is not evidence of anything.
 */
declare const runtimeHandleBrand: unique symbol;
declare const boxelTypeHandleBrand: unique symbol;
declare const boxelInstanceHandleBrand: unique symbol;

export type RuntimeHandle = string & {
  readonly [runtimeHandleBrand]: true;
};
export type BoxelTypeHandle = RuntimeHandle & {
  readonly [boxelTypeHandleBrand]: true;
};
export type BoxelInstanceHandle = RuntimeHandle & {
  readonly [boxelInstanceHandleBrand]: true;
};

export const BOXEL_EXECUTION_MODES = ['direct', 'capsule', 'sandbox'] as const;
export type BoxelExecutionMode = (typeof BOXEL_EXECUTION_MODES)[number];

/**
 * What every tier's runtime offers, and nothing else (RP-14.2).
 *
 * Every argument and every result here is a handle, a record this module
 * proves cloneable, or a JSON:API document — which is what makes one interface
 * serve a local call, a call into a Compartment, and a call across a message
 * port without changing shape.
 *
 * The documents are the exception worth naming: `LooseCardResource` and
 * `LooseSingleCardDocument` do NOT satisfy `Cloneable`, and cannot be made to
 * — their `Meta` and `Relationship` members are index-signature-less
 * interfaces, and their attribute bags are `any`. They are cloneable in
 * practice because the wire format they describe is JSON, but that is a
 * property of the format rather than something proved here.
 *
 * Three things are deliberately absent:
 *
 * - **Mutation.** Writing is not an operation a tier may perform on its own;
 *   it is a `set` capability the Host grants, revokes, and re-authorizes on
 *   every use (RP-9.8).
 * - **Rendering.** Producing a mountable component is process-local and its
 *   result is not cloneable, so it cannot be a member of a tier-neutral
 *   interface. A tier's adapter offers its own render entry point beside this
 *   interface; what crosses is the projection, not the component.
 * - **Invoking an authored action.** An action belongs to a component
 *   instance, so it is the component runtime's to invoke — the result crosses
 *   back as a `ComponentUpdate`.
 *
 * The set is closed in the sense that matters: a tier needing a *cross-
 * boundary* behavior these cannot express is a spec change. A tier-local
 * capability its own Host code calls directly — source volatility, instance
 * sync — is not an operation on this interface and does not belong here.
 */
export interface BoxelRuntime {
  readonly mode: BoxelExecutionMode;

  loadBoxel(ref: CodeRef): Promise<BoxelTypeHandle>;

  createFromSerialized(
    resource: LooseCardResource,
    document: LooseSingleCardDocument,
    relativeTo: RealmResourceIdentifier | undefined,
    purpose: MaterializationPurpose,
  ): Promise<BoxelInstanceHandle>;

  describeBoxel(boxel: BoxelTypeHandle): Promise<BoxelDescription>;

  getFields(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
  ): Promise<ResolvedField[]>;

  getField(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
    fieldName: string,
  ): Promise<ResolvedField | undefined>;

  projectInstance(instance: BoxelInstanceHandle): Promise<InstanceProjection>;

  serializeCard(
    instance: BoxelInstanceHandle,
  ): Promise<LooseSingleCardDocument>;

  dispose(handle: RuntimeHandle): Promise<void>;
}

export const BOXEL_RUNTIME_OPERATIONS = [
  'loadBoxel',
  'createFromSerialized',
  'describeBoxel',
  'getFields',
  'getField',
  'projectInstance',
  'serializeCard',
  'dispose',
] as const;
export type BoxelRuntimeOperation = (typeof BOXEL_RUNTIME_OPERATIONS)[number];

/**
 * The list above and the interface name the same operations, proved rather
 * than maintained. `Exact` resolves to its first argument, so this costs
 * nothing; instantiating it in both directions means a method added to
 * `BoxelRuntime` without a list entry, or a list entry naming no method,
 * fails to compile here.
 *
 * Without it the two drift silently, and a transport that dispatches by name
 * off the list stops offering an operation the interface promises.
 */
type Exact<A extends B, B> = A;
export type BoxelRuntimeOperationsAreExact = Exact<
  BoxelRuntimeOperation,
  Exclude<keyof BoxelRuntime, 'mode'>
> &
  Exact<Exclude<keyof BoxelRuntime, 'mode'>, BoxelRuntimeOperation>;

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
 *   a linked card is never edited inline — while a singular linked FieldDef
 *   keeps `edit` (`getChildFormat`, `@cardstack/base/card-api.gts`). A
 *   `linksToMany` editor is different again: it renders FieldDef elements as
 *   `atom` pills and card elements as a `fitted` sortable list
 *   (`getEditorChildFormat`, `@cardstack/base/links-to-many-component.gts`),
 *   so a tier applying only the singular rule renders a stack of full field
 *   editors where main shows pills.
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
  try {
    if (!isPlainRecord(value) || !hasExactOwnKeys(value, ['$boxel'])) {
      return false;
    }
    let marker = readMember(value, '$boxel');
    if (!isPlainRecord(marker) || !hasExactOwnKeys(marker, ['id', 'type'])) {
      return false;
    }
    let id = readMember(marker, 'id');
    return (
      (id === null || typeof id === 'string') &&
      isExactCodeRef(readMember(marker, 'type'))
    );
  } catch {
    // A predicate whose contract is to answer must not throw instead: a
    // marker built from a throwing accessor is simply not a reference.
    return false;
  }
}

/**
 * Whether an object's own property names are exactly `expected` — enumerable
 * or not.
 *
 * `Object.keys` would skip a non-enumerable member, and a member the check
 * skipped is still reachable by whoever holds the object. That is how an
 * entire card rides inside a value that answers "reference".
 */
function hasExactOwnKeys(source: object, expected: string[]): boolean {
  let names = Object.getOwnPropertyNames(source);
  if (names.length !== expected.length) {
    return false;
  }
  let sorted = [...names].sort();
  let wanted = [...expected].sort();
  return (
    sorted.every((name, index) => name === wanted[index]) &&
    Object.getOwnPropertySymbols(source).length === 0
  );
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
  // A ref inheriting a discriminator reads as one form here and another at
  // the Store, so the prototype is part of the shape.
  let prototype = Object.getPrototypeOf(ref);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  let type = readMember(ref, 'type');
  if (type === 'ancestorOf') {
    return (
      hasExactOwnKeys(ref, ['card', 'type']) &&
      isExactCodeRef(readMember(ref, 'card'), depth - 1)
    );
  }
  if (type === 'fieldOf') {
    return (
      hasExactOwnKeys(ref, ['card', 'field', 'type']) &&
      typeof readMember(ref, 'field') === 'string' &&
      isExactCodeRef(readMember(ref, 'card'), depth - 1)
    );
  }
  // The leaf's own member types are the repo's predicate to judge, not a
  // second opinion written here.
  return hasExactOwnKeys(ref, ['module', 'name']) && isCodeRef(ref);
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
 * The gate a consumer passes before it reifies any part of a bundle, and the
 * only bundle it may then reify.
 *
 * It returns a normalized bundle rather than approving the caller's. A gate
 * that validates in place answers a question about the adversary's object and
 * then hands that same object on, so every member it checked can differ by the
 * time the consumer reads it — a Proxy re-answers, an accessor runs again, a
 * non-enumerable member appears. Everything here is read once as own data and
 * rebuilt; what comes back is a plain graph whose members are what they were
 * checked to be.
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
export function acceptTemplateBundle(
  bundle: TemplateBundle,
  support: ProtocolSupport,
): TemplateBundle {
  return asRefusal(() => gateTemplateBundle(bundle, support));
}

function gateTemplateBundle(
  bundle: TemplateBundle,
  support: ProtocolSupport,
): TemplateBundle {
  let envelope = assertUsableExecutionRecord(bundle, support);

  let root = normalizeString(readMember(bundle, 'root'), "a bundle's root");
  let templates = readMember(bundle, 'templates');
  if (!isPlainRecord(templates)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `a bundle's templates must be an object keyed by template id, received ${describeValue(templates)}`,
    );
  }

  let unrecognized: string[] = [];
  let dangling: string[] = [];
  // Own names only. `in` would resolve `root: 'toString'` against
  // Object.prototype and report a template the bundle does not carry.
  let keys = Object.getOwnPropertyNames(templates);
  let carried = new Set(keys);
  if (!carried.has(root)) {
    dangling.push(`root ${quoteToken(root)}`);
  }

  let normalized: Record<string, TemplateDescriptor> = {};
  for (let key of keys) {
    let descriptor = readMember(templates, key);
    if (!isPlainRecord(descriptor)) {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `template ${quoteToken(key)} must be a descriptor, received ${describeValue(descriptor)}`,
      );
    }
    let scope = readMember(descriptor, 'scope');
    if (!Array.isArray(scope)) {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `template ${quoteToken(key)} must carry a scope array, received ${describeValue(scope)}`,
      );
    }

    let dependencies: TemplateDependency[] = [];
    let scopeLength = readMember(scope, 'length');
    if (typeof scopeLength !== 'number' || !Number.isInteger(scopeLength)) {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `template ${quoteToken(key)}'s scope must have an integer length, received ${describeValue(scopeLength)}`,
      );
    }
    for (let index = 0; index < scopeLength; index++) {
      let entry = readMember(scope, String(index));
      if (!isPlainRecord(entry)) {
        throw new ProtocolRefusal(
          'BOXEL_RECORD_MALFORMED',
          `template ${quoteToken(key)} carries a scope entry that is not a dependency, received ${describeValue(entry)}`,
        );
      }
      // Read once. A kind read a second time is a kind a Proxy may answer
      // differently, so the gate would bless one and the consumer redeem
      // another.
      let kind = readMember(entry, 'kind');
      if (typeof kind !== 'string') {
        throw new ProtocolRefusal(
          'BOXEL_RECORD_MALFORMED',
          `template ${quoteToken(key)} carries a dependency with no kind, received ${describeValue(kind)}`,
        );
      }
      if (!templateDependencyKinds.has(kind)) {
        unrecognized.push(`${quoteToken(key)}: ${quoteToken(kind)}`);
        continue;
      }
      let dependency = normalizeDependency(
        key,
        kind as TemplateDependencyKind,
        entry,
      );
      if (
        dependency.kind === 'authored-component' &&
        !carried.has(dependency.templateId)
      ) {
        dangling.push(
          `${quoteToken(key)} references authored component ${quoteToken(dependency.templateId)}`,
        );
      }
      dependencies.push(dependency);
    }

    normalized[key] = normalizeDescriptor(key, descriptor, dependencies);
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

  return { ...envelope, root, templates: normalized };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rebuilds a dependency from own-data reads, refusing one that lacks the
 * members its own kind is redeemed through.
 *
 * The kind allowlist alone establishes almost nothing: a `trusted-export`
 * with no `module` passes it and then fails at resolution, past every gate,
 * which is the class of escape this gate exists to prevent.
 */
function normalizeDependency(
  templateKey: string,
  kind: TemplateDependencyKind,
  entry: Record<string, unknown>,
): TemplateDependency {
  let member = (name: string) => {
    let value = readMember(entry, name);
    if (typeof value !== 'string') {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `template ${quoteToken(templateKey)} carries a ${quoteToken(kind)} dependency whose ${name} is ${describeValue(value)}`,
      );
    }
    return value;
  };
  switch (kind) {
    case 'trusted-export':
      return {
        kind,
        module: member('module'),
        name: member('name'),
      };
    case 'authored-component':
      return { kind, templateId: member('templateId') };
    case 'literal-value':
      // The kind that carries an arbitrary value is the one most worth
      // checking. `readMember` refuses an accessor rather than running it,
      // and `normalizeJsonData` refuses anything that is not data — a
      // function here would otherwise survive to the redeemer, failing
      // `structuredClone` with a bare error past every gate, or on a tier
      // that shares a heap and does not clone, reaching authored scope as
      // the live object.
      return { kind, value: normalizeJsonData(readMember(entry, 'value')) };
  }
}

/**
 * Rebuilds a descriptor from own-data reads, refusing one a consumer could
 * not reify.
 *
 * Checked here rather than left to the consumer because `block` is compiled,
 * `stylesheets` is iterated, and `instance` is dereferenced — so a descriptor
 * that is merely shaped like one turns into a compile of arbitrary data, a
 * loop over the characters of a string, or the same bare TypeError this
 * module refuses everywhere else.
 */
function normalizeDescriptor(
  key: string,
  descriptor: Record<string, unknown>,
  scope: TemplateDependency[],
): TemplateDescriptor {
  let where = (name: string) => `template ${quoteToken(key)}'s ${name}`;
  // Deliberately NOT `descriptor.id === key`. The map key is the bundle's own
  // reference space and the descriptor's id is the compiler's, and the two are
  // allowed to differ — a class inheriting its template from an ancestor
  // legitimately yields two entries carrying one compiler id. What a consumer
  // needs is that the id is nameable at all, since it names the reified
  // factory.
  let id = normalizeString(readMember(descriptor, 'id'), where('id'));
  let block = normalizeString(readMember(descriptor, 'block'), where('block'));
  let moduleName = normalizeString(
    readMember(descriptor, 'moduleName'),
    where('moduleName'),
  );
  let isStrictMode = readMember(descriptor, 'isStrictMode');
  if (typeof isStrictMode !== 'boolean') {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `${where('isStrictMode')} must be a boolean, received ${describeValue(isStrictMode)}`,
    );
  }
  let stylesheets = normalizeStringArray(
    readMember(descriptor, 'stylesheets'),
    where('stylesheets'),
  );

  let instance = readMember(descriptor, 'instance');
  if (!isPlainRecord(instance)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `${where('instance')} must be a component descriptor, received ${describeValue(instance)}`,
    );
  }
  return {
    id,
    block,
    moduleName,
    isStrictMode,
    stylesheets,
    scope,
    instance: {
      handle: normalizeString(
        readMember(instance, 'handle'),
        where('instance.handle'),
      ),
      // The state a Capsule installs into authored scope, so it is data on
      // the same terms as a literal value.
      state: normalizeJsonRecord(
        readMember(instance, 'state'),
        where('instance.state'),
      ),
      getters: normalizeStringArray(
        readMember(instance, 'getters'),
        where('instance.getters'),
      ),
      actions: normalizeStringArray(
        readMember(instance, 'actions'),
        where('instance.actions'),
      ),
    },
  };
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
  /**
   * Optional, because not every capability takes an argument — `observe` is a
   * request with nothing to say beyond its own name.
   */
  payload?: JSONTypes.Value;
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
 * effects, and the only update it may then apply.
 *
 * Normalized and returned for the same reason as a bundle: what a consumer
 * applies has to be what was checked, not an object that merely answered the
 * check that way once.
 *
 * An unrecognized effect kind rejects the whole update, changed state
 * included: applying the state while dropping the request that was supposed to
 * accompany it is how a surface ends up showing a half-performed intent.
 */
export function acceptComponentUpdate(
  update: ComponentUpdate,
  support: ProtocolSupport,
): ComponentUpdate {
  return asRefusal(() => gateComponentUpdate(update, support));
}

function gateComponentUpdate(
  update: ComponentUpdate,
  support: ProtocolSupport,
): ComponentUpdate {
  let envelope = assertUsableExecutionRecord(update, support);

  // The generation is the guard that stops superseded output being applied,
  // so a generation that cannot be compared defeats it silently.
  let generation = readMember(update, 'generation');
  if (typeof generation !== 'number' || !Number.isFinite(generation)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `an update's generation must be a finite number, received ${describeValue(generation)}`,
    );
  }
  let changed = normalizeJsonRecord(
    readMember(update, 'changed'),
    "an update's changed",
  );

  let effects = readMember(update, 'effects');
  if (!Array.isArray(effects)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `an update's effects must be an array, received ${describeValue(effects)}`,
    );
  }
  let unrecognized: string[] = [];
  let normalized: ComponentEffect[] = [];
  let effectsLength = readMember(effects, 'length');
  if (typeof effectsLength !== 'number' || !Number.isInteger(effectsLength)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `an update's effects must have an integer length, received ${describeValue(effectsLength)}`,
    );
  }
  for (let index = 0; index < effectsLength; index++) {
    let entry = readMember(effects, String(index));
    if (!isPlainRecord(entry)) {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `an update carries an entry that is not an effect, received ${describeValue(entry)}`,
      );
    }
    let kind = readMember(entry, 'kind');
    if (typeof kind !== 'string') {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `an effect carries no kind, received ${describeValue(kind)}`,
      );
    }
    if (!componentEffectKinds.has(kind)) {
      unrecognized.push(quoteToken(kind));
      continue;
    }
    // A payload is the same kind of thing as a literal value — arbitrary,
    // author-chosen, and handed onward — so it is normalized on the same
    // terms rather than passed through because its shape is open.
    normalized.push({
      kind: kind as ComponentEffectKind,
      payload: normalizeJsonData(readMember(entry, 'payload')),
    });
  }
  if (unrecognized.length > 0) {
    throw new ProtocolRefusal(
      'BOXEL_COMPONENT_EFFECT_KIND_UNKNOWN',
      `an update names effect kinds this consumer does not recognize: ${joinTokens(unrecognized)}`,
    );
  }

  return { ...envelope, generation, changed, effects: normalized };
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
  /**
   * A `ProtocolRefusal`'s code, when the failure was one. The code is the
   * whole point of naming a refusal — the identity a catalog, a log query or
   * a test keys on — and without a member of its own it survives a crossing
   * only as a prefix of `message`, recoverable by string-parsing.
   */
  code?: string;
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

/**
 * Projects a thrown value into the cloneable record, following `cause` no
 * further than `PROJECTED_ERROR_MAX_CAUSE_DEPTH`.
 *
 * The bound is what makes the depth limit real rather than advisory: a cause
 * chain is built from data the far side controls and `structuredClone`
 * preserves cycles, so a chain that loops back on itself arrives intact and a
 * consumer walking it without a bound hangs instead of reporting.
 */
export function projectError(
  error: unknown,
  depth: number = PROJECTED_ERROR_MAX_CAUSE_DEPTH,
): ProjectedError {
  // Clamped, not trusted: an exported depth a caller may raise is not a bound.
  depth = Math.min(depth, PROJECTED_ERROR_MAX_CAUSE_DEPTH);
  // Never throws. Projection IS the clone step for a thrown value, so unlike
  // a record arriving over a port nothing has sanitized this yet — and
  // authored code can throw anything, including an object whose every member
  // is a getter that throws. A projector that fails here turns "render
  // failed" into a lane with no response on it, which its peer can only
  // discover by timing out.
  //
  // This is the one place the module reads THROUGH accessors rather than
  // refusing them, and it has to: on a real `Error`, `stack` is an own
  // accessor and `name` is inherited from the prototype, so a descriptor-only
  // read returns neither — projecting every `TypeError` as a nameless,
  // stackless `Error` and defeating the record's whole reason for carrying
  // them. Reading is guarded instead; a throwing member simply goes missing.
  let read = (key: string): unknown => {
    if (typeof error !== 'object' || error === null) {
      return undefined;
    }
    try {
      return (error as Record<string, unknown>)[key];
    } catch {
      return undefined;
    }
  };
  // Deliberately not `String(error)`, which dispatches to the producer's own
  // `toString`/`Symbol.toPrimitive`. A `try/catch` would contain a throw from
  // there but not a spin or a 200MB return, and either of those is the very
  // no-response-on-the-lane outcome this function exists to prevent.
  let describe = (): string => `a thrown ${typeof error}`;

  let name = read('name');
  let message = read('message');
  let stack = read('stack');
  let cause = read('cause');

  let projected: ProjectedErrorShape = {
    name: boundText(typeof name === 'string' ? name : 'Error'),
    message: boundText(typeof message === 'string' ? message : describe()),
  };
  let code = read('code');
  if (typeof code === 'string') {
    projected.code = boundText(code);
  }
  if (typeof stack === 'string') {
    projected.stack = boundText(stack);
  }
  if (cause != null && depth > 1) {
    projected.cause = projectError(cause, depth - 1);
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
 * Converts authored attribute names into the keys a `DOMStringMap` exposes.
 *
 * A template's wire data holds what the author wrote — `data-row-index` — and
 * `element.dataset` answers to `rowIndex`. Without the conversion an allowlist
 * built from the template matches nothing and silently drops every one of the
 * author's own attributes, which fails closed but looks like data loss.
 * Non-`data-` attributes are ignored, so a whole attribute list can be passed.
 *
 * Pure string work, so it lives beside the allowlist it feeds rather than in
 * the adapter that will call it.
 */
export function datasetKeysFor(attributeNames: Iterable<string>): string[] {
  let keys: string[] = [];
  for (let name of attributeNames) {
    if (!name.startsWith('data-')) {
      continue;
    }
    keys.push(
      name
        .slice('data-'.length)
        .replace(/-([a-z0-9])/g, (_, character: string) =>
          character.toUpperCase(),
        ),
    );
  }
  return keys;
}

/**
 * The dataset an event target may hand an authored handler: the author's own
 * `data-*` attributes, and nothing else.
 *
 * An allowlist, supplied by the caller, because a denylist cannot work here.
 * Base stamps identity into this namespace under several unrelated spellings
 * — `data-boxel-card-id`, `data-test-card` and `data-cards-grid-item` each
 * carry a card's canonical URL, the last one specifically because the
 * `data-test-` spelling is pruned in production — across hundreds of `data-*`
 * attributes in many first-segment namespaces. Every list of "the Host's
 * prefixes" is a list that is one Base commit from being wrong, and being
 * wrong means an authored handler is handed the identity of a card it holds
 * only a reference to.
 *
 * The element an event lands on is frequently Host chrome the author never
 * wrote, so the question is not what the key is called but who wrote it. Only
 * the caller knows: a rebuilt template's own wire data names the attributes
 * its author declared. Pass those; everything else stays behind.
 *
 * A pure string function, so it lives here with the shape it guards rather
 * than with the projection: it needs no `Event`, no `Element`, and no DOM.
 */
export function projectDataset(
  dataset: Record<string, string | undefined>,
  authoredKeys: Iterable<string>,
): Record<string, string> {
  let authored = new Set(authoredKeys);
  // Null prototype: a `__proto__` key would otherwise be swallowed by an
  // ordinary object literal, or set the result's prototype outright.
  let projected: Record<string, string> = Object.create(null);
  for (let key of Object.getOwnPropertyNames(dataset)) {
    if (authored.has(key)) {
      let value = readMember(dataset, key);
      if (typeof value === 'string') {
        projected[key] = value;
      }
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
     * The `data-*` attributes the card's own author wrote — see
     * `projectDataset`, which is how a projection produces this member, and
     * why it takes the author's key set rather than guessing at the Host's.
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
