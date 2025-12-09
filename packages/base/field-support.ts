import { getField, isBaseInstance, primitive } from '@cardstack/runtime-common';
import type {
  BaseDef,
  BaseDefConstructor,
  BaseInstanceType,
  CardDef,
  Field,
  FieldDef,
} from './card-api';
import {
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

export function getter<CardT extends BaseDefConstructor>(
  instance: BaseDef,
  field: Field<CardT>,
): BaseInstanceType<CardT> {
  let deserialized = getDataBucket(instance);
  // this establishes that our field should rerender when cardTracking for this card changes
  cardTracking.get(instance);

  if (field.computeVia) {
    let value = field.computeVia.bind(instance)();
    if (value === undefined) {
      value = field.emptyValue(instance);
    }
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
    fields = { ...fields, ...Object.fromEntries(currentFields) };
    obj = Reflect.getPrototypeOf(obj);
  }
  return fields;
}

function getUsedFields(instance: BaseDef): string[] {
  return [...getDataBucket(instance)?.keys()];
}

export function isArrayOfCardOrField(
  cardsOrFields: any,
): cardsOrFields is CardDef[] | FieldDef[] {
  return (
    Array.isArray(cardsOrFields) &&
    (cardsOrFields.length === 0 ||
      cardsOrFields.every((item) => isCardOrField(item)))
  );
}

export function isCardOrField(card: any): card is CardDef | FieldDef {
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

export function isNotLoadedValue(val: any): val is NotLoadedValue {
  if (!val || typeof val !== 'object') {
    return false;
  }
  if (!('type' in val) || !('reference' in val)) {
    return false;
  }
  let { type, reference } = val;
  if (typeof type !== 'string' || typeof reference !== 'string') {
    return false;
  }
  return type === 'not-loaded';
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
