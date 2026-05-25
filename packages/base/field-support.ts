import {
  getField,
  isBaseInstance,
  isCardInstance,
  isFieldInstance,
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

export interface BrokenLinkFinding {
  fieldName: string;
  sentinel: LinkErrorValue | LinkNotFoundValue;
}

// Walks the declared top-level linksTo/linksToMany fields of `instance`
// and returns every LinkError/LinkNotFound sentinel currently sitting in
// the data bucket. NotLoaded sentinels are deliberately ignored — they
// represent in-flight fetches, not terminal failures, and reading them
// does not constitute a render error. Callers are expected to invoke
// this only after the store has settled (e.g. after `await
// store.loaded()`), so any remaining sentinel reliably reflects a
// completed fetch outcome.
//
// Computed relationship fields are skipped: a computeVia returns the
// field's value, and for linksTo / linksToMany that value has to be a
// live CardDef instance (or null). The Error / NotFound sentinels are
// only ever planted into the data bucket by `lazilyLoadLink`'s failure
// path on a declared field, never produced by a computeVia — there is
// no way to materialize a CardDef for a card that does not exist. The
// declared field a computed derives from is itself in scope, so any
// real broken-link state surfaces there.
//
// We also read from the data bucket directly rather than going through
// `peekAtField` / the getter: routing through the getter would write
// the empty-value back into the bucket for untouched linksTo fields
// and pollute `getUsedFields` for any subsequent caller.
export function scanForBrokenLinks(instance: BaseDef): BrokenLinkFinding[] {
  let findings: BrokenLinkFinding[] = [];
  let bucket = getDataBucket(instance);
  let fields = getFields(instance);
  for (let [fieldName, field] of Object.entries(fields)) {
    if (!field) {
      continue;
    }
    if (field.computeVia) {
      continue;
    }
    if (field.fieldType !== 'linksTo' && field.fieldType !== 'linksToMany') {
      continue;
    }
    if (!bucket.has(fieldName)) {
      continue;
    }
    let value = bucket.get(fieldName);
    if (isLinkError(value) || isLinkNotFound(value)) {
      findings.push({ fieldName, sentinel: value });
      continue;
    }
    if (field.fieldType === 'linksToMany' && Array.isArray(value)) {
      for (let item of value) {
        if (isLinkError(item) || isLinkNotFound(item)) {
          findings.push({ fieldName, sentinel: item });
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
  let related = peekAtField(instance, field.name) as CardDef;
  if (field.fieldType === 'linksToMany') {
    // this is the scenario where the linksToMany is a computed that consumes a link that is not loaded
    if (isNotLoadedValue(related)) {
      return { type: 'not-loaded', reference: related.reference };
    }
    if (!Array.isArray(related)) {
      throw new Error(
        `expected ${fieldName} to be an array but was ${typeof related}`,
      );
    }
    return related.map((rel) => {
      if (isNotLoadedValue(rel)) {
        return { type: 'not-loaded', reference: rel.reference };
      } else {
        return { type: 'loaded', card: rel ?? null };
      }
    });
  }

  if (isNotLoadedValue(related)) {
    return { type: 'not-loaded', reference: related.reference };
  } else {
    return { type: 'loaded', card: related ?? null };
  }
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
