import {
  type FieldType,
  type JSONAPISingleResourceDocument,
  type JSONAPIResource,
  fieldType,
  queryableValue,
  deserialize,
} from '../-constants';
import { cardThunk, type BaseInstanceType, type BaseDef } from '../-base-def';
import { type FieldDefConstructor } from '../-field-def';
import { makeDescriptor } from './decorator';
import { cardClassFromResource, type Options } from './utils';
import { getter, type Field } from './storage';
import { callSerializeHook } from '../-serialization';
import {
  primitive,
  type CardDocument,
  type CardFields,
  type LooseCardResource,
  type Meta,
  type NotLoaded,
  type Relationship,
} from '@cardstack/runtime-common';
import { makeMetaForField } from '../-serialization';
import { type Box } from '../-box';
import { assertScalar } from '../-type-utils';
import {
  fieldComponent,
  type BoxComponent,
} from '../-components/field-component';

export function contains<FieldT extends FieldDefConstructor>(
  field: FieldT,
  options?: Options,
): BaseInstanceType<FieldT> {
  return {
    setupField(fieldName: string) {
      return makeDescriptor(
        new Contains(
          cardThunk(field),
          options?.computeVia,
          fieldName,
          options?.description,
          options?.isUsed,
        ),
      );
    },
  } as any;
}
contains[fieldType] = 'contains' as FieldType;

class Contains<CardT extends FieldDefConstructor> implements Field<CardT, any> {
  readonly fieldType = 'contains';
  constructor(
    private cardThunk: () => CardT,
    readonly computeVia: undefined | string | (() => unknown),
    readonly name: string,
    readonly description: string | undefined,
    readonly isUsed: undefined | true,
  ) {}

  get card(): CardT {
    return this.cardThunk();
  }

  getter(instance: BaseDef): BaseInstanceType<CardT> {
    return getter(instance, this);
  }

  queryableValue(instance: any, stack: BaseDef[]): any {
    if (primitive in this.card) {
      let result = this.card[queryableValue](instance, stack);
      assertScalar(result, this.card);
      return result;
    }
    if (instance == null) {
      return null;
    }
    return this.card[queryableValue](instance, stack);
  }

  serialize(
    value: InstanceType<CardT>,
    doc: JSONAPISingleResourceDocument,
  ): JSONAPIResource {
    let serialized: JSONAPISingleResourceDocument['data'] & {
      meta: Record<string, any>;
    } = callSerializeHook(this.card, value, doc);
    if (primitive in this.card) {
      return { attributes: { [this.name]: serialized } };
    } else {
      let resource: JSONAPIResource = {
        attributes: {
          [this.name]: serialized?.attributes,
        },
      };
      if (serialized == null) {
        return resource;
      }
      if (serialized.relationships) {
        resource.relationships = {};
        for (let [fieldName, relationship] of Object.entries(
          serialized.relationships as Record<string, Relationship>,
        )) {
          resource.relationships[`${this.name}.${fieldName}`] = relationship;
        }
      }

      if (this.card === Reflect.getPrototypeOf(value)!.constructor) {
        // when our implementation matches the default we don't need to include
        // meta.adoptsFrom
        delete serialized.meta.adoptsFrom;
      }

      if (Object.keys(serialized.meta).length > 0) {
        resource.meta = {
          fields: { [this.name]: serialized.meta },
        };
      }
      return resource;
    }
  }

  async deserialize(
    value: any,
    doc: CardDocument,
    relationships: JSONAPIResource['relationships'] | undefined,
    fieldMeta: CardFields[string] | undefined,
    _identityContext: undefined,
    _instancePromise: Promise<BaseDef>,
    _loadedValue: any,
    relativeTo: URL | undefined,
  ): Promise<BaseInstanceType<CardT>> {
    if (primitive in this.card) {
      return this.card[deserialize](value, relativeTo, doc);
    }
    if (fieldMeta && Array.isArray(fieldMeta)) {
      throw new Error(
        `fieldMeta for contains field '${
          this.name
        }' is an array: ${JSON.stringify(fieldMeta, null, 2)}`,
      );
    }
    let meta: Partial<Meta> | undefined = fieldMeta;
    let resource: LooseCardResource = {
      attributes: value,
      meta: makeMetaForField(meta, this.name, this.card),
    };
    if (relationships) {
      resource.relationships = Object.fromEntries(
        Object.entries(relationships)
          .filter(([fieldName]) => fieldName.startsWith(`${this.name}.`))
          .map(([fieldName, relationship]) => [
            fieldName.startsWith(`${this.name}.`)
              ? fieldName.substring(this.name.length + 1)
              : fieldName,
            relationship,
          ]),
      );
    }
    return (await cardClassFromResource(resource, this.card, relativeTo))[
      deserialize
    ](resource, relativeTo, doc);
  }

  emptyValue(_instance: BaseDef) {
    if (primitive in this.card) {
      return undefined;
    } else {
      return new this.card();
    }
  }

  validate(_instance: BaseDef, value: any) {
    if (primitive in this.card) {
      // todo: primitives could implement a validation symbol
    } else {
      if (value != null && !(value instanceof this.card)) {
        throw new Error(
          `tried set ${value} as field ${this.name} but it is not an instance of ${this.card.name}`,
        );
      }
    }
    return value;
  }

  async handleNotLoadedError<T extends BaseDef>(instance: T, _e: NotLoaded) {
    throw new Error(
      `cannot load missing field for non-linksTo or non-linksToMany field ${instance.constructor.name}.${this.name}`,
    );
  }

  component(model: Box<BaseDef>): BoxComponent {
    return fieldComponent(this, model);
  }
}
