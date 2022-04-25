import GlimmerComponent from '@glimmer/component';
import { ComponentLike } from '@glint/template';

export const primitive = Symbol('cardstack-primitive');
export const serialize = Symbol('cardstack-serialize');
export const deserialize = Symbol('cardstack-deserialize');

const isField = Symbol('cardstack-field');

type CardInstanceType<T extends Constructable> = T extends { [primitive]: infer P } ? P : InstanceType<T>;

type FieldsTypeFor<CardT extends Constructable> = {
  [Field in keyof InstanceType<CardT>]: (new() => GlimmerComponent<{ Args: {}, Blocks: {} }>) & FieldsTypeFor<InstanceType<CardT>[Field]>;
}

export type Format = 'isolated' | 'embedded' | 'edit';

const deserializedData = new WeakMap<object, Map<string, any>>();
const serializedData = new WeakMap<object, Map<string, any>>();

function getOrCreateDataBuckets<CardT extends Constructable>(instance: InstanceType<CardT>): { serialized: Map<string, any>, deserialized: Map<string, any> } {
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
  let { serialized, deserialized } = getOrCreateDataBuckets(model);
  let field = getField(model.constructor, fieldName);
  let value = serialized.get(fieldName); 
  if (value !== undefined) {
    return value;
  }
  value = deserialized.get(fieldName);
  if (typeof (field as any)[serialize] === 'function') {
    value = (field as any)[serialize](value);
  }
  serialized.set(fieldName, value);
  return value;
}

export function serializedSet<CardT extends Constructable>(model: InstanceType<CardT>, fieldName: string, value: any ) {
  let { serialized, deserialized } = getOrCreateDataBuckets(model);
  let field = getField(model.constructor, fieldName);
  if (!field) {
    throw new Error(`Field ${fieldName} does not exist on ${model.constructor.name}`);
  }

  if (primitive in field) {
    serialized.set(fieldName, value);
  } else {
    let instance = new field();
    Object.assign(instance, value);
    serialized.set(fieldName, instance);
  }
  deserialized.delete(fieldName);
}

export function contains<CardT extends Constructable>(card: CardT): CardInstanceType<CardT> {
  if (primitive in card) {
    return {
      setupField(_instance: InstanceType<CardT>, fieldName: string) {
        let get = function(this: InstanceType<CardT>) { 
          let { serialized, deserialized } = getOrCreateDataBuckets(this);
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
          set(value: any) {
            let { serialized, deserialized } = getOrCreateDataBuckets(this);
            deserialized.set(fieldName, value);
            serialized.delete(fieldName);
          }
        };
      }
    } as any;
  } else {
    return {
      setupField(_instance: InstanceType<CardT>, fieldName: string) {
        let instance = new card();
        let get = function(this: InstanceType<CardT>) {
          let { serialized, deserialized } = getOrCreateDataBuckets(this);
          let value = deserialized.get(fieldName); 
          if (value !== undefined) {
            return value;
          }
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
          set(value: any) {
            Object.assign(instance, value);
            let { serialized, deserialized } = getOrCreateDataBuckets(this);
            deserialized.set(fieldName, instance);
            serialized.delete(fieldName);
          }
        };
      }
    } as any
  }
}

// our decorators are implemented by Babel, not TypeScript, so they have a
// different signature than Typescript thinks they do.
export const field = function(target: object, key: string | symbol, { initializer }: { initializer(): any }) {
  return initializer().setupField(target, key);
} as unknown as PropertyDecorator;

export type Constructable = new(...args: any) => any;

type SignatureFor<CardT extends Constructable> = { Args: { model: CardInstanceType<CardT>; fields: FieldsTypeFor<CardT> } }

export class Component<CardT extends Constructable> extends GlimmerComponent<SignatureFor<CardT>> {

}

class DefaultIsolated extends GlimmerComponent<{ Args: { fields: Record<string, new() => GlimmerComponent>}}> {
  <template>
    {{#each-in @fields as |_key Field|}}
      <Field />
    {{/each-in}}
  </template>;
}
const defaultComponent = {
  embedded: <template><!-- Inherited from base card embedded view. Did your card forget to specify its embedded component? --></template>,
  isolated: DefaultIsolated,
  edit: <template></template>
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

function getComponent<CardT extends Constructable>(card: CardT, format: Format, model: InstanceType<CardT>): ComponentLike<{ Args: never, Blocks: never }> {
  let Implementation = (card as any)[format] ?? defaultComponent[format];

  // *inside* our own component, @fields is a proxy object that looks 
  // up our fields on demand. 
  let internalFields = fieldsComponentsFor({}, model, defaultFieldFormat(format));
  let component = <template>
    <Implementation @model={{model}} @fields={{internalFields}}/>
  </template>

  // when viewed from *outside*, our component is both an invokable component 
  // and a proxy that makes our fields available for nested invocation, like
  // <@fields.us.deeper />.
  //
  // It would be possible to use `externalFields` in place of `internalFields` above, 
  // avoiding the need for two separate Proxies. But that has the uncanny property of 
  // making `<@fields />` be an infinite recursion.
  let externalFields = fieldsComponentsFor(component, model, defaultFieldFormat(format));

  // This cast is safe because we're returning a proxy that wraps component.
  return externalFields as unknown as typeof component;
}

function getInitialData(card: Constructable): Record<string, any> | undefined {
  return (card as any).data;
}

export async function prepareToRender<CardT extends Constructable>(card: CardT, format: Format): Promise<{ component: ComponentLike<{ Args: never, Blocks: never }> }> {
  let model = new card();
  let data = getInitialData(card);
  if (data) {
    for (let [fieldName, value] of Object.entries(data)) {
      // we assume that static Card.data property is serialized data
      serializedSet(model, fieldName, value);
    }
  }
  let component = getComponent(card, format, model);
  return { component };
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

function fieldsComponentsFor<CardT extends Constructable>(target: object, model: InstanceType<CardT>, defaultFormat: Format): FieldsTypeFor<CardT> {
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
      return getComponent(field, defaultFormat, innerModel);
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
    }

  }) as any;
}