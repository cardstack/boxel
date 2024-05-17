import { flatMap } from 'lodash';
import { TrackedWeakMap } from 'tracked-built-ins';
import {
  type LooseSingleCardDocument,
  getField,
  primitive,
  NotReady,
  type CardDocument,
  type CardFields,
  type NotLoaded,
  isNotLoadedError,
  isNotReadyError,
} from '@cardstack/runtime-common';
import { isCardOrField } from '../-type-utils';
import {
  type BaseDefConstructor,
  type BaseDef,
  type BaseInstanceType,
} from '../-base-def';
import {
  type JSONAPISingleResourceDocument,
  type FieldType,
  type JSONAPIResource,
  type RecomputeOptions,
} from '../-constants';
import { type Box } from '../-box';
import { type IdentityContext } from '../-identity-context';
import { initSharedState } from '../../shared-state';
import { type BoxComponent } from '../-components/field-component';

export interface Field<
  CardT extends BaseDefConstructor = BaseDefConstructor,
  SearchT = any,
> {
  card: CardT;
  name: string;
  fieldType: FieldType;
  computeVia: undefined | string | (() => unknown);
  description: undefined | string;
  // there exists cards that we only ever run in the host without
  // the isolated renderer (RoomField), which means that we cannot
  // use the rendering mechanism to tell if a card is used or not,
  // in which case we need to tell the runtime that a card is
  // explictly being used.
  isUsed?: undefined | true;
  serialize(
    value: any,
    doc: JSONAPISingleResourceDocument,
    visited: Set<string>,
    opts?: SerializeOpts,
  ): JSONAPIResource;
  deserialize(
    value: any,
    doc: LooseSingleCardDocument | CardDocument,
    relationships: JSONAPIResource['relationships'] | undefined,
    fieldMeta: CardFields[string] | undefined,
    identityContext: IdentityContext | undefined,
    instancePromise: Promise<BaseDef>,
    loadedValue: any,
    relativeTo: URL | undefined,
  ): Promise<any>;
  emptyValue(instance: BaseDef): any;
  validate(instance: BaseDef, value: any): void;
  component(model: Box<BaseDef>): BoxComponent;
  getter(instance: BaseDef): BaseInstanceType<CardT>;
  queryableValue(value: any, stack: BaseDef[]): SearchT;
  handleNotLoadedError(
    instance: BaseInstanceType<CardT>,
    e: NotLoaded,
    opts?: RecomputeOptions,
  ): Promise<
    BaseInstanceType<CardT> | BaseInstanceType<CardT>[] | undefined | void
  >;
}

export interface SerializeOpts {
  includeComputeds?: boolean;
  includeUnrenderedFields?: boolean;
  maybeRelativeURL?: ((possibleURL: string) => string) | null; // setting this to null will force all URL's to be absolute
  omitFields?: [typeof BaseDef];
}

export const deserializedData = initSharedState(
  'deserializedData',
  () => new WeakMap<BaseDef, Map<string, any>>(),
);

// our place for notifying Glimmer when a card is ready to re-render (which will
// involve rerunning async computed fields)
export const cardTracking = initSharedState(
  'cardTracking',
  () => new TrackedWeakMap<object, any>(),
);

export function getFields(
  card: typeof BaseDef,
  opts?: { usedFieldsOnly?: boolean; includeComputeds?: boolean },
): { [fieldName: string]: Field<BaseDefConstructor> };
export function getFields<T extends BaseDef>(
  card: T,
  opts?: { usedFieldsOnly?: boolean; includeComputeds?: boolean },
): { [P in keyof T]?: Field<BaseDefConstructor> };
export function getFields(
  cardInstanceOrClass: BaseDef | typeof BaseDef,
  opts?: { usedFieldsOnly?: boolean; includeComputeds?: boolean },
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
      let maybeField = getField(
        (isCardOrField(cardInstanceOrClass)
          ? cardInstanceOrClass.constructor
          : cardInstanceOrClass) as typeof BaseDef,
        maybeFieldName,
      );
      if (!maybeField) {
        return [];
      }

      if (
        !(primitive in maybeField.card) ||
        maybeField.computeVia ||
        !['contains', 'containsMany'].includes(maybeField.fieldType)
      ) {
        if (
          opts?.usedFieldsOnly &&
          !usedFields.includes(maybeFieldName) &&
          !maybeField.isUsed
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

export function peekAtField(instance: BaseDef, fieldName: string): any {
  let field = getField(
    Reflect.getPrototypeOf(instance)!.constructor as typeof BaseDef,
    fieldName,
  );
  if (!field) {
    throw new Error(
      `the card ${instance.constructor.name} does not have a field '${fieldName}'`,
    );
  }
  return getter(instance, field);
}

export function getter<CardT extends BaseDefConstructor>(
  instance: BaseDef,
  field: Field<CardT>,
): BaseInstanceType<CardT> {
  let deserialized = getDataBucket(instance);
  // this establishes that our field should rerender when cardTracking for this card changes
  cardTracking.get(instance);

  if (field.computeVia) {
    let value = deserialized.get(field.name);
    if (isStaleValue(value)) {
      value = value.staleValue;
    } else if (
      !deserialized.has(field.name) &&
      typeof field.computeVia === 'function' &&
      field.computeVia.constructor.name !== 'AsyncFunction'
    ) {
      value = field.computeVia.bind(instance)();
      deserialized.set(field.name, value);
    } else if (
      !deserialized.has(field.name) &&
      (typeof field.computeVia === 'string' ||
        typeof field.computeVia === 'function')
    ) {
      throw new NotReady(instance, field.name, field.computeVia);
    }
    return value;
  } else {
    if (deserialized.has(field.name)) {
      return deserialized.get(field.name);
    }
    let value = field.emptyValue(instance);
    deserialized.set(field.name, value);
    return value;
  }
}

export interface StaleValue {
  type: 'stale';
  staleValue: any;
}

export function isStaleValue(value: any): value is StaleValue {
  if (value && typeof value === 'object') {
    return 'type' in value && value.type === 'stale' && 'staleValue' in value;
  } else {
    return false;
  }
}

export interface NotLoadedValue {
  type: 'not-loaded';
  reference: string;
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

interface NotReadyValue {
  type: 'not-ready';
  instance: BaseDef;
  fieldName: string;
}

export function isNotReadyValue(value: any): value is NotReadyValue {
  if (value && typeof value === 'object') {
    return (
      'type' in value &&
      value.type === 'not-ready' &&
      'instance' in value &&
      isCardOrField(value.instance) &&
      'fieldName' in value &&
      typeof value.fieldName === 'string'
    );
  } else {
    return false;
  }
}

const recomputePromises = initSharedState(
  'recomputePromises',
  () => new WeakMap<BaseDef, Promise<any>>(),
);

export async function recompute(
  card: BaseDef,
  opts?: RecomputeOptions,
): Promise<void> {
  // Note that after each async step we check to see if we are still the
  // current promise, otherwise we bail
  let done: () => void;
  let recomputePromise = new Promise<void>((res) => (done = res));
  recomputePromises.set(card, recomputePromise);

  // wait a full micro task before we start - this is simple debounce
  await Promise.resolve();
  if (recomputePromises.get(card) !== recomputePromise) {
    return;
  }

  async function _loadModel<T extends BaseDef>(
    model: T,
    stack: BaseDef[] = [],
  ): Promise<void> {
    let pendingFields = new Set<string>(
      Object.keys(
        getFields(model, {
          includeComputeds: true,
          usedFieldsOnly: !opts?.recomputeAllFields,
        }),
      ),
    );
    do {
      for (let fieldName of [...pendingFields]) {
        let value = await getIfReady(
          model,
          fieldName as keyof T,
          undefined,
          opts,
        );
        if (!isNotReadyValue(value) && !isStaleValue(value)) {
          pendingFields.delete(fieldName);
          if (recomputePromises.get(card) !== recomputePromise) {
            return;
          }
          if (Array.isArray(value)) {
            for (let item of value) {
              if (item && isCardOrField(item) && !stack.includes(item)) {
                await _loadModel(item, [item, ...stack]);
              }
            }
          } else if (isCardOrField(value) && !stack.includes(value)) {
            await _loadModel(value, [value, ...stack]);
          }
        }
      }
      // TODO should we have a timeout?
    } while (pendingFields.size > 0);
  }

  await _loadModel(card);
  if (recomputePromises.get(card) !== recomputePromise) {
    return;
  }

  // notify glimmer to rerender this card
  cardTracking.set(card, true);
  done!();
}

export async function getIfReady<T extends BaseDef, K extends keyof T>(
  instance: T,
  fieldName: K,
  compute: () => T[K] | Promise<T[K]> = () => instance[fieldName],
  opts?: RecomputeOptions,
): Promise<T[K] | T[K][] | NotReadyValue | StaleValue | undefined> {
  let result: T[K] | T[K][] | undefined;
  let deserialized = getDataBucket(instance);
  let maybeStale = deserialized.get(fieldName as string);
  let field = getField(
    Reflect.getPrototypeOf(instance)!.constructor as typeof BaseDef,
    fieldName as string,
  );
  if (isStaleValue(maybeStale)) {
    if (!field) {
      throw new Error(
        `the field '${fieldName as string} does not exist in card ${
          instance.constructor.name
        }'`,
      );
    }
    let { computeVia: _computeVia } = field;
    if (!_computeVia) {
      throw new Error(
        `the field '${fieldName as string}' is not a computed field in card ${
          instance.constructor.name
        }`,
      );
    }
    let computeVia = _computeVia as (() => T[K] | Promise<T[K]>) | string;
    compute =
      typeof computeVia === 'function'
        ? computeVia.bind(instance)
        : () => (instance as any)[computeVia as string]();
  }
  try {
    //To avoid race conditions,
    //the computeVia function should not perform asynchronous computation
    //if it is not an async function.
    //This ensures that other functions are not executed
    //by the runtime before this function is finished.
    let computeResult = compute();
    result =
      computeResult instanceof Promise ? await computeResult : computeResult;
  } catch (e: any) {
    if (isNotLoadedError(e)) {
      let card = Reflect.getPrototypeOf(instance)!
        .constructor as typeof BaseDef;
      let field: Field = getField(card, fieldName as string)!;
      return (await field.handleNotLoadedError(instance, e, opts)) as
        | T[K]
        | T[K][]
        | undefined;
    } else if (isNotReadyError(e)) {
      let { instance: depModel, computeVia, fieldName: depField } = e;
      let nestedCompute =
        typeof computeVia === 'function'
          ? computeVia.bind(depModel)
          : () => depModel[computeVia as string]();
      await getIfReady(depModel, depField, nestedCompute, opts);
      return { type: 'not-ready', instance, fieldName: fieldName as string };
    } else {
      throw e;
    }
  }

  //Only update the value of computed field.
  if (field?.computeVia) {
    deserialized.set(fieldName as string, result);
  }
  return result;
}
