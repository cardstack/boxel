import {
  type BaseDefConstructor,
  type BaseInstanceType,
} from 'https://cardstack.com/base/card-api';

export function queryableValue(val: string | undefined): string | undefined {
  return val ? val : undefined;
}

export function serialize(val: string | null): string | undefined {
  return val ? val : undefined;
}

export function deserializeSync(address: any): string | null {
  if (!address) {
    return null;
  }

  if (typeof address === 'string') {
    return address;
  }

  return null;
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  address: any,
): Promise<BaseInstanceType<T>> {
  return deserializeSync(address) as BaseInstanceType<T>;
}
