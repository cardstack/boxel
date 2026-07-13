import type {
  BaseDefConstructor,
  BaseInstanceType,
} from '@cardstack/base/card-api';

/**
 * A migration serializer for composite fields that replace a primitive
 * StringField where the string value maps to a `content` sub-field.
 *
 * Deserialization accepts either:
 *   - a plain string (old format) → normalizes to `{ content: <string> }`
 *   - an object (new format) → passes through as-is
 *
 * Serialization and queryableValue delegate to the default composite behavior
 * (this serializer is only needed for the deserialization migration path).
 */

export function serialize(val: any): any {
  return val;
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  val: any,
): Promise<BaseInstanceType<T>> {
  if (typeof val === 'string') {
    return { content: val } as BaseInstanceType<T>;
  }
  if (val == null) {
    return {} as BaseInstanceType<T>;
  }
  return val;
}

export function queryableValue(val: any): any {
  return val;
}
