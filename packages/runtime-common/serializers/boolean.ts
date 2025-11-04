import type {
  BaseDefConstructor,
  BaseInstanceType,
} from 'https://cardstack.com/base/card-api';

export function queryableValue(val: any): boolean {
  return asBoolean(val);
}

export function serialize(val: any): boolean {
  return Boolean(val);
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  val: any,
): Promise<BaseInstanceType<T>> {
  if (val === undefined || val === null) {
    return false as BaseInstanceType<T>;
  }
  return Boolean(val) as BaseInstanceType<T>;
}

export function formatQuery(val: any): boolean {
  return asBoolean(val);
}

function asBoolean(val: any): boolean {
  if (typeof val === 'string') {
    return val.toLowerCase() === 'true';
  }
  return Boolean(val);
}
