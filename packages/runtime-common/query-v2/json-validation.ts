import { refuse } from './query-refusals.ts';

// Anything `JSON.parse` can produce, which is the same standard
// `assertJSONValue` below holds a value to at run time.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export function assertJSONValue(v: any, pointer: string[]) {
  if (v === null) {
    return;
  }
  switch (typeof v) {
    case 'string':
    case 'number':
    case 'boolean':
      return;
    case 'object':
      // A container is JSON only if all of it is, so every element and every
      // entry is checked at every level of recursion.
      if (Array.isArray(v)) {
        v.forEach((value, index) => {
          assertJSONValue(value, pointer.concat(`[${index}]`));
        });
      } else {
        Object.entries(v).forEach(([key, value]) => {
          assertJSONValue(value, pointer.concat(key));
        });
      }
      return;
  }
  throw refuse('value-allowed-json', undefined, { value0: pointer.join('/') });
}

export function assertJSONPrimitive(p: any, pointer: string[]) {
  if (p === null) {
    return;
  }
  switch (typeof p) {
    case 'string':
    case 'number':
    case 'boolean':
      return;
    default:
      throw refuse('json-primitive-must-type', undefined, {
        value0: pointer.join('/'),
      });
  }
}
