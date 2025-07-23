import {
  type BaseDefConstructor,
  type BaseInstanceType,
} from 'https://cardstack.com/base/card-api';

export function queryableValue(val: string | undefined): string | undefined {
  return val;
}

export function serialize(val: string | null): string | undefined {
  return val ? val : undefined;
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  val: any,
): Promise<BaseInstanceType<T>> {
  return val as BaseInstanceType<T>;
}
