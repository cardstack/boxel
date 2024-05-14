import { type BaseInstanceType, type BaseDef, cardThunk } from 'base-def';
import { type FieldDefConstructor } from 'field-def';
import { ContainsMany } from 'field-types/contains-many';
import { type FieldType } from 'field-types/utils';
import { initSharedState } from 'shared-state';

export const fieldDecorator = Symbol.for('cardstack-field-decorator');

const fieldDescription = Symbol.for('cardstack-field-description');
const fieldDescriptions = initSharedState(
  'fieldDescriptions',
  () => new WeakMap<typeof BaseDef, Map<string, string>>(),
);

interface Options {
  computeVia?: string | (() => unknown);
  description?: string;
  // there exists cards that we only ever run in the host without
  // the isolated renderer (RoomField), which means that we cannot
  // use the rendering mechanism to tell if a card is used or not,
  // in which case we need to tell the runtime that a card is
  // explictly being used.
  isUsed?: true;
}

// our decorators are implemented by Babel, not TypeScript, so they have a
// different signature than Typescript thinks they do.
export const field = function (
  target: BaseDef,
  key: string | symbol,
  { initializer }: { initializer(): any },
) {
  let descriptor = initializer().setupField(key);
  if (descriptor[fieldDescription]) {
    setFieldDescription(
      target.constructor,
      key as string,
      descriptor[fieldDescription],
    );
  }
  return descriptor;
} as unknown as PropertyDecorator;
(field as any)[fieldDecorator] = undefined;

export function containsMany<FieldT extends FieldDefConstructor>(
  field: FieldT,
  options?: Options,
): BaseInstanceType<FieldT>[] {
  return {
    setupField(fieldName: string) {
      return makeDescriptor(
        new ContainsMany(
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
containsMany[fieldType] = 'contains-many' as FieldType;

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

export function linksTo<CardT extends CardDefConstructor>(
  cardOrThunk: CardT | (() => CardT),
  options?: Options,
): BaseInstanceType<CardT> {
  return {
    setupField(fieldName: string) {
      return makeDescriptor(
        new LinksTo(
          cardThunk(cardOrThunk),
          options?.computeVia,
          fieldName,
          options?.description,
          options?.isUsed,
        ),
      );
    },
  } as any;
}
linksTo[fieldType] = 'linksTo' as FieldType;

export function linksToMany<CardT extends CardDefConstructor>(
  cardOrThunk: CardT | (() => CardT),
  options?: Options,
): BaseInstanceType<CardT>[] {
  return {
    setupField(fieldName: string) {
      return makeDescriptor(
        new LinksToMany(
          cardThunk(cardOrThunk),
          options?.computeVia,
          fieldName,
          options?.description,
          options?.isUsed,
        ),
      );
    },
  } as any;
}
linksToMany[fieldType] = 'linksToMany' as FieldType;

export function getFieldDescription(
  cardOrFieldKlass: typeof BaseDef,
  fieldName: string,
): string | undefined {
  let descriptionsMap = fieldDescriptions.get(cardOrFieldKlass);
  if (!descriptionsMap) {
    descriptionsMap = new Map();
    fieldDescriptions.set(cardOrFieldKlass, descriptionsMap);
  }
  return descriptionsMap.get(fieldName);
}

function setFieldDescription(
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

function makeDescriptor<
  CardT extends BaseDefConstructor,
  FieldT extends BaseDefConstructor,
>(field: Field<FieldT>) {
  let descriptor: any = {
    enumerable: true,
  };
  descriptor.get = function (this: BaseInstanceType<CardT>) {
    return field.getter(this);
  };
  if (field.computeVia) {
    descriptor.set = function () {
      // computeds should just no-op when an assignment occurs
    };
  } else {
    descriptor.set = function (this: BaseInstanceType<CardT>, value: any) {
      if (
        (field.card as typeof BaseDef) === IDField &&
        isCardInstance(this) &&
        this[isSavedInstance]
      ) {
        throw new Error(
          `cannot assign a value to the field '${
            field.name
          }' on the saved card '${
            (this as any)[field.name]
          }' because it is the card's identifier`,
        );
      }
      value = field.validate(this, value);
      let deserialized = getDataBucket(this);
      deserialized.set(field.name, value);
      // invalidate all computed fields because we don't know which ones depend on this one
      for (let computedFieldName of Object.keys(getComputedFields(this))) {
        if (deserialized.has(computedFieldName)) {
          let currentValue = deserialized.get(computedFieldName);
          if (!isStaleValue(currentValue)) {
            deserialized.set(computedFieldName, {
              type: 'stale',
              staleValue: currentValue,
            } as StaleValue);
          }
        }
      }
      notifySubscribers(this, field.name, value);
      logger.log(recompute(this));
    };
  }
  if (field.description) {
    (descriptor as any)[fieldDescription] = field.description;
  }
  (descriptor.get as any)[isField] = field;
  return descriptor;
}
