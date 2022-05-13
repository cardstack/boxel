import GlimmerComponent from '@glimmer/component';
import { ComponentLike } from '@glint/template';
import { NotReady, isNotReadyError} from './not-ready';
import flatMap from 'lodash/flatMap';
import startCase from 'lodash/startCase';
import { TrackedWeakMap } from 'tracked-built-ins';
import * as JSON from 'json-typescript';
import { registerDestructor } from '@ember/destroyable';
import ContainsManyEditor from '../components/contains-many';

export const primitive = Symbol('cardstack-primitive');
export const serialize = Symbol('cardstack-serialize');
export const deserialize = Symbol('cardstack-deserialize');

const isField = Symbol('cardstack-field');
const isContainsMany = Symbol('cardstack-contains-many');
const isComputed = Symbol('cardstack-field');

type CardInstanceType<T extends Constructable> = T extends { [primitive]: infer P } ? P : InstanceType<T>;

type FieldsTypeFor<T extends Card> = {
  [Field in keyof T]: (new() => GlimmerComponent<{ Args: {}, Blocks: {} }>) & (T[Field] extends Card ? FieldsTypeFor<T[Field]> : unknown);
}

type Setter = { setters: { [fieldName: string]: Setter }} & ((value: any) => void);

interface ResourceObject {
  // id: string; // TODO
  type: string;
  attributes?: JSON.Object;
  relationships?: JSON.Object;
  meta?: JSON.Object;
}

export type Format = 'isolated' | 'embedded' | 'edit';

interface Options {
  computeVia?: string | (() => unknown);
  containsMany?: true;
}

const deserializedData = new WeakMap<Card, Map<string, any>>();
const serializedData = new WeakMap<Card, Map<string, any>>();
const recomputePromises = new WeakMap<Card, Promise<any>>();

// our place for notifying Glimmer when a card is ready to re-render (which will
// involve rerunning async computed fields)
const cardTracking = new TrackedWeakMap<object, any>();

const isBaseCard = Symbol('isBaseCard');

export class Card {
  // this is here because Card has no public instance methods, so without it
  // typescript considers everything a valid card.
  [isBaseCard] = true;

  declare ["constructor"]: Constructable;
  static baseCard: undefined; // like isBaseCard, but for the class itself
  static data?: Record<string, any>;

  static fromSerialized<T extends Constructable>(this: T, data: Record<string, any>): InstanceType<T> {
    let model = new this() as InstanceType<T>;
    for (let [fieldName, value] of Object.entries(data)) {
      serializedSet(model, fieldName, value);
    }
    return model;
  }

  static async didRecompute(card: Card): Promise<void> {
    let promise = recomputePromises.get(card);
    await promise;
  }

  constructor(data?: Record<string, any>) {
    if (data !== undefined) {
      for (let [fieldName, value] of Object.entries(data)) {
        if (isFieldContainsMany(this.constructor, fieldName)) {
          if (value && !Array.isArray(value)) {
            throw new Error(`Expected array for field value ${fieldName} for card ${this.constructor.name}`);
          }
          let field = getField(this.constructor, fieldName);
          if (!field) {
            continue;
          }
          if (primitive in field) {
            (this as any)[fieldName] = value || [];
          } else {
            (this as any)[fieldName] = ((value || []) as any[]).map(item => new field!(item));
          }
        } else {
          (this as any)[fieldName] = value;
        }
      }
    }

    registerDestructor(this, Card.didRecompute.bind(this));
  }
}

function getDataBuckets<CardT extends Constructable>(instance: InstanceType<CardT>): { serialized: Map<string, any>; deserialized: Map<string, any>; } {
  let serialized = serializedData.get(instance);
  if (!serialized) {
    serialized = new Map();
    serializedData.set(instance, serialized);
  }
  let deserialized = deserializedData.get(instance);
  if (!deserialized) {
    deserialized = new Map();
    deserializedData.set(instance, deserialized);
  }
  return { serialized, deserialized };
}

export function serializedGet<CardT extends Constructable>(model: InstanceType<CardT>, fieldName: string ) {
  let { serialized, deserialized } = getDataBuckets(model);
  let field = getField(model.constructor, fieldName);
  let value = serialized.get(fieldName);
  if (value !== undefined) {
    return value;
  }
  value = deserialized.get(fieldName);
  if (primitive in (field as any)) {
    if (typeof (field as any)[serialize] === 'function') {
      if (isFieldContainsMany(model.constructor, fieldName)) {
        value = (value as any[]).map(item => item == null ? item : (field as any)[serialize](item));
      } else {
        value = value == null ? value : (field as any)[serialize](value);
      }
    }
  } else if (value != null) {
    if (isFieldContainsMany(model.constructor, fieldName)) {
      value = (Object.values(value) as Card[]).map(m => serializeModel(m));
    } else {
      value = serializeModel(value);
    }
  }
  serialized.set(fieldName, value);
  return value;
}

function serializeModel(model: Card) {
  return Object.fromEntries(
    Object.keys(getFields(model)).map(fieldName => [fieldName, serializedGet(model, fieldName)])
  );
}

export function serializedSet<CardT extends Constructable>(model: InstanceType<CardT>, fieldName: string, value: any ) {
  let { serialized, deserialized } = getDataBuckets(model);
  let field = getField(model.constructor, fieldName);
  if (!field) {
    throw new Error(`Field ${fieldName} does not exist in card ${model.constructor.name}`);
  }
  let isContainsMany = isFieldContainsMany(model.constructor, fieldName);
  if (isContainsMany && !Array.isArray(value)) {
    throw new Error(`Expected array for field value ${fieldName} for card ${model.constructor.name}`);
  }

  if (primitive in field) {
    serialized.set(fieldName, isContainsMany ? value || [] : value);
  } else {
    if (isContainsMany) {
      value = ((value || []) as any[]).map(item => (field! as typeof Card).fromSerialized(item));
      serialized.set(fieldName, value);
    } else {
      let instance = new field();
      for (let [ interiorFieldName, interiorValue ] of Object.entries(value)) {
        serializedSet(instance, interiorFieldName, interiorValue);
      }
      serialized.set(fieldName, instance);
    }
  }
  deserialized.delete(fieldName);
}

export function serializeCard<CardT extends Constructable>(model: InstanceType<CardT>): ResourceObject {
  let resource: ResourceObject = {
    type: 'card',
  };

  for (let fieldName of Object.keys(getFields(model))) {
    let value = serializedGet(model, fieldName);
    if (value) {
      resource.attributes = resource.attributes || {};
      resource.attributes[fieldName] = value;
    }
  }
  return resource;
}

export function containsMany<CardT extends Constructable>(card: CardT | (() => CardT), options?: Options): CardInstanceType<CardT>[] {
  return contains(card, { ...options, containsMany: true }) as CardInstanceType<CardT>[];
}

export function contains<CardT extends Constructable>(card: CardT | (() => CardT), options?: Options): CardInstanceType<CardT> {
  let { computeVia, containsMany } = options ?? {};
  let computedGet = function (fieldName: string) {
    return function(this: InstanceType<CardT>) {
      let { deserialized } = getDataBuckets(this);
      // this establishes that our field should rerender when cardTracking for this card changes
      cardTracking.get(this);
      let value = deserialized.get(fieldName);
      if (value === undefined && typeof computeVia === 'function' && computeVia.constructor.name !== 'AsyncFunction') {
        value = computeVia.bind(this)();
        deserialized.set(fieldName, value);
      } else if (value === undefined && (typeof computeVia === 'string' || typeof computeVia === 'function')) {
        throw new NotReady(this, fieldName, computeVia, this.constructor.name);
      }
      return value;
    };
  }

  if (primitive in card) { // primitives should not have to use thunks
    return {
      setupField(fieldName: string) {
        let get = computeVia ? computedGet(fieldName) : function(this: InstanceType<CardT>) {
          let { serialized, deserialized } = getDataBuckets(this);
          // this establishes that our field should rerender when cardTracking for this card changes
          cardTracking.get(this);
          let value = deserialized.get(fieldName);
          if (value !== undefined) {
            return value;
          }
          value = serialized.get(fieldName);
          let field = getField(this.constructor, fieldName);
          let isContainsMany = isFieldContainsMany(this.constructor, fieldName);
          if (typeof (field as any)[deserialize] === 'function') {
            if (isContainsMany) {
              value = (value as any[]).map(item => item == null ? item : (field as any)[deserialize](item));
            } else {
              value = value == null ? value : (field as any)[deserialize](value);
            }
          }
          value = isContainsMany && !value ? [] : value;
          deserialized.set(fieldName, value);
          return value;
        };
        (get as any)[isField] = card;
        (get as any)[isContainsMany] = Boolean(containsMany);
        (get as any)[isComputed] = Boolean(computeVia);
        return {
          enumerable: true,
          get,
          ...(computeVia
            ? {} // computeds don't have setters
            : {
              set(this: InstanceType<CardT>, value: any) {
                let { serialized, deserialized } = getDataBuckets(this);
                deserialized.set(fieldName, value);
                serialized.delete(fieldName);
                // invalidate all computed fields because we don't know which ones depend on this one
                for (let computedFieldName of Object.keys(getFields(this, true))) {
                  deserialized.delete(computedFieldName);
                }
                (async () => await recompute(this))();
              }
            }
          )
        };
      }
    } as any;
  } else {
    return {
      setupField(fieldName: string) {
        let instance: Card | undefined;
        function getInstance() {
          if (!instance) {
            let _card = "baseCard" in card ? card : (card as () => CardT)();
            instance = new _card();
          }
          return instance;
        }
        let get = computeVia ? computedGet(fieldName) : function(this: InstanceType<CardT>) {
          let { serialized, deserialized } = getDataBuckets(this);
          let value = deserialized.get(fieldName);
          if (value !== undefined) {
            return value;
          }
          // we save these as instantiated cards in serialized set for composite fields
          value = serialized.get(fieldName);
          return isFieldContainsMany(this.constructor, fieldName) && !value ? [] : value;
        };
        (get as any)[isField] = card;
        (get as any)[isContainsMany] = Boolean(containsMany);
        (get as any)[isComputed] = Boolean(computeVia);
        return {
          enumerable: true,
          get,
          ...(computeVia
            ? {} // computeds don't have setters
            : {
              set(this: InstanceType<CardT>, value: any) {
                getInstance();
                Object.assign(instance, value);
                let { serialized, deserialized } = getDataBuckets(this);
                deserialized.set(fieldName, instance);
                serialized.delete(fieldName);
              }
            }
          )
        };
      }
    } as any
  }
}

// our decorators are implemented by Babel, not TypeScript, so they have a
// different signature than Typescript thinks they do.
export const field = function(_target: object, key: string | symbol, { initializer }: { initializer(): any }) {
  return initializer().setupField(key);
} as unknown as PropertyDecorator;

export type Constructable = new(...args: any) => Card;

type SignatureFor<CardT extends Constructable> = { Args: { model: CardInstanceType<CardT>; fields: FieldsTypeFor<InstanceType<CardT>>; set: Setter; } }

export class Component<CardT extends Constructable> extends GlimmerComponent<SignatureFor<CardT>> {

}

class DefaultIsolated extends GlimmerComponent<{ Args: { fields: Record<string, new() => GlimmerComponent>}}> {
  <template>
    {{#each-in @fields as |_key Field|}}
      <Field />
    {{/each-in}}
  </template>;
}

class DefaultEdit extends GlimmerComponent<{ Args: { fields: Record<string, new() => GlimmerComponent>}}> {
  <template>
    {{#each-in @fields as |key Field|}}
      <label data-test-field={{key}}>
        {{!-- @glint-ignore glint is arriving at an incorrect type signature --}}
        {{startCase key}}
        <Field />
      </label>
    {{/each-in}}
  </template>;
}

const defaultComponent = {
  embedded: <template><!-- Inherited from base card embedded view. Did your card forget to specify its embedded component? --></template>,
  isolated: DefaultIsolated,
  edit: DefaultEdit,
}

function defaultFieldFormat(format: Format): Format {
  switch (format) {
    case 'edit':
      return 'edit';
    case 'isolated':
    case 'embedded':
      return 'embedded';
  }
}

function getComponent<CardT extends Constructable>(card: CardT, format: Format, model: InstanceType<CardT>, set?: Setter): ComponentLike<{ Args: never, Blocks: never }> {
  let Implementation = (card as any)[format] ?? defaultComponent[format];

  // *inside* our own component, @fields is a proxy object that looks
  // up our fields on demand.
  let internalFields = fieldsComponentsFor({}, model, defaultFieldFormat(format), set);
  let component = <template>
    <Implementation @model={{model}} @fields={{internalFields}} @set={{set}} />
  </template>

  // when viewed from *outside*, our component is both an invokable component
  // and a proxy that makes our fields available for nested invocation, like
  // <@fields.us.deeper />.
  //
  // It would be possible to use `externalFields` in place of `internalFields` above,
  // avoiding the need for two separate Proxies. But that has the uncanny property of
  // making `<@fields />` be an infinite recursion.
  let externalFields = fieldsComponentsFor(component, model, defaultFieldFormat(format), set);

  // This cast is safe because we're returning a proxy that wraps component.
  return externalFields as unknown as typeof component;
}


export async function prepareToRender(model: Card, format: Format): Promise<{ component: ComponentLike<{ Args: never, Blocks: never }> }> {
  await recompute(model); // absorb model asynchronicity
  let set: Setter | undefined;
  if (format === 'edit') {
    set = makeSetter(model);
  }
  let component = getComponent(model.constructor as Constructable, format, model, set);
  return { component };
}

async function recompute(card: Card): Promise<void> {
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

  async function _loadModel<T extends Card>(model: T, stack: { from: T, to: T, name: string}[] = []): Promise<void> {
    for (let [fieldName, field] of Object.entries(getFields(model))) {
      let value: any = await loadField(model, fieldName as keyof T);
      if (recomputePromises.get(card) !== recomputePromise) {
        return;
      }
      if (!(primitive in field) && value != null &&
        !stack.find(({ from, to, name }) => from === model && to === value && name === fieldName)
      ) {
        await _loadModel(value, [...stack, { from: model, to: value, name: fieldName }]);
      }
    }
  }

  await _loadModel(card);
  if (recomputePromises.get(card) !== recomputePromise) {
    return;
  }

  // notify glimmer to rerender this card
  cardTracking.set(card, true);
  done!();
}

async function loadField<T extends Card, K extends keyof T>(model: T, fieldName: K): Promise<T[K]> {
  let result: T[K];
  let isLoaded = false;
  let { deserialized } = getDataBuckets(model);
  while(!isLoaded) {
    try {
      result = model[fieldName];
      isLoaded = true;
    } catch (e: any) {
      if (!isNotReadyError(e)) {
        throw e;
      }
      let { model, computeVia, fieldName } = e;
      if (typeof computeVia === 'function') {
        deserialized.set(fieldName, await computeVia.bind(model)());
      } else {
        deserialized.set(fieldName, await model[computeVia]());
      }
    }
  }
  // case OK because deserialized.set assigns it
  return result!;
}

function getField<CardT extends Constructable>(card: CardT, fieldName: string): Constructable | undefined {
  let result =  getFieldDescriptorAttr(card, fieldName, isField) as CardT | (() => CardT) | undefined;
  if (result) {
    return "baseCard" in result ? result : (result as () => CardT)();
  }
  return undefined;
}

function isFieldContainsMany<CardT extends Constructable>(card: CardT, fieldName: string): boolean | undefined {
  return getFieldDescriptorAttr(card, fieldName, isContainsMany) as boolean | undefined;
}

function isFieldComputed<CardT extends Constructable>(card: CardT, fieldName: string): boolean | undefined {
  return getFieldDescriptorAttr(card, fieldName, isComputed) as boolean | undefined;
}

function getFieldDescriptorAttr<CardT extends Constructable>(card: CardT, fieldName: string, attr: string | symbol): unknown | undefined {
  let obj = card.prototype;
  while (obj) {
    let desc = Reflect.getOwnPropertyDescriptor(obj, fieldName);
    let result = (desc?.get as any)?.[attr];
    if (result !== undefined) {
      return result;
    }
    obj = Reflect.getPrototypeOf(obj);
  }
  return undefined;
}

function getFields<T extends Card>(card: T, onlyComputeds = false): { [P in keyof T]?: Constructable } {
  let obj = Reflect.getPrototypeOf(card);
  let fields: { [P in keyof T]?: Constructable } = {};
  while (obj?.constructor.name && obj.constructor.name !== 'Object') {
    let descs = Object.getOwnPropertyDescriptors(obj);
    let currentFields = flatMap(Object.keys(descs), maybeFieldName => {
      if (maybeFieldName !== 'constructor') {
        let maybeField = getField(card.constructor, maybeFieldName);
        let isComputed = isFieldComputed(card.constructor, maybeFieldName);
        if ((maybeField && onlyComputeds && isComputed) || (maybeField && !onlyComputeds)) {
          return [[maybeFieldName, maybeField]] as [[string, Constructable]];
        }
      }
      return [];
    });
    fields = { ...fields, ...Object.fromEntries(currentFields) };
    obj = Reflect.getPrototypeOf(obj);
  }
  return fields;
}

function fieldsComponentsFor<T extends Card>(target: object, model: T, defaultFormat: Format, set?: Setter): FieldsTypeFor<T> {
  return new Proxy(target, {
    get(target, property, received) {
      if (typeof property === 'symbol' || model == null) {
        // don't handle symbols or nulls
        return Reflect.get(target, property, received);
      }
      let field = getField(model.constructor, property);
      if (!field) {
        // field doesn't exist, fall back to normal property access behavior
        return Reflect.get(target, property, received);
      }
      let innerModel = (model as any)[property];
      defaultFormat = isFieldComputed(model.constructor, property) ? 'embedded' : defaultFormat;

      if (isFieldContainsMany(model.constructor, property)) {
        let components = (Object.values(innerModel) as T[]).map((m, i) => getComponent(field!, defaultFormat, m, makeSetter(model, property, i))) as any[];
        if (defaultFormat === 'edit') {
          if (isBaseCard in innerModel) {
            throw new Error('Cannot edit containsMany composite field');
          }
          let fieldName = property; // to get around linting error
          return class ContainsManyEditorTemplate extends GlimmerComponent {
            <template>
              <ContainsManyEditor
                @components={{components}}
                @model={{model}}
                @fieldName={{fieldName}}
              />
            </template>
          };
        }
        return class ContainsMany extends GlimmerComponent {
          <template>
            {{#each components as |Item|}}
              <Item/>
            {{/each}}
          </template>
        };
      }
      return getComponent(field, defaultFormat, innerModel, set?.setters[property]);
    },
    getPrototypeOf() {
      // This is necessary for Ember to be able to locate the template associated
      // with a proxied component. Our Proxy object won't be in the template WeakMap,
      // but we can pretend our Proxy object inherits from the true component, and
      // Ember's template lookup respects inheritance.
      return target;
    },
    ownKeys(target)  {
      let keys = Reflect.ownKeys(target);
      for (let name in model) {
        let field = getField(model.constructor, name);
        if (field) {
          keys.push(name);
        }
      }
      return keys;
    },
    getOwnPropertyDescriptor(target, property) {
      if (typeof property === 'symbol') {
        // don't handle symbols
        return Reflect.getOwnPropertyDescriptor(target, property);
      }
      let field = getField(model.constructor, property);
      if (!field) {
        // field doesn't exist, fall back to normal property access behavior
        return Reflect.getOwnPropertyDescriptor(target, property);
      }
      // found field: fields are enumerable properties
      return {
        enumerable: true,
        writable: true,
        configurable: true,
      }
    },

  }) as any;
}

function makeSetter(model: any, field?: string, index?: number): Setter {
  let s = (value: any) => {
    if (!field) {
      throw new Error(`can't set topmost model`);
    }
    if (index) {
      model[field][index] = value;
      model[field] = model[field];
    } else {
      model[field] = value;
    }
  };
  (s as any).setters = new Proxy(
    {},
    {
      get: (target: any, prop: string, receiver: unknown) => {
        if (typeof prop === 'string') {
          if (field && index) {
            return makeSetter(model[field][index]);
          }
          return makeSetter(field ? model[field] : model, prop);
        } else {
          return Reflect.get(target, prop, receiver);
        }
      },
    }
  );
  return s as Setter;
}
