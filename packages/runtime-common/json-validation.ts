import { InvalidQueryError } from './invalid-query-error.ts';

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
      // Every element and every entry is checked, at every level of
      // recursion — a container is JSON only if all of it is. `forEach` is
      // what makes that so: these callbacks report a failure by throwing and
      // return nothing, so `every` would read the first `undefined` as false
      // and stop, leaving the rest of the subtree unchecked.
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
  throw new InvalidQueryError(
    `${pointer.join('/')}: value not allowed in json`,
  );
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
      throw new InvalidQueryError(
        `${pointer.join(
          '/',
        )}: JSON primitive must be of type string, number, boolean, or null`,
      );
  }
}
