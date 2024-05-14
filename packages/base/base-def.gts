import { type Format, primitive, getField } from '@cardstack/runtime-common';
import GlimmerComponent from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import { type BoxComponent } from 'field-types/field-component';
import { type Field } from 'field-types/utils';

export const isBaseInstance = Symbol.for('isBaseInstance');

export type BaseInstanceType<T extends BaseDefConstructor> = T extends {
  [primitive]: infer P;
}
  ? P
  : InstanceType<T>;
export type PartialBaseInstanceType<T extends BaseDefConstructor> = T extends {
  [primitive]: infer P;
}
  ? P | null
  : Partial<InstanceType<T>>;
export type FieldsTypeFor<T extends BaseDef> = {
  [Field in keyof T]: BoxComponent &
    (T[Field] extends ArrayLike<unknown>
      ? BoxComponent[]
      : T[Field] extends BaseDef
      ? FieldsTypeFor<T[Field]>
      : unknown);
};

type Setter = (value: any) => void;

export type SignatureFor<CardT extends BaseDefConstructor> = {
  Args: {
    model: PartialBaseInstanceType<CardT>;
    fields: FieldsTypeFor<InstanceType<CardT>>;
    set: Setter;
    fieldName: string | undefined;
    context?: CardContext;
  };
};

export class Component<
  CardT extends BaseDefConstructor,
> extends GlimmerComponent<SignatureFor<CardT>> {}

export type BaseDefComponent = ComponentLike<{
  Blocks: {};
  Element: any;
  Args: {
    cardOrField: typeof BaseDef;
    fields: any;
    format: Format;
    model: any;
    set: Setter;
    fieldName: string | undefined;
    context?: CardContext;
  };
}>;

// TODO: consider making this abstract
export class BaseDef {
  // this is here because CardBase has no public instance methods, so without it
  // typescript considers everything a valid card.
  [isBaseInstance] = true;
  // [relativeTo] actually becomes really important for Card/Field separation. FieldDefs
  // may contain interior fields that have relative links. FieldDef's though have no ID.
  // So we need a [relativeTo] property that derives from the root document ID in order to
  // resolve relative links at the FieldDef level.
  [relativeTo]: URL | undefined = undefined;
  declare ['constructor']: BaseDefConstructor;
  static baseDef: undefined;
  static data?: Record<string, any>; // TODO probably refactor this away all together
  static displayName = 'Base';

  static getDisplayName(instance: BaseDef) {
    return instance.constructor.displayName;
  }

  static [serialize](
    value: any,
    doc: JSONAPISingleResourceDocument,
    visited?: Set<string>,
    opts?: SerializeOpts,
  ): any {
    // note that primitive can only exist in field definition
    if (primitive in this) {
      // primitive cards can override this as need be
      return value;
    } else {
      return serializeCardResource(value, doc, opts, visited);
    }
  }

  static [formatQuery](value: any): any {
    if (primitive in this) {
      return value;
    }
    throw new Error(`Cannot format query value for composite card/field`);
  }

  static [queryableValue](value: any, stack: BaseDef[] = []): any {
    if (primitive in this) {
      return value;
    } else {
      if (value == null) {
        return null;
      }
      if (stack.includes(value)) {
        return { id: value.id };
      }
      return Object.fromEntries(
        Object.entries(
          getFields(value, { includeComputeds: true, usedFieldsOnly: true }),
        ).map(([fieldName, field]) => {
          let rawValue = peekAtField(value, fieldName);
          if (field?.fieldType === 'linksToMany') {
            return [
              fieldName,
              field.queryableValue(rawValue, [value, ...stack]),
            ];
          }
          if (isNotLoadedValue(rawValue)) {
            return [fieldName, { id: rawValue.reference }];
          }
          return [
            fieldName,
            getQueryableValue(field!, value[fieldName], [value, ...stack]),
          ];
        }),
      );
    }
  }

  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    data: any,
    relativeTo: URL | undefined,
    doc?: CardDocument,
    identityContext?: IdentityContext,
  ): Promise<BaseInstanceType<T>> {
    if (primitive in this) {
      // primitive cards can override this as need be
      return data;
    }
    return _createFromSerialized(this, data, doc, relativeTo, identityContext);
  }

  static getComponent(card: BaseDef, field?: Field) {
    return getComponent(card, field);
  }

  static assignInitialFieldValue(
    instance: BaseDef,
    fieldName: string,
    value: any,
  ) {
    (instance as any)[fieldName] = value;
  }

  constructor(data?: Record<string, any>) {
    if (data !== undefined) {
      for (let [fieldName, value] of Object.entries(data)) {
        this.constructor.assignInitialFieldValue(this, fieldName, value);
      }
    }
  }
}

export type BaseDefConstructor = typeof BaseDef;

function peekAtField(instance: BaseDef, fieldName: string): any {
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

function getComputedFields<T extends BaseDef>(
  card: T,
): { [P in keyof T]?: Field<BaseDefConstructor> } {
  let fields = Object.entries(getFields(card, { includeComputeds: true })) as [
    string,
    Field<BaseDefConstructor>,
  ][];
  let computedFields = fields.filter(([_, field]) => field.computeVia);
  return Object.fromEntries(computedFields) as {
    [P in keyof T]?: Field<BaseDefConstructor>;
  };
}

function getter<CardT extends BaseDefConstructor>(
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

export function cardThunk<CardT extends BaseDefConstructor>(
  cardOrThunk: CardT | (() => CardT),
): () => CardT {
  if (!cardOrThunk) {
    throw new Error(
      `cardOrThunk was ${cardOrThunk}. There might be a cyclic dependency in one of your fields.
      Use '() => CardName' format for the fields with the cycle in all related cards.
      e.g.: '@field friend = linksTo(() => Person)'`,
    );
  }
  return (
    'baseDef' in cardOrThunk ? () => cardOrThunk : cardOrThunk
  ) as () => CardT;
}
