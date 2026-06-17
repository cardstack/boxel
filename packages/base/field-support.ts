import {
  getField,
  isBaseInstance,
  isCardInstance,
  isFieldInstance,
  localId,
  primitive,
  type SerializedError,
} from '@cardstack/runtime-common';
import type {
  BaseDef,
  BaseDefConstructor,
  BaseInstanceType,
  CardDef,
  Field,
  FieldDef,
} from './card-api';
import {
  getCardMeta,
  type JSONAPIResource,
  type JSONAPISingleResourceDocument,
  type SerializeOpts,
} from './card-serialization';
import { initSharedState } from './shared-state';
import { rawArrayValues } from './watched-array';
import { flatMap } from 'lodash';
import { TrackedMap, TrackedWeakMap } from 'tracked-built-ins';
import type { ConfigurationInput, FieldConfiguration } from './card-api';

export interface NotLoadedValue {
  type: 'not-loaded';
  reference: string;
}

export interface LinkErrorValue {
  type: 'link-error';
  reference: string;
  errorDoc: SerializedError;
}

export interface LinkNotFoundValue {
  type: 'link-not-found';
  reference: string;
  errorDoc: SerializedError;
}

export type LinkSentinel = NotLoadedValue | LinkErrorValue | LinkNotFoundValue;

export const realmContext = Symbol.for('cardstack-realm-context');

// our place for notifying Glimmer when a card is ready to re-render
const cardTracking = initSharedState(
  'cardTracking',
  () => new TrackedWeakMap<object, any>(),
);
const deserializedData = initSharedState(
  'deserializedData',
  () => new WeakMap<BaseDef, Map<string, any>>(),
);
// Cache for resolved field configurations per instance/field
const fieldConfigurationCache = initSharedState(
  'fieldConfigurationCache',
  () => new WeakMap<BaseDef, Map<string, FieldConfiguration | undefined>>(),
);
const fieldDescriptions = initSharedState(
  'fieldDescriptions',
  () => new WeakMap<typeof BaseDef, Map<string, string>>(),
);
const fieldOverrides = initSharedState(
  'fieldOverrides',
  () => new WeakMap<BaseDef, Map<string, any>>(),
);

// A tracked, observe-only invalidation signal per (instance, field). It carries
// no truth of its own — `getRelationshipMembershipState(...).isLoading` reads it only to
// entangle, and consults the real in-flight state (in-flight link loads / the
// search resource's running flag) separately. `lazilyLoadLink` and the query
// search lifecycle bump it when a load starts / settles, so a bound spinner
// re-renders; because only `getRelationshipMembershipState` consumers read it, the bump
// re-renders just those spinners, not every holder of the field.
const fieldLoadingSignal = initSharedState(
  'fieldLoadingSignal',
  () => new TrackedWeakMap<BaseDef, TrackedMap<string, number>>(),
);

// Entangle the caller's render with a field's loading signal (read-only).
export function readFieldLoadingSignal(
  instance: BaseDef,
  fieldName: string,
): void {
  fieldLoadingSignal.get(instance)?.get(fieldName);
}

// Invalidate a field's loading signal so `getRelationshipMembershipState` re-evaluates. The
// write is deferred a microtask: the load that triggers it starts inside the
// field getter mid-render, and a synchronous tracked write would backtrack a
// `getRelationshipMembershipState` read from the same render. A monotonic version counter (not
// a refcount) keeps it a pure invalidation trigger.
export function bumpFieldLoadingSignal(
  instance: BaseDef,
  fieldName: string,
): void {
  Promise.resolve().then(() => {
    let counts = fieldLoadingSignal.get(instance);
    if (!counts) {
      counts = new TrackedMap<string, number>();
      fieldLoadingSignal.set(instance, counts);
    }
    counts.set(fieldName, (counts.get(fieldName) ?? 0) + 1);
  });
}

// Pass-scoped computed-field memo. When non-null, `getter` consults a
// per-instance Map before invoking `computeVia` and stores the result for
// the duration of the synchronous traversal that opened the pass (see
// `beginComputePass`). Off-pass reads pay only a single null check on this
// module local and follow the original path — the JIT branch-predicts the
// off-pass case in the host-UI hot loop.
let passComputeMemo: WeakMap<BaseDef, Map<string, any>> | null = null;
// Counters snapshotted by the render/meta route to populate
// `boxel_index.diagnostics`. They are unconditional integer
// increments inside `getter` — cheap enough to keep on in production, but
// only meaningful between `beginComputePass`/`endComputePass`.
let computedCallCount = 0;
let computedCacheHitCount = 0;

export interface ComputePassSnapshot {
  calls: number;
  cacheHits: number;
}

// Open a synchronous compute-memo pass. Callers MUST pair this with
// `endComputePass()` and must not await between the two — the WeakMap
// would otherwise be observable across reactive cycles. Intended for
// pure traversals like `serializeCard` + `searchDoc` inside one
// `render.meta` capture.
export function beginComputePass(): void {
  passComputeMemo = new WeakMap();
  computedCallCount = 0;
  computedCacheHitCount = 0;
}

// Close the pass and return the per-traversal counter delta. The memo
// is dropped so subsequent `getter` calls run `computeVia` fresh.
export function endComputePass(): ComputePassSnapshot {
  passComputeMemo = null;
  let snapshot = {
    calls: computedCallCount,
    cacheHits: computedCacheHitCount,
  };
  computedCallCount = 0;
  computedCacheHitCount = 0;
  return snapshot;
}

export function getter<CardT extends BaseDefConstructor>(
  instance: BaseDef,
  field: Field<CardT>,
): BaseInstanceType<CardT> {
  let deserialized = getDataBucket(instance);
  // this establishes that our field should rerender when cardTracking for this card changes
  cardTracking.get(instance);

  if (field.computeVia) {
    // Fast path when no pass is open: skip the counter + memo entirely
    // so production reads pay only one branch on the module-local null
    // check. JIT branch-predicts this and the original behaviour is
    // unchanged.
    if (passComputeMemo === null) {
      let value = field.computeVia.bind(instance)();
      if (value === undefined) {
        value = field.emptyValue(instance);
      }
      return value as BaseInstanceType<CardT>;
    }
    let perInstance = passComputeMemo.get(instance);
    if (perInstance && perInstance.has(field.name)) {
      computedCacheHitCount++;
      return perInstance.get(field.name);
    }
    computedCallCount++;
    let value = field.computeVia.bind(instance)();
    if (value === undefined) {
      value = field.emptyValue(instance);
    }
    if (!perInstance) {
      perInstance = new Map();
      passComputeMemo.set(instance, perInstance);
    }
    perInstance.set(field.name, value);
    return value as BaseInstanceType<CardT>;
  } else {
    if (deserialized.has(field.name)) {
      return deserialized.get(field.name);
    }
    let value = field.emptyValue(instance);
    deserialized.set(field.name, value);
    return value;
  }
}

export function entangleWithCardTracking(instance: BaseDef) {
  cardTracking.get(instance);
}

export function notifyCardTracking(instance: BaseDef) {
  cardTracking.set(instance, true);
  // Invalidate cached field configuration for this instance so it recomputes on next access
  fieldConfigurationCache.delete(instance);
}

export function getDataBucket<T extends BaseDef>(
  instance: T,
): Map<string, any> {
  let deserialized = deserializedData.get(instance);
  if (!deserialized) {
    deserialized = new Map();
    deserializedData.set(instance, deserialized);
  }
  return deserialized;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// One-level shallow merge with array replacement semantics; undefined keys do not overwrite
export function shallowMerge<T extends Record<string, any>>(
  a?: T,
  b?: T,
): T | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  let out: Record<string, any> = { ...a };
  for (let [k, v] of Object.entries(b)) {
    if (v === undefined) continue; // ignore undefined values
    if (isObject(v) && isObject(out[k])) {
      out[k] = { ...(out[k] as Record<string, unknown>), ...v };
    } else {
      out[k] = v; // replace (includes null and arrays)
    }
  }
  return out as T;
}

export function mergeConfigurations<T extends object>(
  ...fragments: (T | undefined)[]
): T | undefined {
  return fragments.reduce<T | undefined>(
    (acc, next) => shallowMerge(acc as any, next as any) as any,
    undefined,
  );
}

// Resolves and merges configuration from FieldDef static configuration and per-usage configuration
// Handles NotLoaded by treating the fragment as undefined for this render and relying on re-render later
export function resolveFieldConfiguration(
  field: Field,
  instance: BaseDef,
): FieldConfiguration | undefined {
  // ensure reactive recomputation
  entangleWithCardTracking(instance);

  let cacheForInstance = fieldConfigurationCache.get(instance);
  if (!cacheForInstance) {
    cacheForInstance = new Map();
    fieldConfigurationCache.set(instance, cacheForInstance);
  }
  let cached = cacheForInstance.get(field.name);
  if (cached !== undefined) {
    return cached;
  }

  function evalInput<T>(
    input: ConfigurationInput<T> | undefined,
  ): FieldConfiguration | undefined {
    if (!input) return undefined;
    if (typeof input === 'function') {
      return (
        input as (this: Readonly<T>) => FieldConfiguration | undefined
      ).call(instance as unknown as T);
    } else {
      return input as FieldConfiguration;
    }
  }

  // field.card is the FieldDef subclass; it may optionally define a static configuration
  let fromFieldDef = evalInput(
    (field.card as any).configuration as ConfigurationInput<any> | undefined,
  );
  // per-usage configuration stored on the field descriptor
  let fromFieldUsage = evalInput(
    field.configuration as ConfigurationInput<any> | undefined,
  );

  let merged = mergeConfigurations<FieldConfiguration>(
    fromFieldDef,
    fromFieldUsage,
  );
  // Cache result for this tick; will be invalidated on notifyCardTracking
  cacheForInstance.set(field.name, merged);
  return merged;
}

export function getFieldDescription(
  card: BaseDef | typeof BaseDef,
  fieldName: string,
): string | undefined {
  let klass: typeof BaseDef;
  if (isCardOrField(card)) {
    klass = card.constructor;
  } else {
    klass = card;
  }
  return lookupFieldDescription(klass, fieldName);
}

function lookupFieldDescription(
  klass: typeof BaseDef,
  fieldName: string,
): string | undefined {
  let proto: object | null = klass.prototype;
  while (proto && proto.constructor && proto.constructor !== Object) {
    let currentClass = proto.constructor as typeof BaseDef;
    let descriptionsMap = fieldDescriptions.get(currentClass);
    if (descriptionsMap) {
      let description = descriptionsMap.get(fieldName);
      if (description !== undefined) {
        return description;
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}

export function getFieldOverrides<T extends BaseDef>(
  instance: T,
): Map<string, any> {
  let overrides = fieldOverrides.get(instance);
  if (!overrides) {
    overrides = new Map();
    fieldOverrides.set(instance, overrides);
  }
  return overrides;
}

// A render/indexing pass reads the same instances' field maps over and over —
// per serialize, per searchDoc, per getDeps/findInstances recursion — and
// `computeFields` walks the prototype chain and resolves every field on each
// call. The result is determined by the prototype chain plus, for an instance,
// its polymorphic field overrides (and, with `usedLinksToFieldsOnly`, its
// populated field set). A read-only render only ever GROWS those, so their
// sizes are a sound validity token: an unchanged token means an identical
// result. Gated to the render context so the live app — where instances mutate
// freely (same-size override swaps, field clears) — is never served a memoized
// map. Keyed on the instance/class via a WeakMap so entries fall away with
// their subjects; the token guards reuse across passes.
const renderFieldsCache = new WeakMap<
  object,
  Map<
    string,
    {
      token: string;
      fields: { [fieldName: string]: Field<BaseDefConstructor> };
    }
  >
>();

function renderFieldsCacheToken(
  subject: object,
  isInstance: boolean,
  usedLinksToFieldsOnly: boolean,
): string {
  if (!isInstance) {
    // A class's field map is static; a module reload yields a new class object,
    // which is a fresh WeakMap key, so no token is needed.
    return '';
  }
  let overrideSize = fieldOverrides.get(subject as BaseDef)?.size ?? 0;
  if (!usedLinksToFieldsOnly) {
    return `o${overrideSize}`;
  }
  let usedSize = deserializedData.get(subject as BaseDef)?.size ?? 0;
  return `o${overrideSize}:u${usedSize}`;
}

export function getFields(
  card: typeof BaseDef,
  opts?: { usedLinksToFieldsOnly?: boolean; includeComputeds?: boolean },
): { [fieldName: string]: Field<BaseDefConstructor> };
export function getFields<T extends BaseDef>(
  card: T,
  opts?: { usedLinksToFieldsOnly?: boolean; includeComputeds?: boolean },
): { [P in keyof T]?: Field<BaseDefConstructor> };
export function getFields(
  cardInstanceOrClass: BaseDef | typeof BaseDef,
  opts?: { usedLinksToFieldsOnly?: boolean; includeComputeds?: boolean },
): { [fieldName: string]: Field<BaseDefConstructor> } {
  if (!(globalThis as any).__boxelRenderContext) {
    return computeFields(cardInstanceOrClass, opts);
  }
  // `cardInstanceOrClass` is a valid WeakMap key whether it's an instance or a
  // class; an instance keys per-instance so polymorphic overrides aren't shared
  // across instances of the same class.
  let subject: object = cardInstanceOrClass;
  let isInstance = isCardOrField(cardInstanceOrClass);
  let usedLinksToFieldsOnly = opts?.usedLinksToFieldsOnly ?? false;
  let optsKey = `${usedLinksToFieldsOnly ? 1 : 0}${opts?.includeComputeds ? 1 : 0}`;
  let token = renderFieldsCacheToken(
    subject,
    isInstance,
    usedLinksToFieldsOnly,
  );
  let perSubject = renderFieldsCache.get(subject);
  let entry = perSubject?.get(optsKey);
  if (entry && entry.token === token) {
    return entry.fields;
  }
  let fields = computeFields(cardInstanceOrClass, opts);
  if (!perSubject) {
    perSubject = new Map();
    renderFieldsCache.set(subject, perSubject);
  }
  perSubject.set(optsKey, { token, fields });
  return fields;
}

function computeFields(
  cardInstanceOrClass: BaseDef | typeof BaseDef,
  opts?: { usedLinksToFieldsOnly?: boolean; includeComputeds?: boolean },
): { [fieldName: string]: Field<BaseDefConstructor> } {
  let obj: object | null;
  let usedFields: string[] = [];
  if (isCardOrField(cardInstanceOrClass)) {
    // this is a card instance
    obj = Reflect.getPrototypeOf(cardInstanceOrClass);
    usedFields = getUsedFields(cardInstanceOrClass);
  } else {
    // this is a card class
    obj = (cardInstanceOrClass as typeof BaseDef).prototype;
  }
  let fields: { [fieldName: string]: Field<BaseDefConstructor> } = {};
  while (obj?.constructor.name && obj.constructor.name !== 'Object') {
    let descs = Object.getOwnPropertyDescriptors(obj);
    let currentFields = flatMap(Object.keys(descs), (maybeFieldName) => {
      if (maybeFieldName === 'constructor') {
        return [];
      }
      let maybeField = getField(cardInstanceOrClass, maybeFieldName, {
        untracked: true,
      });
      if (!maybeField) {
        return [];
      }

      if (
        !(primitive in maybeField.card) ||
        maybeField.computeVia ||
        !['contains', 'containsMany'].includes(maybeField.fieldType)
      ) {
        if (
          opts?.usedLinksToFieldsOnly &&
          !usedFields.includes(maybeFieldName) &&
          !maybeField.isUsed &&
          !['contains', 'containsMany'].includes(maybeField.fieldType)
        ) {
          return [];
        }
        if (maybeField.computeVia && !opts?.includeComputeds) {
          return [];
        }
      }
      return [[maybeFieldName, maybeField]];
    });
    fields = Object.assign(
      Object.create(null),
      fields,
      Object.fromEntries(currentFields),
    );
    obj = Reflect.getPrototypeOf(obj);
  }
  return fields;
}

function getUsedFields(instance: BaseDef): string[] {
  // getDataBucket always returns a Map (it creates one if absent), so the spread
  // is safe without optional chaining.
  return [...getDataBucket(instance).keys()];
}

export function isArrayOfCardOrField(
  cardsOrFields: any,
): cardsOrFields is BaseDef[] {
  return (
    Array.isArray(cardsOrFields) &&
    (cardsOrFields.length === 0 ||
      cardsOrFields.every((item) => isCardOrField(item)))
  );
}

export function isArrayOfField(fields: any): fields is FieldDef[] {
  return (
    Array.isArray(fields) &&
    (fields.length === 0 || fields.every((item) => isFieldDef(item)))
  );
}

export function isCardOrField(card: any): card is BaseDef {
  return card && typeof card === 'object' && isBaseInstance in card;
}

export function isCard(card: any): card is CardDef {
  return isCardOrField(card) && !('isFieldDef' in card.constructor);
}

export function isFieldDef(field: any): field is FieldDef {
  return isCardOrField(field) && 'isFieldDef' in field.constructor;
}

export function isCompoundField(card: any) {
  return (
    isCardOrField(card) &&
    'isFieldDef' in card.constructor &&
    !(primitive in card)
  );
}

function hasSentinelShape(
  val: any,
): val is { type: string; reference: string } {
  if (!val || typeof val !== 'object') {
    return false;
  }
  if (!('type' in val) || !('reference' in val)) {
    return false;
  }
  let { type, reference } = val;
  return typeof type === 'string' && typeof reference === 'string';
}

function hasErrorDoc(val: any): val is { errorDoc: SerializedError } {
  if (!val || typeof val !== 'object' || !('errorDoc' in val)) {
    return false;
  }
  let { errorDoc } = val;
  if (!errorDoc || typeof errorDoc !== 'object') {
    return false;
  }
  return (
    typeof errorDoc.message === 'string' &&
    typeof errorDoc.status === 'number' &&
    (errorDoc.additionalErrors === null ||
      Array.isArray(errorDoc.additionalErrors))
  );
}

export function isNotLoadedValue(val: any): val is NotLoadedValue {
  return hasSentinelShape(val) && val.type === 'not-loaded';
}

export function isLinkError(val: any): val is LinkErrorValue {
  return hasSentinelShape(val) && val.type === 'link-error' && hasErrorDoc(val);
}

export function isLinkNotFound(val: any): val is LinkNotFoundValue {
  return (
    hasSentinelShape(val) && val.type === 'link-not-found' && hasErrorDoc(val)
  );
}

export function isNonPresentLink(val: any): val is LinkSentinel {
  return isNotLoadedValue(val) || isLinkError(val) || isLinkNotFound(val);
}

export function peekAtField(instance: BaseDef, fieldName: string): any {
  let field = getField(instance, fieldName);
  if (!field) {
    throw new Error(
      `the card ${instance.constructor.name} does not have a field '${fieldName}'`,
    );
  }
  return getter(instance, field);
}

// Public typed read surface for `linksTo` / `linksToMany` relationship state.
// All consumers outside card-api.gts query relationship state through this API
// rather than reading the data bucket directly. The five discriminators cover
// every state a linked field can be in; callers branch on `kind` and read the
// fields the union narrows to.
// `kind` is the single discriminator — `isLoaded` / `isError` are derivable
// from it (`present` is loaded; `error` / `not-found` are errors), so they are
// not carried as redundant fields.
export type RelationshipState<T extends CardDef = CardDef> =
  | {
      kind: 'present';
      value: T;
      // Fully-qualified URL once the linked card is saved; the card's local id
      // before then. Both resolve through the store's identity map, which
      // correlates the local id to the remote URL when the server assigns one.
      reference: string;
    }
  | {
      kind: 'not-loaded';
      value: undefined;
      reference: string;
    }
  | {
      kind: 'error';
      value: undefined;
      reference: string;
      errorDoc: SerializedError;
    }
  | {
      kind: 'not-found';
      value: undefined;
      reference: string;
      errorDoc: SerializedError;
    }
  | {
      kind: 'not-set';
      value: undefined;
      reference: undefined;
    };

export function relationshipStateForEntry<T extends CardDef>(
  entry: unknown,
): RelationshipState<T> {
  if (isNotLoadedValue(entry)) {
    return {
      kind: 'not-loaded',
      value: undefined,
      reference: entry.reference,
    };
  }
  if (isLinkError(entry)) {
    return {
      kind: 'error',
      value: undefined,
      reference: entry.reference,
      errorDoc: entry.errorDoc,
    };
  }
  if (isLinkNotFound(entry)) {
    return {
      kind: 'not-found',
      value: undefined,
      reference: entry.reference,
      errorDoc: entry.errorDoc,
    };
  }
  if (entry == null) {
    return {
      kind: 'not-set',
      value: undefined,
      reference: undefined,
    };
  }
  return {
    kind: 'present',
    value: entry as T,
    // Saved cards carry a URL `id`; unsaved cards carry only a local id. Both
    // are resolvable references through the store's identity map.
    reference: (entry as CardDef).id ?? (entry as CardDef)[localId],
  };
}

// The relationship status of a `linksTo` / `linksToMany` field — one consistent
// object shape for every arity, query-backed or not.
//
// `isLoading` is a whole-field, observe-only flag: true while the field's data
// is actually being fetched. Reading it never starts the fetch — the template's
// field getter does that. If nothing accesses the field, `isLoading` stays
// `false`.
//
// `membership` is the per-element resolution(s), in document order:
//   - declared `linksTo`: a one-element array;
//   - declared `linksToMany`: one entry per element;
//   - query-backed (either arity): `undefined` while the search is in flight
//     (membership not yet known), then an array once results arrive — the same
//     shape as a non-query `linksToMany`. A re-triggered live query returns it
//     to `undefined` while running, then back to an array.
export interface RelationshipStatus<T extends CardDef = CardDef> {
  isLoading: boolean;
  membership: RelationshipState<T>[] | undefined;
}

// `getRelationshipMembershipState` reports `isLoading` and query-field membership, both of
// which derive from state that lives above this module (in-flight link loads
// and per-field search resources). Card-api registers a probe that supplies
// them, keeping `getRelationshipMembershipState` here (where its declared-link consumers live)
// without a circular import.
export interface RelationshipProbeResult<T extends CardDef = CardDef> {
  isLoading: boolean;
  isQueryField: boolean;
  // Resolved membership for a query-backed field (`undefined` while in flight).
  // Ignored for declared fields, whose membership comes from the data bucket.
  queryMembership?: RelationshipState<T>[] | undefined;
}
type RelationshipProbe = (
  instance: CardDef,
  field: Field,
) => RelationshipProbeResult;
let relationshipProbe: RelationshipProbe | undefined;
export function registerRelationshipProbe(probe: RelationshipProbe): void {
  relationshipProbe = probe;
}

// Read the relationship status for a `linksTo` or `linksToMany` field. Always
// returns a `Relationship` object (never a bare array): `isLoading` plus
// `membership` (per the type above). Pure read — entangles with card tracking
// via the shared field getter so templates re-render when sentinels change, but
// never triggers `lazilyLoadLink` / the search and never mutates the data
// bucket.
//
// Render stability: this returns a fresh envelope on every call, so the
// envelope's identity is NOT stable across renders. The stable anchors are each
// member's `reference` (a string) and `value` (the underlying card instance).
// Templates that render editable inputs per element MUST key `{{#each}}` on
// `reference` and bind inputs to `value` — never to envelope identity.
export function getRelationshipMembershipState<T extends CardDef = CardDef>(
  instance: CardDef,
  fieldName: string,
): RelationshipStatus<T> {
  let field = getField(instance, fieldName);
  if (!field) {
    throw new Error(
      `the card ${instance.constructor.name} does not have a field '${fieldName}'`,
    );
  }
  if (field.fieldType !== 'linksTo' && field.fieldType !== 'linksToMany') {
    throw new Error(
      `getRelationshipMembershipState requires a 'linksTo' or 'linksToMany' field; '${fieldName}' on ${instance.constructor.name} is '${field.fieldType}'`,
    );
  }

  let probe = relationshipProbe?.(instance, field);
  let isLoading = probe?.isLoading ?? false;

  if (field.queryDefinition) {
    // Query-backed: membership and loading both come from the field's search
    // resource (supplied by the probe), not the data bucket. `membership` is
    // `undefined` while the search is in flight.
    return {
      isLoading,
      membership: probe?.queryMembership as RelationshipState<T>[] | undefined,
    };
  }

  // Declared link: membership comes from the data bucket (pure read).
  let related = peekAtField(instance, field.name);
  let membership: RelationshipState<T>[];
  if (field.fieldType === 'linksToMany') {
    // A computed `linksToMany` can surface as a single sentinel when it
    // consumes an unresolved upstream link. Wrap it as a one-element array so
    // callers branch uniformly on the plural shape.
    if (isNonPresentLink(related)) {
      membership = [relationshipStateForEntry<T>(related)];
    } else if (!Array.isArray(related)) {
      throw new Error(
        `expected ${fieldName} to be an array but was ${typeof related}`,
      );
    } else {
      // Read the raw backing array: per-slot index access hides the broken-link
      // sentinels (surfacing them as `undefined`), but `membership` is the typed
      // surface whose whole job is to report each slot's true state.
      membership = rawArrayValues(related).map((entry) =>
        relationshipStateForEntry<T>(entry),
      );
    }
  } else {
    // Singular `linksTo` — a one-element membership keeps the shape consistent.
    membership = [relationshipStateForEntry<T>(related)];
  }
  return { isLoading, membership };
}

export interface BrokenLinkFinding {
  // The declared `linksTo` / `linksToMany` field holding the broken reference.
  fieldName: string;
  // `'error'` for a generic upstream failure, `'not-found'` for an HTTP 404.
  kind: 'error' | 'not-found';
  // The broken target reference, preserved from the relationship state.
  reference: string;
  // The upstream error captured when the lazy load failed.
  errorDoc: SerializedError;
}

// Walk the rendered instance graph and collect every `linksTo` / `linksToMany`
// relationship currently in an `'error'` or `'not-found'` state. This is the
// read surface for the indexer's broken-link error capture: the prerender and
// render route scan the instance after the store has settled and build a
// structured failure payload from the findings.
//
// The walk recurses so a broken link anywhere in the rendered graph is
// captured, not just one held directly by the root card:
//   - present `linksTo` / `linksToMany` values are recursed into, since a
//     loaded linked card can itself hold a link that was dereferenced (and
//     failed) during this render;
//   - `contains` / `containsMany` values are recursed into, since a contained
//     card has no index entry of its own — a broken link inside one is only
//     catchable here.
// A `visited` WeakSet guards against cycles (e.g. a `linksTo` to self).
//
// Pure read: only fields already materialized in the data bucket are inspected.
// A broken link is always present in the bucket (the failed `lazilyLoadLink`
// planted a sentinel there), and an unmaterialized field holds neither a broken
// link nor a nested card — so skipping absent fields loses nothing and avoids
// the getter's side effect of initializing them with `emptyValue` (which would
// pollute `getUsedFields` / serialization). Relationship state is then read
// through `getRelationshipMembershipState`, which never triggers `lazilyLoadLink`, so a
// recursed value surfaces only states that genuinely failed during this render.
// `'present'`, `'not-loaded'`, and `'not-set'` are not terminal failures; a
// `'not-loaded'` slot is an in-flight fetch, so callers must scan only after
// the store has settled.
//
// Computed relationship fields are skipped: `lazilyLoadLink` only plants
// sentinels on a declared field's bucket, and a computed read derives from its
// declared fields anyway, so the declared field is the single place a real
// broken-link state can live.
export function getBrokenLinks(
  instance: BaseDef,
  visited: WeakSet<object> = new WeakSet(),
): BrokenLinkFinding[] {
  if (visited.has(instance)) {
    return [];
  }
  visited.add(instance);
  let findings: BrokenLinkFinding[] = [];
  let bucket = getDataBucket(instance);
  let fields = getFields(instance);
  for (let [fieldName, field] of Object.entries(fields)) {
    if (!field || field.computeVia) {
      continue;
    }
    // Query-backed `linksTo` / `linksToMany` fields (the `{ query }` form
    // resolved through `_federated-search`) sit outside the
    // broken-link / declared-`linksTo` scan: their failure surface is
    // `getRelationshipMembershipState`, not the indexer-side cascade. A search resource
    // can fail for "soft" reasons that should not classify the consuming
    // card as instance-error (cross-realm assertions, transient federated
    // failures), and the field getter already routes them through a
    // structured state machine. Skip them here so a planted resource-level
    // sentinel does not flow into a render error.
    if (field.queryDefinition) {
      continue;
    }
    // Only inspect fields already in the data bucket — reading an absent field
    // through the getter would initialize it (see above).
    if (!bucket.has(fieldName)) {
      continue;
    }
    if (field.fieldType === 'linksTo' || field.fieldType === 'linksToMany') {
      // Declared fields (query-backed are skipped above) always have an array
      // membership built from the data bucket.
      let { membership } = getRelationshipMembershipState(
        instance as CardDef,
        fieldName,
      );
      for (let entry of membership ?? []) {
        if (entry.kind === 'error' || entry.kind === 'not-found') {
          // DIAGNOSTIC LOGGING (CS-11221) — remove after CI passes. Read
          // only fields that won't initialize bucket entries via the
          // field getter (constructor name + the entry's own reference);
          // reading `instance.id` here would write the `id` field's
          // emptyValue into the bucket and violate the pure-read contract
          // the surrounding `getBrokenLinks` upholds.
          console.error('[CS-11221 DIAG] getBrokenLinks finding', {
            ownerType: instance?.constructor?.name,
            fieldName,
            fieldType: field.fieldType,
            kind: entry.kind,
            reference: entry.reference,
          });
          findings.push({
            fieldName,
            kind: entry.kind,
            reference: entry.reference,
            errorDoc: entry.errorDoc,
          });
        } else if (entry.kind === 'present') {
          findings.push(...getBrokenLinks(entry.value, visited));
        }
      }
    } else if (
      field.fieldType === 'contains' ||
      field.fieldType === 'containsMany'
    ) {
      let value = bucket.get(fieldName);
      for (let item of Array.isArray(value) ? value : [value]) {
        if (isCardOrField(item)) {
          findings.push(...getBrokenLinks(item, visited));
        }
      }
    }
  }
  return findings;
}

export function serializedGet<CardT extends BaseDefConstructor>(
  model: InstanceType<CardT>,
  fieldName: string,
  doc: JSONAPISingleResourceDocument,
  visited: Set<string>,
  opts?: SerializeOpts,
): JSONAPIResource {
  let field = getField(model, fieldName);
  if (!field) {
    throw new Error(
      `tried to serializedGet field ${fieldName} which does not exist in card ${model.constructor.name}`,
    );
  }
  return field.serialize(peekAtField(model, fieldName), doc, visited, opts);
}

type Scalar =
  | string
  | number
  | boolean
  | null
  | undefined
  | (string | null | undefined)[]
  | (number | null | undefined)[]
  | (boolean | null | undefined)[];

export function assertScalar(
  scalar: any,
  fieldCard: typeof BaseDef,
): asserts scalar is Scalar {
  if (Array.isArray(scalar)) {
    if (
      scalar.find(
        (i) =>
          !['undefined', 'string', 'number', 'boolean'].includes(typeof i) &&
          i !== null,
      )
    ) {
      throw new Error(
        `expected queryableValue for field type ${
          fieldCard.name
        } to be scalar but was ${typeof scalar}`,
      );
    }
  } else if (
    !['undefined', 'string', 'number', 'boolean'].includes(typeof scalar) &&
    scalar !== null
  ) {
    throw new Error(
      `expected queryableValue for field type ${
        fieldCard.name
      } to be scalar but was ${typeof scalar}`,
    );
  }
}

export function setFieldDescription(
  cardOrFieldKlass: typeof BaseDef,
  fieldName: string,
  description: string,
) {
  let descriptionsMap = fieldDescriptions.get(cardOrFieldKlass);
  if (!descriptionsMap) {
    descriptionsMap = new Map();
    fieldDescriptions.set(cardOrFieldKlass, descriptionsMap);
  }
  descriptionsMap.set(fieldName, description);
}

export function setRealmContextOnField(
  instance: FieldDef,
  realmURLString: string,
) {
  instance[realmContext] = realmURLString;
}

function getRealmURLString(realmOrInstance: string | BaseDef | undefined) {
  if (!realmOrInstance) {
    return undefined;
  }
  if (typeof realmOrInstance === 'string') {
    return realmOrInstance;
  }
  if (isFieldInstance(realmOrInstance)) {
    return realmOrInstance[realmContext];
  }
  if (isCardInstance(realmOrInstance)) {
    return getCardMeta(realmOrInstance, 'realmURL');
  }
  return undefined;
}

export function propagateRealmContext(
  target: BaseDef | BaseDef[] | Scalar,
  realmURLString: string | undefined,
): void;
export function propagateRealmContext(
  target: BaseDef | BaseDef[] | Scalar,
  source: BaseDef,
): void;
export function propagateRealmContext(
  target: BaseDef | BaseDef[] | Scalar,
  realmOrSource: string | BaseDef | undefined,
): void {
  let realmURLString = getRealmURLString(realmOrSource);
  if (!realmURLString) {
    return;
  }
  if (isFieldDef(target)) {
    setRealmContextOnField(target, realmURLString);
  } else if (isArrayOfField(target)) {
    for (let v of target) {
      setRealmContextOnField(v, realmURLString);
    }
  }
}
