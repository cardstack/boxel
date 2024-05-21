import { isBaseInstance } from './-constants';
import { primitive } from '@cardstack/runtime-common';
import { type BaseDef } from './-base-def';
import { type Field } from './-fields/storage';
import { type Box } from './-box';
import type CardDef from '../card-def';
import type FieldDef from '../field-def';

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

export function cardTypeFor(
  field: Field<typeof BaseDef>,
  boxedElement: Box<BaseDef>,
): typeof BaseDef {
  if (primitive in field.card) {
    return field.card;
  }
  return Reflect.getPrototypeOf(boxedElement.value)!
    .constructor as typeof BaseDef;
}
