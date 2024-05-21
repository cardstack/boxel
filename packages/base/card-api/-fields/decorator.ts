import { initSharedState } from '../../shared-state';
import {
  type BaseDefConstructor,
  type BaseDef,
  type BaseInstanceType,
} from '../-base-def';
import {
  fieldDecorator,
  fieldDescription,
  isSavedInstance,
} from '../-constants';
import {
  isCardInstance as _isCardInstance,
  isField,
} from '@cardstack/runtime-common';
import type CardDef from '../../card-def';
import {
  type Field,
  type StaleValue,
  getDataBucket,
  getFields,
  isStaleValue,
  recompute,
} from './storage';
import { IDField } from '../../id';
import { notifySubscribers } from '../-subscriptions';
import { logger } from '../-logger';

const fieldDescriptions = initSharedState(
  'fieldDescriptions',
  () => new WeakMap<typeof BaseDef, Map<string, string>>(),
);

// The typescript `is` type here refuses to work unless it's in this file.
function isCardInstance(instance: any): instance is CardDef {
  return _isCardInstance(instance);
}

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

export function makeDescriptor<
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
