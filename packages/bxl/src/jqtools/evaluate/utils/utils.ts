import { JqEvaluateError } from '../../errors.js';
import { cannotIndexError, cannotSliceError } from '../evaluateErrors.js';
import { compare } from '../compare.js';

export type EvaluateInput<T = any> = IterableIterator<T> | T[];
export type EvaluateOutput<T = any> = IterableIterator<T>;

export type PathItem = string | number | SliceAccessor;
export type Path = PathItem[];

export type SliceAccessor = { start: number | null; end: number | null };
export type NormalizedSliceAccessor = { start: number; end: number };

export function createSliceAccessor(
  start: number | null,
  end: number | null
): SliceAccessor {
  return { start, end };
}

export function isSliceAccessor(val: any): val is SliceAccessor {
  return (
    val &&
    (val.start === null || Number.isInteger(val.start)) &&
    (val.end === null || Number.isInteger(val.end))
  );
}

export interface Item<T = any> {
  value: T;
  path: Path;
}

export type ItemIterator<T = any> = IterableIterator<Item<T>>;

export function createItem(value: any, path: Path = []) {
  return { value, path };
}

export function* generateItems(values: IterableIterator<any> | any[]) {
  for (const value of values) {
    yield createItem(value);
  }
}

export function* generateValues(items: ItemIterator | Item[]) {
  for (const item of items) {
    yield item.value;
  }
}

export function* generatePaths(items: ItemIterator | Item[]) {
  for (const item of items) {
    yield item.path;
  }
}

export function collectValues(items: ItemIterator | Item[]) {
  return Array.from(generateValues(items));
}

export enum Type {
  null = 'null',
  boolean = 'boolean',
  number = 'number',
  string = 'string',
  array = 'array',
  object = 'object',
}

export function typeOf(value: any): Type {
  if (Array.isArray(value)) return Type.array;
  if (value === null) return Type.null;
  return typeof value as Type;
}

export function isAtom(value: any) {
  const type = typeOf(value);
  return type !== 'array' && type !== 'object';
}

export function typesEqual(a: any, b: any) {
  return typeOf(a) === typeOf(b);
}

export function typesMatch(a: any, b: any, typeA: Type, typeB: Type = typeA) {
  return typeOf(a) === typeA && typeOf(b) === typeB;
}

export function typesMatchCommutative(
  a: any,
  b: any,
  typeA: Type,
  typeB: Type
) {
  return typesMatch(a, b, typeA, typeB) || typesMatch(a, b, typeB, typeA);
}

export function typeIsOneOf(val: any, ...types: Type[]) {
  return types.some((type) => typeOf(val) === type);
}

export function someOfType(type: Type, ...args: any[]) {
  return args.some((arg) => typeOf(arg) === type);
}

export function* single<T>(val: T): IterableIterator<T> {
  yield val;
}

export function* many<T>(val: T[]): IterableIterator<T> {
  yield* val;
}

export function isPath(val: any): val is Path {
  return (
    Array.isArray(val) &&
    val.every((item: PathItem) => {
      switch (typeof item) {
        case 'string':
          return true;
        case 'number':
          return Number.isInteger(item);
        case 'object':
          return isSliceAccessor(item);
        default:
          return false;
      }
    })
  );
}

export function isPaths(val: any): val is Path[] {
  return Array.isArray(val) && val.every((item) => isPath(item));
}

export function isTrue(val: any): boolean {
  return val !== null && val !== false;
}

export function repeatString(str: string, num: number): string | null {
  if (num <= 0) {
    return null;
  }
  let out = '';
  for (let i = 0; i < Math.floor(num); i++) {
    out += str;
  }

  return out;
}

export function* recursiveDescent(val: any): IterableIterator<any> {
  yield val;
  if (typeOf(val) === 'object') {
    for (const child of Object.values(val)) {
      yield* recursiveDescent(child);
    }
  } else if (typeOf(val) === 'array') {
    for (const child of val) {
      yield* recursiveDescent(child);
    }
  }
}

export function toString(val: any): string {
  switch (typeOf(val)) {
    case Type.null:
      return 'null';
    case Type.boolean:
    case Type.number:
      return val.toString();
    case Type.string:
      return val;
    case Type.array:
    case Type.object:
      return JSON.stringify(val);
  }
}

export function indices<T extends string | any[]>(
  haystack: T,
  needle: T
): number[] {
  // TODO optimize
  const out: number[] = [];
  for (let i = 0; i < haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (compare(haystack[i + j], needle[j]) !== 0) break;
      if (j + 1 === needle.length) {
        out.push(i);
      }
    }
  }
  return out;
}

export function access(val: any, index: PathItem | any[]) {
  if (typesMatch(index, val, Type.number, Type.array)) {
    return val[normalizeArrayIndex(val.length, index as number)] ?? null;
  } else if (typesMatch(index, val, Type.string, Type.object)) {
    return val[index as string] ?? null;
  } else if (typesMatch(index, val, Type.array, Type.array)) {
    return indices(val, index as any[]);
  } else if (
    typeOf(val) === Type.null &&
    (typeIsOneOf(index, Type.number, Type.string) || isSliceAccessor(index))
  ) {
    return null;
  } else if (
    typeIsOneOf(val, Type.array, Type.string) &&
    isSliceAccessor(index)
  ) {
    return val.slice(index.start ?? undefined, index.end ?? undefined);
  } else {
    if (isSliceAccessor(index)) {
      throw cannotSliceError(val);
    }
    throw cannotIndexError(val, index);
  }
}

export function normalizeArrayIndex(arrayLength: number, index: number) {
  return index < 0 ? arrayLength + index : index;
}

export function normalizeSliceAccessor(
  arrayLength: number,
  sliceAccessor: SliceAccessor
): NormalizedSliceAccessor {
  const { start, end } = sliceAccessor;
  const newEnd = Math.max(
    0,
    Math.min(normalizeArrayIndex(arrayLength, end ?? arrayLength), arrayLength)
  );
  const newStart = Math.max(
    0,
    Math.min(normalizeArrayIndex(arrayLength, start ?? 0), newEnd)
  );

  return {
    start: newStart,
    end: newEnd,
  };
}

type PathWithNormalizedLeadingSliceAccessors =
  | [Exclude<PathItem, SliceAccessor>, ...Path]
  | [NormalizedSliceAccessor];
// TODO test
export function normalizeLeadingSliceAccessors(
  arrayLength: number,
  path: Path
): PathWithNormalizedLeadingSliceAccessors {
  if (!isSliceAccessor(path[0])) {
    return path as any;
  }

  let pos = 1;
  let accessor: NormalizedSliceAccessor = normalizeSliceAccessor(
    arrayLength,
    path[0]
  );
  while (isSliceAccessor(path[pos])) {
    arrayLength = accessor.end - accessor.start;
    const next = normalizeSliceAccessor(arrayLength, path[pos] as any);
    accessor = {
      start: accessor.start + next.start,
      end: accessor.start + next.end,
    };
    pos++;
  }
  if (pos < path.length) {
    const next = path[pos];
    if (typeof next !== 'number') {
      throw cannotIndexError([], next);
    }

    return [accessor.start + next, ...path.slice(pos + 1)];
  } else {
    return [accessor];
  }
}

export function resolveNormalizedSliceAccessor(
  accessor: NormalizedSliceAccessor
): number[] {
  const out: number[] = [];
  for (let i = accessor.start; i < accessor.end; i++) {
    out.push(i);
  }
  return out;
}

function pathItemsEqual(a: PathItem, b: PathItem): boolean {
  if (typeof a === 'string' || typeof a === 'number') {
    return a === b;
  }

  return (
    isSliceAccessor(a) &&
    isSliceAccessor(b) &&
    a.start === b.start &&
    a.end === b.end
  );
}

export function pathStartsWith(path: Path, prefix: Path): boolean {
  return (
    prefix.length <= path.length &&
    prefix.every((item, index) => pathItemsEqual(path[index], item))
  );
}

export function relativizePath(path: Path, prefix: Path): Path {
  return pathStartsWith(path, prefix) ? path.slice(prefix.length) : path;
}

export function deepMerge(a: any, b: any): any {
  if (typesMatch(a, b, Type.object, Type.object)) {
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    const entries: [string, any][] = [];
    for (const key of keys) {
      entries.push([key, deepMerge(a[key], b[key])]);
    }
    return Object.fromEntries(entries);
  } else {
    return b === undefined ? a : b;
  }
}

export function deepClone<T>(value: T): T {
  switch (typeOf(value)) {
    case Type.null:
    case Type.boolean:
    case Type.number:
    case Type.string:
      return value;
    case Type.array:
      return (value as unknown as any[]).map(deepClone) as any;
    case Type.object:
      return Object.fromEntries(
        (Object.entries(value as any) as [string, any][]).map(([k, v]) => [
          k,
          deepClone(v),
        ]),
      ) as any;
  }
}

export function shallowClone<T>(value: T): T {
  switch (typeOf(value)) {
    case Type.null:
    case Type.boolean:
    case Type.number:
    case Type.string:
      return value;
    case Type.array:
      return [...(value as unknown as any[])] as any;
    case Type.object:
      return { ...value } as any;
  }
}

export function getChildPaths(paths: Path[]): Record<string, Path[]> {
  const out: Record<string, Path[]> = {};
  for (const path of paths.filter((path) => path.length > 1)) {
    const accessor = path[0];
    if (isSliceAccessor(accessor)) {
      // If this error is thrown, either the normalizeLeadingSliceAccessors
      // function was not applied on each of the input paths,
      // or it does not work properly
      throw new JqEvaluateError(
        'getChildPaths: Cannot handle paths that are longer than 1, and start in a slice accessor'
      );
    }

    if (!(accessor in out)) out[accessor] = [];
    out[accessor].push(path.slice(1));
  }

  return out;
}

export function delPaths(value: any, paths: Path[]) {
  if (paths.length === 0) return value;
  const type = typeOf(value);
  if (typeIsOneOf(value, Type.array, Type.object)) {
    let clone = shallowClone(value);
    const normalizedPaths = paths.map((path) =>
      normalizeLeadingSliceAccessors(
        typeOf(value) === Type.array ? value.length : 0,
        path
      )
    );
    for (const path of normalizedPaths) {
      if (path.length !== 1) continue;
      const accessor = path[0];
      access(clone, accessor);
      if (isSliceAccessor(accessor)) {
        const normalizedAccessor = normalizeSliceAccessor(
          value.length,
          accessor
        );
        for (const key of resolveNormalizedSliceAccessor(normalizedAccessor)) {
          delete clone[key];
        }
      } else {
        delete clone[accessor];
      }
    }
    if (type === Type.array)
      clone = clone.filter((item: any) => item !== undefined);

    for (const [key, childPaths] of Object.entries(
      getChildPaths(normalizedPaths)
    )) {
      if (key in clone) clone[key] = delPaths(clone[key], childPaths);
    }
    return clone;
  } else {
    throw new JqEvaluateError(`Cannot delete fields from ${type}`);
  }
}

export function range(upto: number): IterableIterator<number>;
export function range(from: number, upto: number): IterableIterator<number>;
export function range(
  from: number,
  upto: number,
  by: number
): IterableIterator<number>;
export function* range(
  a: number,
  b?: number,
  c?: number
): IterableIterator<number> {
  let from: number, upto: number, by: number;
  if (b !== undefined && c !== undefined) {
    from = assertNumber(a);
    upto = assertNumber(b);
    by = assertNumber(c);
  } else if (b !== undefined) {
    from = assertNumber(a);
    upto = assertNumber(b);
    by = 1;
  } else {
    from = 0;
    upto = assertNumber(a);
    by = 1;
  }

  for (let i = from; i < upto; i += by) {
    yield i;
  }
}

export function assertNumber(value: any): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeOf(value) !== Type.number) {
    throw new JqEvaluateError(`Got ${typeOf(value)}, number expected`);
  }
  return value;
}

export function assertString(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeOf(value) !== Type.string) {
    throw new JqEvaluateError(`Got ${typeOf(value)}, string expected`);
  }
  return value;
}

export function keys(value: any[] | Record<string, any>) {
  if (!typeIsOneOf(value, Type.array, Type.object)) {
    throw new JqEvaluateError(`${typeOf(value)} has no keys`);
  }
  if (typeOf(value) === Type.array) {
    return Array.from(range(value.length));
  }
  return Object.keys(value);
}

export function has(value: any[] | Record<string, any>, key: string | number) {
  if (
    !typesMatch(value, key, Type.array, Type.number) &&
    !typesMatch(value, key, Type.object, Type.string)
  ) {
    throw new JqEvaluateError(
      `Cannot check whether ${typeOf(value)} has a ${typeOf(key)} key`
    );
  }
  return key in value;
}

export function sort(values: any[]) {
  return values.sort(compare);
}

interface JqRegExpMatch {
  offset: number;
  length: number;
  string: string;
  captures: {
    offset: number;
    length: number;
    string: string;
    name: string | null;
  }[];
}

export function transformRegExpMatch(match: RegExpMatchArray): JqRegExpMatch {
  const indices: [number, number][] | undefined = (match as any).indices;
  if (match.index === undefined || indices === undefined)
    throw new JqEvaluateError('RegExp match item transformation error');
  const offset = match.index;
  return {
    offset,
    length: match[0].length,
    string: match[0],
    captures: match.slice(1).map((item, i) => ({
      offset: indices[i + 1][0],
      length: item.length,
      string: item,
      name: null,
    })),
  };
}
