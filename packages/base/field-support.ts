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
import { TrackedWeakMap } from 'tracked-built-ins';
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

// Pass-scoped computed-field memo. When non-null, `getter` consults a
// per-instance Map before invoking `computeVia` and stores the result for
// the duration of the synchronous traversal that opened the pass (see
// `beginComputePass`). Off-pass reads pay only a single null check on this
// module local and follow the original path — the JIT branch-predicts the
// off-pass case in the host-UI hot loop.
let passComputeMemo: WeakMap<BaseDef, Map<string, any>> | null = null;
// Counters snapshotted by the render/meta route to populate
// `boxel_index.timing_diagnostics`. They are unconditional integer
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
  return [...getDataBucket(instance)?.keys()];
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
export type RelationshipState<T extends CardDef = CardDef> =
  | {
      kind: 'present';
      isLoaded: true;
      isError: false;
      value: T;
      // Fully-qualified URL once the linked card is saved; the card's local id
      // before then. Both resolve through the store's identity map, which
      // correlates the local id to the remote URL when the server assigns one.
      reference: string;
    }
  | {
      kind: 'not-loaded';
      isLoaded: false;
      isError: false;
      value: undefined;
      reference: string;
    }
  | {
      kind: 'error';
      isLoaded: false;
      isError: true;
      value: undefined;
      reference: string;
      errorDoc: SerializedError;
    }
  | {
      kind: 'not-found';
      isLoaded: false;
      isError: true;
      value: undefined;
      reference: string;
      errorDoc: SerializedError;
    }
  | {
      kind: 'not-set';
      isLoaded: false;
      isError: false;
      value: undefined;
      reference: undefined;
    };

function relationshipStateForEntry<T extends CardDef>(
  entry: unknown,
): RelationshipState<T> {
  if (isNotLoadedValue(entry)) {
    return {
      kind: 'not-loaded',
      isLoaded: false,
      isError: false,
      value: undefined,
      reference: entry.reference,
    };
  }
  if (isLinkError(entry)) {
    return {
      kind: 'error',
      isLoaded: false,
      isError: true,
      value: undefined,
      reference: entry.reference,
      errorDoc: entry.errorDoc,
    };
  }
  if (isLinkNotFound(entry)) {
    return {
      kind: 'not-found',
      isLoaded: false,
      isError: true,
      value: undefined,
      reference: entry.reference,
      errorDoc: entry.errorDoc,
    };
  }
  if (entry == null) {
    return {
      kind: 'not-set',
      isLoaded: false,
      isError: false,
      value: undefined,
      reference: undefined,
    };
  }
  return {
    kind: 'present',
    isLoaded: true,
    isError: false,
    value: entry as T,
    // Saved cards carry a URL `id`; unsaved cards carry only a local id. Both
    // are resolvable references through the store's identity map.
    reference: (entry as CardDef).id ?? (entry as CardDef)[localId],
  };
}

// Read the relationship state for a `linksTo` or `linksToMany` field. Returns a
// single `RelationshipState` for singular `linksTo`, or an array (one entry per
// element) for `linksToMany`. Pure read — entangles with card tracking via the
// shared field getter so templates re-render when sentinels change, but never
// triggers `lazilyLoadLink` and never mutates the data bucket.
//
// Render stability: this returns a fresh envelope object (and a fresh array for
// the plural case) on every call, so the envelope's own identity is NOT stable
// across renders. The stable anchors are `reference` (a string) and `value`
// (the underlying card instance, itself stable across renders). Templates that
// render editable inputs per element MUST key `{{#each}}` on `reference` and
// bind inputs to `value` — never to envelope identity — or the each-blocks tear
// down on every re-render and input fields lose cursor focus in edit format.
// `getRelationship` itself schedules no re-renders (see the render-count test),
// so it cannot destabilize a component on its own.
export function getRelationship<T extends CardDef = CardDef>(
  instance: CardDef,
  fieldName: string,
): RelationshipState<T> | RelationshipState<T>[] {
  let field = getField(instance, fieldName);
  if (!field) {
    throw new Error(
      `the card ${instance.constructor.name} does not have a field '${fieldName}'`,
    );
  }
  if (field.fieldType !== 'linksTo' && field.fieldType !== 'linksToMany') {
    throw new Error(
      `getRelationship requires a 'linksTo' or 'linksToMany' field; '${fieldName}' on ${instance.constructor.name} is '${field.fieldType}'`,
    );
  }

  let related = peekAtField(instance, field.name);

  if (field.fieldType === 'linksToMany') {
    // A computed `linksToMany` can surface as a single sentinel when it
    // consumes an unresolved upstream link. Wrap it as a one-element array so
    // callers can branch uniformly on the plural shape.
    if (isNonPresentLink(related)) {
      return [relationshipStateForEntry<T>(related)];
    }
    if (!Array.isArray(related)) {
      throw new Error(
        `expected ${fieldName} to be an array but was ${typeof related}`,
      );
    }
    // Read the raw backing array: per-slot index access hides the broken-link
    // sentinels (surfacing them as `undefined`), but `getRelationship` is the
    // typed surface whose whole job is to report each slot's true state.
    return rawArrayValues(related).map((entry) =>
      relationshipStateForEntry<T>(entry),
    );
  }

  return relationshipStateForEntry<T>(related);
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
// through `getRelationship`, which never triggers `lazilyLoadLink`, so a
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
    // Only inspect fields already in the data bucket — reading an absent field
    // through the getter would initialize it (see above).
    if (!bucket.has(fieldName)) {
      continue;
    }
    if (field.fieldType === 'linksTo' || field.fieldType === 'linksToMany') {
      let state = getRelationship(instance as CardDef, fieldName);
      for (let entry of Array.isArray(state) ? state : [state]) {
        if (entry.kind === 'error' || entry.kind === 'not-found') {
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

type RelationshipMeta = NotLoadedRelationship | LoadedRelationship;
interface NotLoadedRelationship {
  type: 'not-loaded';
  reference: string;
  // TODO add a loader (which may turn this into a class)
  // load(): Promise<CardInstanceType<CardT>>;
}
interface LoadedRelationship {
  type: 'loaded';
  card: CardDef | null;
}

/**
 * @deprecated Use {@link getRelationship} instead. `relationshipMeta` is a
 * back-compat wrapper that collapses the five-kind `RelationshipState` union
 * into the legacy `{ type: 'loaded' | 'not-loaded' }` envelope and will be
 * removed once all callers have migrated.
 */
export function relationshipMeta(
  instance: CardDef,
  fieldName: string,
): RelationshipMeta | RelationshipMeta[] | undefined {
  let field = getField(instance, fieldName);
  if (!field) {
    throw new Error(
      `the card ${instance.constructor.name} does not have a field '${fieldName}'`,
    );
  }
  if (!(field.fieldType === 'linksTo' || field.fieldType === 'linksToMany')) {
    return undefined;
  }
  // Legacy linksToMany scalar shape: a computed `linksToMany` whose upstream
  // link hasn't resolved surfaces as a single sentinel rather than an array.
  // Before `getRelationship`, this returned a scalar meta (not a one-element
  // array). `getRelationship`'s typed contract wraps it as `[state]`, so the
  // wrapper unwraps that case here to keep `relationshipMeta` callers stable.
  if (field.fieldType === 'linksToMany') {
    let peeked = peekAtField(instance, fieldName);
    if (isNonPresentLink(peeked)) {
      return toLegacyRelationshipMeta(relationshipStateForEntry(peeked));
    }
  }
  let state = getRelationship(instance, fieldName);
  if (Array.isArray(state)) {
    return state.map(toLegacyRelationshipMeta);
  }
  return toLegacyRelationshipMeta(state);
}

function toLegacyRelationshipMeta(state: RelationshipState): RelationshipMeta {
  // Legacy callers only branched on 'loaded' vs 'not-loaded'; the new error /
  // not-found kinds did not exist when the contract was written. Map them to
  // 'not-loaded' so existing consumers see a stable shape until migration.
  if (state.isLoaded) {
    return { type: 'loaded', card: state.value };
  }
  if (state.kind === 'not-set') {
    return { type: 'loaded', card: null };
  }
  return { type: 'not-loaded', reference: state.reference };
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
