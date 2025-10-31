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

//  TODO: email format validation
/** boxel-ui/helpers/validate-email-format.ts handles basic client-side
 * validation, however a more comprehensive server-side validation is needed
 */
export function deserializeSync(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  let trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  return trimmed;
}
