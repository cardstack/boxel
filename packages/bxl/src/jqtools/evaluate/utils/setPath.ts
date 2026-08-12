import type { Path } from './utils.ts';
import {
  access,
  isSliceAccessor,
  normalizeLeadingSliceAccessors,
  shallowClone,
  Type,
  typeOf,
} from './utils.ts';
import { JqEvaluateError } from '../../errors.ts';

export function setPath(input: any, path: Path, value: any) {
  if (path.length === 0) return value;
  const type = typeOf(input);
  const normalizedPath = normalizeLeadingSliceAccessors(
    type === Type.array ? input.length : 0,
    path,
  );
  const accessor = normalizedPath[0];
  const clone =
    input === undefined || input === null
      ? typeOf(accessor) === Type.string
        ? {}
        : []
      : shallowClone(input);
  access(clone, accessor);
  if (normalizedPath.length === 1) {
    if (isSliceAccessor(accessor)) {
      if (typeOf(value) !== Type.array) {
        throw new JqEvaluateError(
          `An array slice can only be assigned an array`,
        );
      }
      clone.splice(accessor.start, accessor.end - accessor.start, ...value);
    } else {
      clone[accessor] = value;
    }
  } else {
    if (isSliceAccessor(accessor)) {
      throw new JqEvaluateError(
        'setPath: Leading slice accessors are not normalized',
      );
    }
    clone[accessor] = setPath(clone[accessor], normalizedPath.slice(1), value);
  }
  return clone;
}
