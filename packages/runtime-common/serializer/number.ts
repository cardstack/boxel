import {
  type BaseDefConstructor,
  type BaseInstanceType,
} from 'https://cardstack.com/base/card-api';

export function queryableValue(val: number | undefined): string | undefined {
  if (val != null && val === 0) {
    return val.toString();
  }
  return val ? val.toString() : undefined;
}

export function serialize(val: number | null): string | undefined {
  if (val != null && val === 0) {
    return val.toString();
  }
  return val ? val.toString() : undefined;
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  number: any,
): Promise<BaseInstanceType<T>> {
  return deserializeSync(number) as BaseInstanceType<T>;
}

export function deserializeSync(number: any): number | null {
  if (number == null || number === '') {
    return null;
  }

  if (typeof number === 'number') {
    return number;
  }

  if (typeof number === 'string') {
    const parsed = Number(number);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}
