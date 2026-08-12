import {
  access,
  isSliceAccessor,
  normalizeLeadingSliceAccessors,
  Path,
  Type,
  typeOf,
} from './utils.js';
import { JqEvaluateError } from '../../errors.js';

export function getPath(input: any, path: Path): any {
  if (path.length === 0) return input;
  const type = typeOf(input);
  const normalizedPath = normalizeLeadingSliceAccessors(
    type === Type.array ? input.length : 0,
    path
  );

  const accessor = normalizedPath[0];
  if (input === undefined || input === null) {
    input = typeOf(accessor) === Type.string ? {} : [];
  }

  access(input, accessor);
  if (normalizedPath.length === 1) {
    if (isSliceAccessor(accessor)) {
      return input.slice(accessor.start, accessor.end);
    } else {
      return input[accessor] ?? null;
    }
  } else {
    if (isSliceAccessor(accessor)) {
      throw new JqEvaluateError(
        'getPath: Leading slice accessors are not normalized'
      );
    }
    return getPath(input[accessor], normalizedPath.slice(1));
  }
}
