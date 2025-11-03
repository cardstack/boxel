import { parsePhoneNumber } from 'awesome-phonenumber';
import type {
  BaseDefConstructor,
  BaseInstanceType,
} from 'https://cardstack.com/base/card-api';

export function queryableValue(value: unknown): string | undefined {
  let normalized = deserializeSync(value);
  return normalized ?? undefined;
}

export function serialize(value: unknown): string | null {
  return deserializeSync(value);
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  value: unknown,
): Promise<BaseInstanceType<T>> {
  return deserializeSync(value) as BaseInstanceType<T>;
}

export function deserializeSync(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  let trimmed = value.trim();
  if (!trimmed || trimmed === '') {
    return null;
  }

  try {
    let parsed = parsePhoneNumber(trimmed);
    if (parsed.valid && parsed.number?.e164) {
      return parsed.number.e164;
    }
  } catch (error) {
    console.error('Error parsing phone number', { value, error });
    return null;
  }

  return null;
}
