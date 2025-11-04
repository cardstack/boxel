import type {
  BaseDefConstructor,
  BaseInstanceType,
} from 'https://cardstack.com/base/card-api';
import { isAddress, getAddress } from 'ethers';

function isChecksumAddress(address: string): boolean {
  return getAddress(address) === address;
}

export function validate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (!isAddress(value)) {
    return 'Invalid Ethereum address';
  }

  if (!isChecksumAddress(value)) {
    return 'Not a checksummed address';
  }

  return null;
}

export function queryableValue(val: string | undefined): string | undefined {
  return val ? val : undefined;
}

export function serialize(val: string | null): string | undefined {
  return val ? val : undefined;
}

export function deserializeSync(address: any): string | null {
  if (address == null) {
    return null;
  }

  if (typeof address === 'string') {
    const validationError = validate(address);
    if (validationError) {
      return null;
    }
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
