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

// ────────────────────────────────────────────────────────────────────
// Numerical helpers for jq libm-compat builtins.
// These fill upstream stubs (`erf`, `gamma`, `j0`, `nextafter`, etc.)
// per BXL design decisions documented in UPSTREAM-DIFFS.md:
//   - `gamma/0` and `tgamma/0` both compute true Γ (Excel-canonical)
//   - `atan2/2` follows Excel argument order (x, y) — see filter below
//   - 4 sandbox-only functions (`input/0` etc.) remain notImplementedError
// ────────────────────────────────────────────────────────────────────

const F64_BUF = new ArrayBuffer(8);
const F64_DV = new DataView(F64_BUF);

function f64ToBits(x: number): { hi: number; lo: number } {
  F64_DV.setFloat64(0, x);
  return { hi: F64_DV.getUint32(0), lo: F64_DV.getUint32(4) };
}

function bitsToF64(hi: number, lo: number): number {
  F64_DV.setUint32(0, hi);
  F64_DV.setUint32(4, lo);
  return F64_DV.getFloat64(0);
}

/** IEEE 754 next-representable value of `x` toward `y`. */
function ieeeNextafter(x: number, y: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
  if (x === y) return y;
  if (x === 0) return y > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  let { hi, lo } = f64ToBits(x);
  // Increase magnitude when (x < y) === (x > 0); else decrease.
  const increasing = (x < y) === (x > 0);
  if (increasing) {
    if (lo === 0xffffffff) { hi = (hi + 1) >>> 0; lo = 0; }
    else { lo = (lo + 1) >>> 0; }
  } else {
    if (lo === 0) { hi = (hi - 1) >>> 0; lo = 0xffffffff; }
    else { lo = (lo - 1) >>> 0; }
  }
  return bitsToF64(hi, lo);
}

/** Round-half-to-even (banker's rounding, IEEE 754 default rounding). */
function roundHalfToEven(x: number): number {
  if (!Number.isFinite(x)) return x;
  const truncated = Math.trunc(x);
  const frac = x - truncated;
  const absFrac = Math.abs(frac);
  if (absFrac < 0.5) return truncated;
  if (absFrac > 0.5) return truncated + Math.sign(frac);
  // Tie: round to even.
  return (truncated % 2 === 0) ? truncated : truncated + Math.sign(frac);
}

/** IEEE remainder: x - n*y where n = round-half-to-even(x/y). */
function ieeeRemainder(x: number, y: number): number {
  if (y === 0 || !Number.isFinite(x) || Number.isNaN(y)) return Number.NaN;
  const n = roundHalfToEven(x / y);
  return x - n * y;
}

/** Split into [mantissa, binaryExponent] with mantissa in [0.5, 1). */
function frexp(x: number): [number, number] {
  if (x === 0 || !Number.isFinite(x) || Number.isNaN(x)) return [x, 0];
  const { hi } = f64ToBits(x);
  const rawExp = (hi >>> 20) & 0x7ff;
  if (rawExp === 0) {
    // Subnormal — normalize via scaling.
    const scaled = x * (2 ** 54);
    const [m, e] = frexp(scaled);
    return [m, e - 54];
  }
  const exponent = rawExp - 1022;
  const mantissa = x / Math.pow(2, exponent);
  return [mantissa, exponent];
}

/** floor(log2(|x|)), with C/POSIX special cases. */
function logb(x: number): number {
  if (x === 0) return Number.NEGATIVE_INFINITY;
  if (!Number.isFinite(x)) return Number.POSITIVE_INFINITY;
  if (Number.isNaN(x)) return Number.NaN;
  return Math.floor(Math.log2(Math.abs(x)));
}

/** erf(x) — Abramowitz & Stegun 7.1.26, max abs error ~1.5e-7. */
function erfApprox(x: number): number {
  const sign = Math.sign(x);
  const ax = Math.abs(x);
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

// ── Lanczos approximation for Γ(x) and ln Γ(x). ─────────────────────
const LANCZOS_G = 7;
const LANCZOS_C = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function gammaApprox(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x < 0.5) {
    // Reflection: Γ(x)·Γ(1-x) = π / sin(πx).
    return Math.PI / (Math.sin(Math.PI * x) * gammaApprox(1 - x));
  }
  x -= 1;
  let a = LANCZOS_C[0];
  const t = x + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_C.length; i++) {
    a += LANCZOS_C[i] / (x + i);
  }
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

function lgammaApprox(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x < 0.5) {
    return Math.log(Math.abs(Math.PI / Math.sin(Math.PI * x))) - lgammaApprox(1 - x);
  }
  x -= 1;
  let a = LANCZOS_C[0];
  const t = x + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_C.length; i++) {
    a += LANCZOS_C[i] / (x + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// ── Bessel J0, J1, Y0, Y1 (Numerical Recipes / Abramowitz). ─────────
function besselJ0(x: number): number {
  if (x === 0) return 1; // J0(0) = 1 exactly; the polynomial drifts ~1e-9 at 0.
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const num =
      57568490574.0 +
      y * (-13362590354.0 +
        y * (651619640.7 +
          y * (-11214424.18 +
            y * (77392.33017 + y * -184.9052456))));
    const den =
      57568490411.0 +
      y * (1029532985.0 +
        y * (9494680.718 +
          y * (59272.64853 +
            y * (267.8532712 + y * 1.0))));
    return num / den;
  }
  const z = 8 / ax;
  const y = z * z;
  const xx = ax - 0.785398164;
  const p = 1.0 +
    y * (-0.1098628627e-2 +
      y * (0.2734510407e-4 +
        y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
  const q = -0.1562499995e-1 +
    y * (0.1430488765e-3 +
      y * (-0.6911147651e-5 +
        y * (0.7621095161e-6 + y * -0.934935152e-7)));
  return Math.sqrt(0.636619772 / ax) *
    (Math.cos(xx) * p - z * Math.sin(xx) * q);
}

function besselJ1(x: number): number {
  if (x === 0) return 0; // J1(0) = 0 exactly.
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const num = x * (72362614232.0 +
      y * (-7895059235.0 +
        y * (242396853.1 +
          y * (-2972611.439 +
            y * (15704.48260 + y * -30.16036606)))));
    const den = 144725228442.0 +
      y * (2300535178.0 +
        y * (18583304.74 +
          y * (99447.43394 +
            y * (376.9991397 + y * 1.0))));
    return num / den;
  }
  const z = 8 / ax;
  const y = z * z;
  const xx = ax - 2.356194491;
  const p = 1.0 +
    y * (0.183105e-2 +
      y * (-0.3516396496e-4 +
        y * (0.2457520174e-5 + y * -0.240337019e-6)));
  const q = 0.04687499995 +
    y * (-0.2002690873e-3 +
      y * (0.8449199096e-5 +
        y * (-0.88228987e-6 + y * 0.105787412e-6)));
  let result = Math.sqrt(0.636619772 / ax) *
    (Math.cos(xx) * p - z * Math.sin(xx) * q);
  if (x < 0) result = -result;
  return result;
}

function besselY0(x: number): number {
  if (x <= 0) return Number.NaN; // Y is undefined for x <= 0.
  if (x < 8) {
    const y = x * x;
    const num = -2957821389.0 +
      y * (7062834065.0 +
        y * (-512359803.6 +
          y * (10879881.29 +
            y * (-86327.92757 + y * 228.4622733))));
    const den = 40076544269.0 +
      y * (745249964.8 +
        y * (7189466.438 +
          y * (47447.26470 +
            y * (226.1030244 + y * 1.0))));
    return num / den + 0.636619772 * besselJ0(x) * Math.log(x);
  }
  const z = 8 / x;
  const y = z * z;
  const xx = x - 0.785398164;
  const p = 1.0 +
    y * (-0.1098628627e-2 +
      y * (0.2734510407e-4 +
        y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
  const q = -0.1562499995e-1 +
    y * (0.1430488765e-3 +
      y * (-0.6911147651e-5 +
        y * (0.7621095161e-6 + y * -0.934935152e-7)));
  return Math.sqrt(0.636619772 / x) *
    (Math.sin(xx) * p + z * Math.cos(xx) * q);
}

function besselY1(x: number): number {
  if (x <= 0) return Number.NaN;
  if (x < 8) {
    const y = x * x;
    const num = x * (-4.900604943e13 +
      y * (1.275274390e13 +
        y * (-5.153438139e11 +
          y * (7.349264551e9 +
            y * (-4.237922726e7 + y * 8.511937935e4)))));
    const den = 2.499580570e14 +
      y * (4.244419664e12 +
        y * (3.733650367e10 +
          y * (2.245904002e8 +
            y * (1.020426050e6 +
              y * (3.549632885e3 + y)))));
    return num / den + 0.636619772 * (besselJ1(x) * Math.log(x) - 1 / x);
  }
  const z = 8 / x;
  const y = z * z;
  const xx = x - 2.356194491;
  const p = 1.0 +
    y * (0.183105e-2 +
      y * (-0.3516396496e-4 +
        y * (0.2457520174e-5 + y * -0.240337019e-6)));
  const q = 0.04687499995 +
    y * (-0.2002690873e-3 +
      y * (0.8449199096e-5 +
        y * (-0.88228987e-6 + y * 0.105787412e-6)));
  return Math.sqrt(0.636619772 / x) *
    (Math.sin(xx) * p + z * Math.cos(xx) * q);
}

/** Bessel J of integer order n via stable recurrence (Miller's algorithm). */
function besselJn(n: number, x: number): number {
  n = Math.trunc(n);
  if (n === 0) return besselJ0(x);
  if (n === 1) return besselJ1(x);
  if (n < 0) return ((n & 1) === 0 ? 1 : -1) * besselJn(-n, x);
  if (x === 0) return 0;
  const ax = Math.abs(x);
  const tox = 2 / ax;
  if (ax > n) {
    let bjm = besselJ0(ax);
    let bj = besselJ1(ax);
    for (let j = 1; j < n; j++) {
      const bjp = j * tox * bj - bjm;
      bjm = bj;
      bj = bjp;
    }
    return x < 0 && (n & 1) ? -bj : bj;
  } else {
    const m = 2 * Math.floor((n + Math.floor(Math.sqrt(40 * n))) / 2);
    let jsum = 0;
    let bjp = 0;
    let bj = 1;
    let ans = 0;
    let sum = 0;
    for (let j = m; j > 0; j--) {
      const bjm = j * tox * bj - bjp;
      bjp = bj;
      bj = bjm;
      if (Math.abs(bj) > 1e10) {
        bj *= 1e-10;
        bjp *= 1e-10;
        ans *= 1e-10;
        sum *= 1e-10;
      }
      if (jsum) sum += bj;
      jsum = jsum ? 0 : 1;
      if (j === n) ans = bjp;
    }
    sum = 2 * sum - bj;
    ans /= sum;
    return x < 0 && (n & 1) ? -ans : ans;
  }
}

/** Bessel Y of integer order n via forward recurrence. */
function besselYn(n: number, x: number): number {
  n = Math.trunc(n);
  if (n === 0) return besselY0(x);
  if (n === 1) return besselY1(x);
  if (x <= 0) return Number.NaN;
  const tox = 2 / x;
  let bym = besselY0(x);
  let by = besselY1(x);
  for (let j = 1; j < n; j++) {
    const byp = j * tox * by - bym;
    bym = by;
    by = byp;
  }
  return by;
}

/** True if value is a scalar (null, boolean, number, string). */
function isScalar(value: unknown): boolean {
  const t = typeOf(value);
  return t === Type.null || t === Type.boolean || t === Type.number || t === Type.string;
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
    *'atan2/2'(_input: unknown, x: unknown, y: unknown) {
      // BXL design: ATAN2 case-folds to one canonical signature, and the
      // canonical convention is Excel's: ATAN2(x, y) returns angle of (x, y).
      // Vanilla-jq atan2(y; x) ports must swap arguments. (0,0) returns 0
      // for POSIX-compat (Excel's ATAN2 returns #DIV/0! — the lowercase
      // jq spelling here is reachable from generic geometry code where 0
      // is safer than an error.) See docs/syntax-reference.md collision rules.
      const xv = assertNumber(x);
      const yv = assertNumber(y);
      if (xv === 0 && yv === 0) {
        yield 0;
        return;
      }
      yield Math.atan2(yv, xv);
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
    *'copysign/2'(_input: unknown, x: unknown, y: unknown) {
      // copysign(x; y): magnitude of x with the sign of y.
      const magnitude = Math.abs(assertNumber(x));
      const sign = assertNumber(y);
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
    *'drem/2'(_input: unknown, x: unknown, y: unknown) {
      // IEEE remainder: alias of remainder/2 in libm.
      yield ieeeRemainder(assertNumber(x), assertNumber(y));
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
    *'erf/0'(input: unknown) {
      yield erfApprox(assertNumber(input));
    },
    *'erfc/0'(input: unknown) {
      yield 1 - erfApprox(assertNumber(input));
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
    *'expm1/0'(input: unknown) {
      yield Math.expm1(assertNumber(input));
    },
    *'fabs/0'(input: unknown) {
      yield Math.abs(assertNumber(input));
    },
    *'fdim/1'(input: unknown, value: unknown) {
      const left = assertNumber(input);
      const right = assertNumber(value);
      yield Math.max(left - right, 0);
    },
    *'fdim/2'(_input: unknown, x: unknown, y: unknown) {
      // fdim(x; y): max(x - y, 0). "Positive difference."
      yield Math.max(assertNumber(x) - assertNumber(y), 0);
    },
    *'floor/0'(input: unknown) {
      yield Math.floor(assertNumber(input));
    },
    *'fma/3'(_input: unknown, a: unknown, b: unknown, c: unknown) {
      // a*b + c. JS lacks a true fused-multiply-add; this is a best-effort
      // approximation with one rounding step (the JS arithmetic).
      yield assertNumber(a) * assertNumber(b) + assertNumber(c);
    },
    *'fmax/1'(input: unknown, value: unknown) {
      yield Math.max(assertNumber(input), assertNumber(value));
    },
    *'fmax/2'(_input: unknown, x: unknown, y: unknown) {
      // C/POSIX fmax: NaN-skipping max. If one arg is NaN, return the other.
      // (Excel MAX/1 propagates errors — different name, different behaviour.)
      const xv = assertNumber(x);
      const yv = assertNumber(y);
      if (Number.isNaN(xv)) yield yv;
      else if (Number.isNaN(yv)) yield xv;
      else yield Math.max(xv, yv);
    },
    *'fmin/1'(input: unknown, value: unknown) {
      yield Math.min(assertNumber(input), assertNumber(value));
    },
    *'fmin/2'(_input: unknown, x: unknown, y: unknown) {
      // C/POSIX fmin: NaN-skipping min.
      const xv = assertNumber(x);
      const yv = assertNumber(y);
      if (Number.isNaN(xv)) yield yv;
      else if (Number.isNaN(yv)) yield xv;
      else yield Math.min(xv, yv);
    },
    *'fmod/2'(_input: unknown, x: unknown, y: unknown) {
      // C/POSIX fmod: dividend-signed (matches JS `%` for floats).
      // NOT Excel MOD (which is divisor-signed) — `MOD/2` lives in the
      // formula bridge and computes ((d % div) + div) % div.
      yield assertNumber(x) % assertNumber(y);
    },
    *'format/1'(input: unknown, format: unknown) {
      if (typeOf(format) !== Type.string) {
        throw new JqEvaluateError(
          `${typeOf(format)} (${toString(format)}) is not a valid format`,
        );
      }
      yield applyNamedFormat(format as string, input);
    },
    *'frexp/0'(input: unknown) {
      // Decomposes x into [mantissa, exponent] s.t. x = mantissa · 2^exponent
      // and mantissa is in [0.5, 1) for finite non-zero inputs.
      const [m, e] = frexp(assertNumber(input));
      yield [m, e];
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
    *'gamma/0'(input: unknown) {
      // BXL design decision: `gamma` computes true Γ (matches Excel
      // GAMMA(x) and modern libm). POSIX historically aliased gamma to
      // log-Γ on Linux — that's implementation-defined and not portable.
      // For log-Γ explicitly, use `lgamma/0` or `GAMMALN/1`.
      yield gammaApprox(assertNumber(input));
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
    *'hypot/2'(_input: unknown, x: unknown, y: unknown) {
      // hypot(x; y) = sqrt(x² + y²), overflow/underflow safe via Math.hypot.
      yield Math.hypot(assertNumber(x), assertNumber(y));
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
    *'j0/0'(input: unknown) {
      yield besselJ0(assertNumber(input));
    },
    *'j1/0'(input: unknown) {
      yield besselJ1(assertNumber(input));
    },
    *'jn/2'(_input: unknown, n: unknown, x: unknown) {
      // C/POSIX order: jn(n; x). Bessel J of integer order n at x.
      // (Excel's BESSELJ(x, n) reverses this; both are independently
      // registered. See docs/syntax-reference.md collision rules.)
      yield besselJn(assertNumber(n), assertNumber(x));
    },
    *'keys/0'(input: unknown) {
      yield sort(keys(input as any));
    },
    *'keys_unsorted/0'(input: unknown) {
      yield keys(input as any);
    },
    *'ldexp/2'(_input: unknown, x: unknown, n: unknown) {
      // x · 2^n, with n truncated to integer (libm semantics).
      yield assertNumber(x) * Math.pow(2, Math.trunc(assertNumber(n)));
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
    *'lgamma/0'(input: unknown) {
      yield lgammaApprox(assertNumber(input));
    },
    *'lgamma_r/0'(input: unknown) {
      // C lgamma_r returns ln|Γ(x)| via return value and the sign of Γ(x)
      // via a pointer arg. Without pointers in jq we yield just the log
      // magnitude; users needing the sign should compute it from x.
      yield lgammaApprox(assertNumber(input));
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
    *'logb/0'(input: unknown) {
      yield logb(assertNumber(input));
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
    *'modf/0'(input: unknown) {
      // Splits x into [fractionalPart, integerPart], both with x's sign.
      const x = assertNumber(input);
      const intPart = Math.trunc(x);
      yield [x - intPart, intPart];
    },
    *'modulemeta/0'() {
      throw notImplementedError('modulemeta/0');
    },
    *'nan/0'() {
      yield Number.NaN;
    },
    *'nearbyint/0'(input: unknown) {
      // Round to integer using current rounding mode (default: half-to-even).
      yield roundHalfToEven(assertNumber(input));
    },
    *'nextafter/2'(_input: unknown, x: unknown, y: unknown) {
      yield ieeeNextafter(assertNumber(x), assertNumber(y));
    },
    *'nexttoward/2'(_input: unknown, x: unknown, y: unknown) {
      // C nexttoward differs from nextafter only in long-double precision,
      // which JS doesn't have. Behaves identically here.
      yield ieeeNextafter(assertNumber(x), assertNumber(y));
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
    *'pow/2'(_input: unknown, base: unknown, exp: unknown) {
      // pow(base; exp): standard exponentiation. Param order matches both
      // C/POSIX and Excel POWER, so no impedance — just call Math.pow.
      yield Math.pow(assertNumber(base), assertNumber(exp));
    },
    *'pow10/0'(input: unknown) {
      yield Math.pow(10, assertNumber(input));
    },
    *'range/2'(input: unknown, from: number, upto: number) {
      yield* range(from, upto);
    },
    *'remainder/2'(_input: unknown, x: unknown, y: unknown) {
      // IEEE 754 remainder: x - n·y where n = round-half-to-even(x/y).
      // Differs from `fmod` (which truncates the quotient).
      yield ieeeRemainder(assertNumber(x), assertNumber(y));
    },
    *'rint/0'(input: unknown) {
      // Round to integer using current rounding mode (half-to-even default).
      // Identical behaviour to nearbyint without the inexact-flag distinction.
      yield roundHalfToEven(assertNumber(input));
    },
    *'round/0'(input: unknown) {
      yield Math.round(assertNumber(input));
    },
    *'rtrimstr/1'(input: unknown, right: unknown) {
      const str = assertString(input);
      const suffix = assertString(right);
      yield str.endsWith(suffix) ? str.slice(0, str.length - suffix.length) : str;
    },
    *'scalars_or_empty/0'(input: unknown) {
      // Yield input if it's null/boolean/number/string, otherwise no output.
      if (isScalar(input)) yield input;
    },
    *'scalb/2'(_input: unknown, x: unknown, n: unknown) {
      // Identical to ldexp in IEEE 754 environments (no FLT_RADIX != 2).
      yield assertNumber(x) * Math.pow(2, Math.trunc(assertNumber(n)));
    },
    *'scalbln/2'(_input: unknown, x: unknown, n: unknown) {
      // Same as scalb; the C distinction is only the type of n.
      yield assertNumber(x) * Math.pow(2, Math.trunc(assertNumber(n)));
    },
    *'significand/0'(input: unknown) {
      // x / 2^logb(x) ∈ [1, 2) for normal x.
      const x = assertNumber(input);
      if (x === 0 || !Number.isFinite(x) || Number.isNaN(x)) {
        yield x;
        return;
      }
      yield x / Math.pow(2, logb(x));
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
    *'tgamma/0'(input: unknown) {
      // True Γ — same as `gamma/0` in BXL.
      yield gammaApprox(assertNumber(input));
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
    *'y0/0'(input: unknown) {
      yield besselY0(assertNumber(input));
    },
    *'y1/0'(input: unknown) {
      yield besselY1(assertNumber(input));
    },
    *'yn/2'(_input: unknown, n: unknown, x: unknown) {
      // C/POSIX order: yn(n; x). Bessel Y of integer order n at x.
      yield besselYn(assertNumber(n), assertNumber(x));
    },
  }),
};
