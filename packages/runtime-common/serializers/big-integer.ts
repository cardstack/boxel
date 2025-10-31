import type {
  BaseDefConstructor,
  BaseInstanceType,
} from 'https://cardstack.com/base/card-api';

export function queryableValue(val: bigint | undefined): string | undefined {
  return val == null ? undefined : String(val);
}

export function serialize(val: bigint | null): string | undefined {
  return val == null ? undefined : String(val);
}

export function deserializeSync(bigintString: any): bigint | null {
  if (bigintString == null) {
    return null;
  }

  if (typeof bigintString === 'bigint') {
    return bigintString;
  }

  if (typeof bigintString === 'number' || typeof bigintString === 'string') {
    try {
      return BigInt(bigintString);
    } catch {
      return null;
    }
  }

  return null;
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  bigintString: any,
): Promise<BaseInstanceType<T>> {
  return deserializeSync(bigintString) as BaseInstanceType<T>;
}
