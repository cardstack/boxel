import {
  assertNumber,
  assertString,
  createItem,
  delPaths,
  has,
  isPath,
  indices,
  isPaths,
  isTrue,
  keys,
  range,
  sort,
  toString,
  transformRegExpMatch,
  Type,
  typeOf,
} from '../utils/utils.js';
import { NativeFilter, wrapBareNativeFilters } from './lib/nativeFilter.js';
import { notImplementedError } from '../evaluateErrors.js';
import { compare } from '../compare.js';
import { JqArgumentError, JqEvaluateError } from '../../errors.js';
import { getPath } from '../utils/getPath.js';
import { setPath } from '../utils/setPath.js';
import { builtinJqFilters } from './builtinJqFilters.js';
import { applyNamedFormat } from '../applyFormat.js';
import {
  gmtime as gmtimeValue,
  localtime as localtimeValue,
  mktime as mktimeValue,
  strftime as strftimeValue,
  strptime as strptimeValue,
} from '../dateTime.js';
import {
  emitDebugMessage,
  emitStderrChunk,
  halt,
  snapshotForDiagnostics,
} from '../runtimeState.js';

const MIN_NORMAL = 2.2250738585072014e-308;
const PUBLIC_SANDBOX_BLOCKED_BUILTINS = new Set(['env/0']);

function containsValue(haystack: unknown, needle: unknown): boolean {
  if (typeOf(haystack) !== typeOf(needle)) {
    return false;
  }

  switch (typeOf(haystack)) {
    case Type.object:
      return Object.entries(needle as Record<string, unknown>).every(
        ([key, value]) =>
          Object.prototype.hasOwnProperty.call(haystack, key) &&
          containsValue(
            (haystack as Record<string, unknown>)[key],
            value,
          ),
      );
    case Type.array:
      return (needle as unknown[]).every((needleItem) =>
        (haystack as unknown[]).some((haystackItem) =>
          containsValue(haystackItem, needleItem),
        ),
      );
    case Type.string: {
      const haystackString = haystack as string;
      const needleString = needle as string;
      return (
        needleString.length === 0 || haystackString.includes(needleString)
      );
    }
    default:
      return compare(haystack, needle) === 0;
  }
}

function trimStringValue(input: unknown, mode: 'both' | 'left' | 'right'): string {
  if (typeOf(input) !== Type.string) {
    throw new JqEvaluateError('trim input must be a string');
  }

  let output = input as string;
  if (mode === 'both' || mode === 'left') {
    output = output.trimStart();
  }
  if (mode === 'both' || mode === 'right') {
    output = output.trimEnd();
  }
  return output;
}

function publicBuiltinNames(): string[] {
  return [
    ...new Set([
      ...Object.keys(builtinJqFilters),
      ...Object.keys(builtinNativeFilters),
    ]),
  ]
    .filter(
      (name) =>
        !name.startsWith('_') && !PUBLIC_SANDBOX_BLOCKED_BUILTINS.has(name),
    )
    .sort();
}

function rawCompactString(value: unknown): string {
  return typeOf(value) === Type.string
    ? (value as string)
    : JSON.stringify(snapshotForDiagnostics(value)) ?? 'null';
}

function applyUnaryMath(input: unknown, fnName: string, fn: (value: number) => number) {
  const number = assertNumber(input);
  const result = fn(number);
  if (Number.isNaN(result)) {
    return Number.NaN;
  }
  return result;
}

function applyBinaryMath(
  left: unknown,
  right: unknown,
  fn: (left: number, right: number) => number,
) {
  return fn(assertNumber(left), assertNumber(right));
}

export const builtinNativeFilters: Record<string, NativeFilter> = {
  *'path/1'(input, value) {
    yield createItem(value.path);
  },
  ...wrapBareNativeFilters({
    *'_negate/0'(input: unknown) {
      yield -assertNumber(input);
    },
    *'_group_by_impl/1'(input: any[], ref: any[][]) {
      const items = input
        .map((value, i) => ({ value, ref: ref[i] }))
        .sort((a, b) => compare(a.ref, b.ref));

      let i = -1;
      const groupRefs: any[][] = [];
      const out: any[][] = [];
      for (const item of items) {
        if (i === -1 || compare(groupRefs[i], item.ref)) {
          groupRefs.push(item.ref);
          out.push([]);
          i++;
        }
        out[i].push(item.value);
      }

      yield out;
    },
    *'_match_impl/3'(
      input: string,
      regex: string,
      flags: string | null,
      returnOnlyBoolean: boolean
    ) {
      const str = assertString(input);
      const r = new RegExp(regex, (flags ?? '') + 'd');

      if (flags && flags.includes('g')) {
        const m = Array.from(str.matchAll(r));
        if (returnOnlyBoolean) {
          yield m.length !== 0;
        } else {
          yield m.map(transformRegExpMatch);
        }
      } else {
        const m = str.match(r);
        if (returnOnlyBoolean) {
          yield !!m;
        } else if (m) {
          yield [transformRegExpMatch(m)];
        }
      }
    },
    *'_max_by_impl/1'(input: any[], ref: any[][]) {
      if (input.length === 0) {
        return;
      }

      let bestIndex = 0;
      for (let i = 1; i < input.length; i++) {
        if (compare(ref[i], ref[bestIndex]) > 0) {
          bestIndex = i;
        }
      }

      yield input[bestIndex];
    },
    *'_min_by_impl/1'(input: any[], ref: any[][]) {
      if (input.length === 0) {
        return;
      }

      let bestIndex = 0;
      for (let i = 1; i < input.length; i++) {
        if (compare(ref[i], ref[bestIndex]) < 0) {
          bestIndex = i;
        }
      }

      yield input[bestIndex];
    },
    *'_sort_by_impl/1'(input: any[], ref: any[][]) {
      yield input
        .map((item, i) => ({ item, ref: ref[i] }))
        .sort(compare)
        .map(({ item }) => item);
    },
    *'_unique_by_impl/1'(input: any[], ref: any[][]) {
      const items = input
        .map((value, i) => ({ value, ref: ref[i] }))
        .sort((a, b) => compare(a.ref, b.ref));

      const output: any[] = [];
      let previousRef: any[] | undefined;
      for (const item of items) {
        if (!previousRef || compare(previousRef, item.ref) !== 0) {
          output.push(item.value);
          previousRef = item.ref;
        }
      }

      yield output;
    },
    *'_strindices/1'(input: string, needle: string) {
      yield indices(input, needle);
    },

    *'acos/0'(input: unknown) {
      yield applyUnaryMath(input, 'acos', Math.acos);
    },
    *'acosh/0'(input: unknown) {
      yield applyUnaryMath(input, 'acosh', Math.acosh);
    },
    *'asin/0'(input: unknown) {
      yield applyUnaryMath(input, 'asin', Math.asin);
    },
    *'asinh/0'(input: unknown) {
      yield applyUnaryMath(input, 'asinh', Math.asinh);
    },
    *'atan/0'(input: unknown) {
      yield applyUnaryMath(input, 'atan', Math.atan);
    },
    *'atan2/1'(input: unknown, value: unknown) {
      yield applyBinaryMath(input, value, Math.atan2);
    },
    *'atanh/0'(input: unknown) {
      yield applyUnaryMath(input, 'atanh', Math.atanh);
    },
    *'bsearch/1'(input: unknown, target: unknown) {
      if (typeOf(input) !== Type.array) {
        throw new JqArgumentError('Expected an array');
      }

      const values = input as unknown[];
      let low = 0;
      let high = values.length - 1;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const direction = compare(values[mid], target);
        if (direction === 0) {
          yield mid;
          return;
        }
        if (direction < 0) {
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      yield -1 - low;
    },
    *'builtins/0'() {
      yield publicBuiltinNames();
    },
    *'cbrt/0'(input: unknown) {
      yield applyUnaryMath(input, 'cbrt', Math.cbrt);
    },
    *'ceil/0'(input: unknown) {
      yield Math.ceil(assertNumber(input));
    },
    *'contains/1'(input: unknown, value: unknown) {
      yield containsValue(input, value);
    },
    *'copysign/1'(input: unknown, value: unknown) {
      const magnitude = Math.abs(assertNumber(input));
      const sign = assertNumber(value);
      yield sign === 0 ? magnitude : Math.sign(sign) * magnitude;
    },
    *'cos/0'(input: unknown) {
      yield applyUnaryMath(input, 'cos', Math.cos);
    },
    *'cosh/0'(input: unknown) {
      yield applyUnaryMath(input, 'cosh', Math.cosh);
    },
    *'debug/0'(input: unknown) {
      emitDebugMessage(JSON.stringify(['DEBUG:', snapshotForDiagnostics(input)]));
      yield input;
    },
    *'delpaths/1'(input: unknown, paths: unknown) {
      if (!isPaths(paths)) {
        throw new JqArgumentError('Expected an array of paths');
      }
      yield delPaths(input as any, paths);
    },
    *'drem/2'() {
      throw notImplementedError('drem/2');
    },
    *'empty/0'() {},
    *'endswith/1'(input: unknown, str: unknown) {
      const i = assertString(input);
      const s = assertString(str);

      yield i.endsWith(s);
    },
    *'env/0'() {
      throw new JqEvaluateError('env is not available in the public BXL sandbox');
    },
    *'erf/0'() {
      throw notImplementedError('erf/0');
    },
    *'erfc/0'() {
      throw notImplementedError('erfc/0');
    },
    *'error/0'(input: unknown) {
      throw new JqEvaluateError(toString(input));
    },
    *'exp/0'(input: unknown) {
      yield applyUnaryMath(input, 'exp', Math.exp);
    },
    *'exp10/0'(input: unknown) {
      yield applyUnaryMath(input, 'exp10', (value) => 10 ** value);
    },
    *'exp2/0'(input: unknown) {
      yield applyUnaryMath(input, 'exp2', (value) => 2 ** value);
    },
    *'explode/0'(input: unknown) {
      yield Array.from(assertString(input)).map((char) => char.codePointAt(0)!);
    },
    *'expm1/0'() {
      throw notImplementedError('expm1/0');
    },
    *'fabs/0'(input: unknown) {
      yield Math.abs(assertNumber(input));
    },
    *'fdim/1'(input: unknown, value: unknown) {
      const left = assertNumber(input);
      const right = assertNumber(value);
      yield Math.max(left - right, 0);
    },
    *'floor/0'(input: unknown) {
      yield Math.floor(assertNumber(input));
    },
    *'fma/3'() {
      throw notImplementedError('fma/3');
    },
    *'fmax/1'(input: unknown, value: unknown) {
      yield Math.max(assertNumber(input), assertNumber(value));
    },
    *'fmin/1'(input: unknown, value: unknown) {
      yield Math.min(assertNumber(input), assertNumber(value));
    },
    *'fmod/2'() {
      throw notImplementedError('fmod/2');
    },
    *'format/1'(input: unknown, format: unknown) {
      if (typeOf(format) !== Type.string) {
        throw new JqEvaluateError(
          `${typeOf(format)} (${toString(format)}) is not a valid format`,
        );
      }
      yield applyNamedFormat(format as string, input);
    },
    *'frexp/0'() {
      throw notImplementedError('frexp/0');
    },
    *'fromjson/0'(input: unknown) {
      if (typeOf(input) !== Type.string) {
        throw new JqEvaluateError(
          `${typeOf(input)} (${toString(input)}) only strings can be parsed`,
        );
      }
      const source = input as string;
      const trimmed = source.trim();
      if (trimmed === 'nan') {
        yield Number.NaN;
        return;
      }
      try {
        yield JSON.parse(source);
      } catch (error) {
        const message =
          error && typeof error === 'object' && 'message' in error
            ? String((error as { message: unknown }).message)
            : String(error);
        throw new JqEvaluateError(message);
      }
    },
    *'gamma/0'() {
      throw notImplementedError('gamma/0');
    },
    *'get_jq_origin/0'() {
      yield 'https://realms-staging.stack.cards/ctse/working-loon/jqxl/';
    },
    *'get_prog_origin/0'() {
      yield 'native-inline';
    },
    *'get_search_list/0'() {
      yield [];
    },
    *'getpath/1'(input: unknown, path: unknown) {
      if (!isPath(path)) {
        throw new JqArgumentError('Expected an array path');
      }
      yield getPath(input, path);
    },
    *'gmtime/0'(input: unknown) {
      if (typeOf(input) !== Type.number) {
        throw new JqEvaluateError('gmtime requires numeric inputs');
      }
      yield gmtimeValue(input as number);
    },
    *'halt/0'() {
      halt(0);
    },
    *'halt_error/1'(input: unknown, exitCode: unknown) {
      emitStderrChunk(rawCompactString(input));
      halt(assertNumber(exitCode));
    },
    *'has/1'(input: any, key: any) {
      yield has(input, key);
    },
    *'have_decnum/0'() {
      yield false;
    },
    *'have_literal_numbers/0'() {
      yield false;
    },
    *'hypot/1'(input: unknown, value: unknown) {
      yield Math.hypot(assertNumber(input), assertNumber(value));
    },
    *'implode/0'(input: unknown) {
      if (typeOf(input) !== Type.array) {
        throw new JqArgumentError('Expected an array');
      }
      yield String.fromCodePoint(
        ...(input as unknown[]).map((value) => assertNumber(value)),
      );
    },
    *'infinite/0'() {
      yield Number.POSITIVE_INFINITY;
    },
    *'input/0'() {
      throw notImplementedError('input/0');
    },
    *'input_filename/0'() {
      throw notImplementedError('input_filename/0');
    },
    *'input_line_number/0'() {
      throw notImplementedError('input_line_number/0');
    },
    *'isinfinite/0'(input: unknown) {
      yield typeOf(input) === Type.number && !Number.isFinite(input as number);
    },
    *'isnan/0'(input: unknown) {
      yield typeOf(input) === Type.number && Number.isNaN(input as number);
    },
    *'isnormal/0'(input: unknown) {
      yield (
        typeOf(input) === Type.number &&
        Number.isFinite(input as number) &&
        input !== 0 &&
        Math.abs(input as number) >= MIN_NORMAL
      );
    },
    *'j0/0'() {
      throw notImplementedError('j0/0');
    },
    *'j1/0'() {
      throw notImplementedError('j1/0');
    },
    *'jn/2'() {
      throw notImplementedError('jn/2');
    },
    *'keys/0'(input: unknown) {
      yield sort(keys(input as any));
    },
    *'keys_unsorted/0'(input: unknown) {
      yield keys(input as any);
    },
    *'ldexp/2'() {
      throw notImplementedError('ldexp/2');
    },
    *'length/0'(input: any) {
      const type = typeOf(input);
      switch (typeOf(input)) {
        case Type.null:
          yield 0;
          break;
        case Type.string:
        case Type.array:
          yield input.length;
          break;
        case Type.object:
          yield Object.keys(input).length;
          break;
        case Type.boolean:
        case Type.number:
        default:
          throw Error(`${type} has no length`);
      }
    },
    *'lgamma/0'() {
      throw notImplementedError('lgamma/0');
    },
    *'lgamma_r/0'() {
      throw notImplementedError('lgamma_r/0');
    },
    *'localtime/0'(input: unknown) {
      if (typeOf(input) !== Type.number) {
        throw new JqEvaluateError('localtime requires numeric inputs');
      }
      yield localtimeValue(input as number);
    },
    *'log/0'(input: unknown) {
      yield applyUnaryMath(input, 'log', Math.log);
    },
    *'log10/0'(input: unknown) {
      yield applyUnaryMath(input, 'log10', Math.log10);
    },
    *'log1p/0'(input: unknown) {
      yield applyUnaryMath(input, 'log1p', Math.log1p);
    },
    *'log2/0'(input: unknown) {
      yield applyUnaryMath(input, 'log2', Math.log2);
    },
    *'logb/0'() {
      throw notImplementedError('logb/0');
    },
    *'ltrimstr/1'(input: unknown, left: unknown) {
      const str = assertString(input);
      const prefix = assertString(left);
      yield str.startsWith(prefix) ? str.slice(prefix.length) : str;
    },
    *'max/0'(input: unknown) {
      if (typeOf(input) !== Type.array) {
        throw new JqArgumentError('Expected an array');
      }
      if ((input as unknown[]).length === 0) {
        yield null;
        return;
      }
      yield (input as unknown[]).reduce((best, item) =>
        compare(item, best) > 0 ? item : best,
      );
    },
    *'min/0'(input: unknown) {
      if (typeOf(input) !== Type.array) {
        throw new JqArgumentError('Expected an array');
      }
      if ((input as unknown[]).length === 0) {
        yield null;
        return;
      }
      yield (input as unknown[]).reduce((best, item) =>
        compare(item, best) < 0 ? item : best,
      );
    },
    *'mktime/0'(input: unknown) {
      if (typeOf(input) !== Type.array) {
        throw new JqEvaluateError('mktime requires array inputs');
      }
      try {
        yield mktimeValue(input);
      } catch (_error) {
        throw new JqEvaluateError('mktime requires parsed datetime inputs');
      }
    },
    *'modf/0'() {
      throw notImplementedError('modf/0');
    },
    *'modulemeta/0'() {
      throw notImplementedError('modulemeta/0');
    },
    *'nan/0'() {
      yield Number.NaN;
    },
    *'nearbyint/0'() {
      throw notImplementedError('nearbyint/0');
    },
    *'nextafter/2'() {
      throw notImplementedError('nextafter/2');
    },
    *'nexttoward/2'() {
      throw notImplementedError('nexttoward/2');
    },
    *'not/0'(input: unknown) {
      yield !isTrue(input);
    },
    *'now/0'() {
      yield Date.now() / 1000;
    },
    *'pow/1'(input: unknown, value: unknown) {
      yield applyBinaryMath(input, value, Math.pow);
    },
    *'pow10/0'() {
      throw notImplementedError('pow10/0');
    },
    *'range/2'(input: unknown, from: number, upto: number) {
      yield* range(from, upto);
    },
    *'remainder/2'() {
      throw notImplementedError('remainder/2');
    },
    *'rint/0'() {
      throw notImplementedError('rint/0');
    },
    *'round/0'(input: unknown) {
      yield Math.round(assertNumber(input));
    },
    *'rtrimstr/1'(input: unknown, right: unknown) {
      const str = assertString(input);
      const suffix = assertString(right);
      yield str.endsWith(suffix) ? str.slice(0, str.length - suffix.length) : str;
    },
    *'scalars_or_empty/0'() {
      throw notImplementedError('scalars_or_empty/0');
    },
    *'scalb/2'() {
      throw notImplementedError('scalb/2');
    },
    *'scalbln/2'() {
      throw notImplementedError('scalbln/2');
    },
    *'significand/0'() {
      throw notImplementedError('significand/0');
    },
    *'sin/0'(input: unknown) {
      yield applyUnaryMath(input, 'sin', Math.sin);
    },
    *'sinh/0'(input: unknown) {
      yield applyUnaryMath(input, 'sinh', Math.sinh);
    },
    *'sort/0'(input: any[]) {
      yield input.sort(compare);
    },
    *'split/1'(input, split) {
      yield assertString(input).split(assertString(split));
    },
    *'sqrt/0'(input: unknown) {
      yield applyUnaryMath(input, 'sqrt', Math.sqrt);
    },
    *'startswith/1'(input: unknown, str: unknown) {
      const i = assertString(input);
      const s = assertString(str);

      yield i.startsWith(s);
    },
    *'stderr/0'(input: unknown) {
      emitStderrChunk(rawCompactString(input));
      yield input;
    },
    *'strflocaltime/1'(input: unknown, format: unknown) {
      if (typeOf(format) !== Type.string) {
        throw new JqEvaluateError('strflocaltime/1 requires a string format');
      }
      if (typeOf(input) !== Type.number && typeOf(input) !== Type.array) {
        throw new JqEvaluateError('strflocaltime/1 requires parsed datetime inputs');
      }
      try {
        yield strftimeValue(input, format as string, 'local');
      } catch (_error) {
        throw new JqEvaluateError('strflocaltime/1 requires parsed datetime inputs');
      }
    },
    *'strftime/1'(input: unknown, format: unknown) {
      if (typeOf(format) !== Type.string) {
        throw new JqEvaluateError('strftime/1 requires a string format');
      }
      if (typeOf(input) !== Type.number && typeOf(input) !== Type.array) {
        throw new JqEvaluateError('strftime/1 requires parsed datetime inputs');
      }
      try {
        yield strftimeValue(input, format as string, 'utc');
      } catch (_error) {
        throw new JqEvaluateError('strftime/1 requires parsed datetime inputs');
      }
    },
    *'strptime/1'(input: unknown, format: unknown) {
      if (typeOf(input) !== Type.string || typeOf(format) !== Type.string) {
        throw new JqEvaluateError('strptime/1 requires string inputs and arguments');
      }
      yield strptimeValue(input as string, format as string);
    },
    *'toboolean/0'(input: unknown) {
      if (typeOf(input) === Type.boolean) {
        yield input;
        return;
      }
      if (typeOf(input) === Type.string) {
        if (input === 'true') {
          yield true;
          return;
        }
        if (input === 'false') {
          yield false;
          return;
        }
      }
      throw new JqEvaluateError(
        `${typeOf(input)} (${toString(input)}) cannot be parsed as a boolean`,
      );
    },
    *'tojson/0'(input: unknown) {
      const encoded = JSON.stringify(input);
      if (encoded === undefined) {
        throw new JqEvaluateError('Value cannot be serialized as JSON');
      }
      yield encoded;
    },
    *'trimstr/1'(input: unknown, value: unknown) {
      const str = assertString(input);
      const trim = assertString(value);
      const leftTrimmed = str.startsWith(trim) ? str.slice(trim.length) : str;
      yield leftTrimmed.endsWith(trim)
        ? leftTrimmed.slice(0, leftTrimmed.length - trim.length)
        : leftTrimmed;
    },
    *'trim/0'(input: unknown) {
      yield trimStringValue(input, 'both');
    },
    *'tan/0'(input: unknown) {
      yield applyUnaryMath(input, 'tan', Math.tan);
    },
    *'tanh/0'(input: unknown) {
      yield applyUnaryMath(input, 'tanh', Math.tanh);
    },
    *'tgamma/0'() {
      throw notImplementedError('tgamma/0');
    },
    *'tonumber/0'(input: unknown) {
      const type = typeOf(input);
      switch (type) {
        case Type.string: {
          const parsedNumber = Number(input);
          if(isNaN(parsedNumber)) {
            throw Error(`${type} (${toString(input)}) cannot be parsed as number`);
          }
          if(!isFinite(parsedNumber)) {
            yield parsedNumber > 0 ? Number.MAX_VALUE : -1 * Number.MAX_VALUE;
            break;
          }
          yield parsedNumber;
        break;
        }
        case Type.number:
          yield input;
          break;
        case Type.object:
        case Type.array:
        case Type.null:
        case Type.boolean:
        default:
          throw Error(`${type} (${toString(input)}) cannot be parsed as number`);
      }
    },
    *'tostring/0'(input: unknown) {
      yield toString(input);
    },
    *'utf8bytelength/0'(input: unknown) {
      if (typeOf(input) !== Type.string) {
        throw new JqEvaluateError(
          `${typeOf(input)} (${toString(input)}) only strings have UTF-8 byte length`,
        );
      }
      yield new TextEncoder().encode(input as string).length;
    },
    *'unique/0'(input: unknown) {
      if (typeOf(input) !== Type.array) {
        throw new JqArgumentError('Expected an array');
      }
      const sorted = [...(input as unknown[])].sort(compare);
      const output: unknown[] = [];
      for (const value of sorted) {
        if (output.length === 0 || compare(output[output.length - 1], value) !== 0) {
          output.push(value);
        }
      }
      yield output;
    },
    *'trunc/0'(input: unknown) {
      yield Math.trunc(assertNumber(input));
    },
    *'type/0'(input: any) {
      yield typeOf(input);
    },
    *'ltrim/0'(input: unknown) {
      yield trimStringValue(input, 'left');
    },
    *'rtrim/0'(input: unknown) {
      yield trimStringValue(input, 'right');
    },
    *'setpath/2'(input: unknown, path: unknown, value: unknown) {
      if (!isPath(path)) {
        throw new JqArgumentError('Expected an array path');
      }
      yield setPath(input, path, value);
    },
    *'y0/0'() {
      throw notImplementedError('y0/0');
    },
    *'y1/0'() {
      throw notImplementedError('y1/0');
    },
    *'yn/2'() {
      throw notImplementedError('yn/2');
    },
  }),
};
