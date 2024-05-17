import { primitive } from '@cardstack/runtime-common';
import { type BaseDefConstructor, type BaseDef } from './-base-def';
import { formatQuery, queryableValue } from './-constants';
import { assertScalar } from './-type-utils';
import { type Field } from './-fields/storage';

export function getQueryableValue(
  field: Field<typeof BaseDef>,
  value: any,
  stack?: BaseDef[],
): any;
export function getQueryableValue(
  fieldCard: typeof BaseDef,
  value: any,
  stack?: BaseDef[],
): any;
export function getQueryableValue(
  fieldOrCard: Field<typeof BaseDef> | typeof BaseDef,
  value: any,
  stack: BaseDef[] = [],
): any {
  if ('baseDef' in fieldOrCard) {
    let result = fieldOrCard[queryableValue](value, stack);
    if (primitive in fieldOrCard) {
      assertScalar(result, fieldOrCard);
    }
    return result;
  }
  return fieldOrCard.queryableValue(value, stack);
}

export function formatQueryValue(
  field: Field<typeof BaseDef>,
  queryValue: any,
): any {
  return field.card[formatQuery](queryValue);
}

export async function searchDoc<CardT extends BaseDefConstructor>(
  instance: InstanceType<CardT>,
): Promise<Record<string, any>> {
  return getQueryableValue(instance.constructor, instance) as Record<
    string,
    any
  >;
}
