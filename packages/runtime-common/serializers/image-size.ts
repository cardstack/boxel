import type {
  BaseDefConstructor,
  BaseInstanceType,
} from 'https://cardstack.com/base/card-api';

export function queryableValue(
  val: 'actual' | 'contain' | 'cover' | undefined,
): string | undefined {
  return val;
}

export function serialize(
  val: 'actual' | 'contain' | 'cover' | null,
): string | undefined {
  return val ? val : undefined;
}

export function deserializeSync(
  val: any,
): 'actual' | 'contain' | 'cover' | null {
  if (val === undefined || val === null) {
    return 'actual';
  }
  return val;
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  val: any,
): Promise<BaseInstanceType<T>> {
  return deserializeSync(val) as BaseInstanceType<T>;
}
