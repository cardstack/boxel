import GlimmerComponent from '@glimmer/component';
import { ComponentLike } from '@glint/template';
import { NotReady, isNotReadyError} from './not-ready';
import flatMap from 'lodash/flatMap';
import { TrackedMap } from 'tracked-built-ins';

export const primitive = Symbol('cardstack-primitive');
export const serialize = Symbol('cardstack-serialize');
export const deserialize = Symbol('cardstack-deserialize');

const isField = Symbol('cardstack-field');

type CardInstanceType<T extends Constructable> = T extends { [primitive]: infer P } ? P : InstanceType<T>;

type FieldsTypeFor<CardT extends Constructable> = {
  [Field in keyof InstanceType<CardT>]: (new() => GlimmerComponent<{ Args: {}, Blocks: {} }>) & FieldsTypeFor<InstanceType<CardT>[Field]>;
}

type Setter = { setters: { [fieldName: string]: Setter }} & ((value: any) => void);

export type Format = 'isolated' | 'embedded' | 'edit';

interface Options {
  computeVia?: string | (() => unknown);
}

const deserializedData = new WeakMap<object, Map<string, any>>();
const serializedData = new WeakMap<object, Map<string, any>>();

function getDataBuckets<CardT extends Constructable>(instance: InstanceType<CardT>): { serialized: Map<string, any>; deserialized: Map<string, any>; } {
  let serialized = serializedData.get(instance);
  if (!serialized) {
    serialized = new TrackedMap();
    serializedData.set(instance, serialized);
  }
  let deserialized = deserializedData.get(instance);
  if (!deserialized) {
    deserialized = new TrackedMap();
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
      value = (field as any)[serialize](value);
    }
  } else if (value != null) {
    let instance = {} as Record<string, any>;
    for (let interiorFieldName of Object.keys(getFields(value))) {
      instance[interiorFieldName] = serializedGet(value, interiorFieldName);
    }
    value = instance;
  }
  serialized.set(fieldName, value);
  return value;
}

export function serializedSet<CardT extends Constructable>(model: InstanceType<CardT>, fieldName: string, value: any ) {
  let { serialized, deserialized } = getDataBuckets(model);
  let field = getField(model.constructor, fieldName);
  if (!field) {
    throw new Error(`Field ${fieldName} does not exist on ${model.constructor.name}`);
  }

  if (primitive in field) {
    serialized.set(fieldName, value);
  } else {
    let instance = new field();
    for (let [ interiorFieldName, interiorValue ] of Object.entries(value)) {
      serializedSet(instance, interiorFieldName, interiorValue);
    }
    serialized.set(fieldName, instance);
  }
  deserialized.delete(fieldName);
}

export function contains<CardT extends Constructable>(card: CardT, options?: Options): CardInstanceType<CardT> {
  let { computeVia } = options ?? {};
  let computedGet = function (fieldName: string) {
    return function(this: InstanceType<CardT>) {
      let { deserialized } = getDataBuckets(this);
      let value = deserialized.get(fieldName);
      if (value === undefined && typeof computeVia === 'function') {
        value = computeVia.bind(this)();
        deserialized.set(fieldName, value);
      } else if (value === undefined && typeof computeVia === 'string') {
        throw new NotReady(this, fieldName, computeVia, this.constructor.name);
      }
      return value;
    };
  }

  if (primitive in card) {
    return {
      setupField(fieldName: string) {
        let get = computeVia ? computedGet(fieldName) : function(this: InstanceType<CardT>) {
          let { serialized, deserialized } = getDataBuckets(this);
          let value = deserialized.get(fieldName);
          let field = getField(this.constructor, fieldName);
          if (value !== undefined) {
            return value;
          }
          value = serialized.get(fieldName);
          if (typeof (field as any)[deserialize] === 'function') {
            value = (field as any)[deserialize](value);
          }
          deserialized.set(fieldName, value);
          return value;
        };
        (get as any)[isField] = card;
        return {
          enumerable: true,
          get,
          ...(computeVia
            ? {} // computeds don't have setters
            : {
              set(value: any) {
                let { serialized, deserialized } = getDataBuckets(this);
                deserialized.set(fieldName, value);
                serialized.delete(fieldName);
              }
            }
          )
        };
      }
    } as any;
  } else {
    return {
      setupField(fieldName: string) {
        let instance = new card();
        let get = computeVia ? computedGet(fieldName) : function(this: InstanceType<CardT>) {
          let { serialized, deserialized } = getDataBuckets(this);
          let value = deserialized.get(fieldName);
          if (value !== undefined) {
            return value;
          }
          // we save these as instantiated cards in serialized set for composite fields
          value = serialized.get(fieldName);
          if (value === undefined) {
            value = instance;
            serialized.set(fieldName, value);
          }
          return value;
        };
        (get as any)[isField] = card;
        return {
          enumerable: true,
          get,
          ...(computeVia
            ? {} // computeds don't have setters
            : {
              set(value: any) {
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

export type Constructable = new(...args: any) => any;

type SignatureFor<CardT extends Constructable> = { Args: { model: CardInstanceType<CardT>; fields: FieldsTypeFor<CardT>; set: Setter; } }

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
        {{key}}
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

function getInitialData(card: Constructable): Record<string, any> | undefined {
  return (card as any).data;
}

export interface RenderOptions {
  dataIsDeserialized?: boolean
}

export async function prepareToRender<CardT extends Constructable>(card: CardT, format: Format, opts?: RenderOptions): Promise<{ component: ComponentLike<{ Args: never, Blocks: never }> }> {
  let { dataIsDeserialized }: Required<RenderOptions> = { dataIsDeserialized: false, ...opts };
  let model = new card();
  let data = getInitialData(card);
  if (data) {
    if (dataIsDeserialized) {
      Object.assign(model, data);
    } else {
      for (let [fieldName, value] of Object.entries(data)) {
        serializedSet(model, fieldName, value);
      }
    }
  }
  await loadModel(model); // absorb model asynchronicity
  let set: Setter | undefined;
  if (format === 'edit') {
    set = makeSetter(model);
  }
  let component = getComponent(card, format, model, set);
  return { component };
}

async function loadModel<CardT extends Constructable>(model: InstanceType<CardT>): Promise<void> {
  for (let [fieldName, field] of Object.entries(getFields(model))) {
    let value = await loadField(model, fieldName);
    if (!(primitive in field)) {
      await loadModel(value);
    }
  }
}

async function loadField<CardT extends Constructable>(model: InstanceType<CardT>, fieldName: string): Promise<any> {
  let result;
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
      deserialized.set(fieldName, await model[computeVia]());
    }
  }
  return result;
}

function getField<CardT extends Constructable>(card: CardT, fieldName: string): Constructable | undefined {
  let obj = card.prototype;
  while (obj) {
    let desc = Reflect.getOwnPropertyDescriptor(obj, fieldName);
    let fieldCard = (desc?.get as any)?.[isField];
    if (fieldCard) {
      return fieldCard;
    }
    obj = Reflect.getPrototypeOf(obj);
  }
  return undefined
}

function getFields<CardT extends Constructable>(card: InstanceType<CardT>): { [fieldName: string]: Constructable } {
  let obj = Reflect.getPrototypeOf(card);
  let fields: { [fieldName: string]: Constructable } = {};
  while (obj?.constructor.name && obj.constructor.name !== 'Object') {
    let descs = Object.getOwnPropertyDescriptors(obj);
    let currentFields = flatMap(Object.keys(descs), maybeFieldName => {
      if (maybeFieldName !== 'constructor') {
        let maybeField = getField(card.constructor, maybeFieldName);
        if (maybeField) {
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

function fieldsComponentsFor<CardT extends Constructable>(target: object, model: InstanceType<CardT>, defaultFormat: Format, set?: Setter): FieldsTypeFor<CardT> {
  return new Proxy(target, {
    get(target, property, received) {
      if (typeof property === 'symbol') {
        // don't handle symbols
        return Reflect.get(target, property, received);
      }
      let field = getField(model.constructor, property);
      if (!field) {
        // field doesn't exist, fall back to normal property access behavior
        return Reflect.get(target, property, received);
      }
      // found field: get the corresponding component
      let innerModel = model[property];
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

function makeSetter(model: any, field?: string): Setter {
  let s = (value: any) => {
    debugger;
    if (!field) {
      throw new Error(`can't set topmost model`);
    }
    model[field] = value;
  };
  (s as any).setters = new Proxy(
    {},
    {
      get: (target: any, prop: string, receiver: unknown) => {
        if (typeof prop === 'string') {
          return makeSetter(field ? model[field] : model, prop);
        } else {
          return Reflect.get(target, prop, receiver);
        }
      },
    }
  );
  return s as Setter;
}
