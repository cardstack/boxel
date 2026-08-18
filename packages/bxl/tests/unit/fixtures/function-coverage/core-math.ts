import { ok, strictEqual } from 'node:assert';
import type { CoverageCase } from './case.ts';
import { jqCases } from './case.ts';

export const coreMathCases: CoverageCase[] = jqCases([
  // Trigonometry
  {
    covers: 'sin/0',
    source: 'sin',
    input: 1,
    expected: 0.841471,
    tolerance: 1e-7,
  },
  {
    covers: 'cos/0',
    source: 'cos',
    input: 1,
    expected: 0.5403023,
    tolerance: 1e-7,
  },
  {
    covers: 'tan/0',
    source: 'tan',
    input: 1,
    expected: 1.5574077,
    tolerance: 1e-7,
  },
  {
    covers: 'asin/0',
    source: 'asin',
    input: 0.5,
    expected: 0.5235988,
    tolerance: 1e-7,
  },
  {
    covers: 'acos/0',
    source: 'acos',
    input: 0.5,
    expected: 1.0471976,
    tolerance: 1e-7,
  },
  {
    covers: 'atan/0',
    source: 'atan',
    input: 1,
    expected: 0.7853982,
    tolerance: 1e-7,
  },
  // atan2 takes POSIX (y; x) order; the unary form reads y from the input.
  // atan2(1, 0) = pi/2, so a swapped-order implementation would return 0.
  {
    covers: 'atan2/1',
    source: 'atan2(0)',
    input: 1,
    expected: 1.5707963,
    tolerance: 1e-7,
  },
  {
    covers: 'atan2/2',
    source: 'atan2(1; 0)',
    expected: 1.5707963,
    tolerance: 1e-7,
  },
  // Hyperbolic
  {
    covers: 'sinh/0',
    source: 'sinh',
    input: 1,
    expected: 1.1752012,
    tolerance: 1e-7,
  },
  {
    covers: 'cosh/0',
    source: 'cosh',
    input: 1,
    expected: 1.5430806,
    tolerance: 1e-7,
  },
  {
    covers: 'tanh/0',
    source: 'tanh',
    input: 1,
    expected: 0.7615942,
    tolerance: 1e-7,
  },
  {
    covers: 'asinh/0',
    source: 'asinh',
    input: 1,
    expected: 0.8813736,
    tolerance: 1e-7,
  },
  {
    covers: 'acosh/0',
    source: 'acosh',
    input: 2,
    expected: 1.3169579,
    tolerance: 1e-7,
  },
  {
    covers: 'atanh/0',
    source: 'atanh',
    input: 0.5,
    expected: 0.5493061,
    tolerance: 1e-7,
  },
  // Exponentials and logarithms
  {
    covers: 'exp/0',
    source: 'exp',
    input: 1,
    expected: 2.7182818,
    tolerance: 1e-7,
  },
  { covers: 'exp2/0', source: 'exp2', input: 3, expected: 8 },
  { covers: 'exp10/0', source: 'exp10', input: 2, expected: 100 },
  { covers: 'pow10/0', source: 'pow10', input: 3, expected: 1000 },
  // exp(1e-10) - 1 computed naively loses the low bits (8e-18 off); expm1
  // keeps them, which is the whole point of the function. The term being
  // kept is x^2/2 = 5e-21, so the tolerance has to sit below that: anything
  // wider also admits an implementation that just returns x.
  {
    covers: 'expm1/0',
    source: 'expm1',
    input: 1e-10,
    expected: 1.00000000005e-10,
    tolerance: 1e-25,
  },
  {
    covers: 'log/0',
    source: 'log',
    input: 2,
    expected: 0.6931472,
    tolerance: 1e-7,
  },
  { covers: 'log2/0', source: 'log2', input: 8, expected: 3 },
  { covers: 'log10/0', source: 'log10', input: 1000, expected: 3 },
  // log(1 + 1e-10) = 1e-10 - 5e-21 + ...; naive log(1+x) is 8e-18 off. As
  // with expm1, the tolerance sits below the 5e-21 term rather than merely
  // below the naive form's error, so returning x unchanged fails too.
  {
    covers: 'log1p/0',
    source: 'log1p',
    input: 1e-10,
    expected: 9.9999999995e-11,
    tolerance: 1e-25,
  },
  // Roots and powers
  {
    covers: 'sqrt/0',
    source: 'sqrt',
    input: 2,
    expected: 1.4142136,
    tolerance: 1e-7,
  },
  // Every other case in this table takes jq's answer as the contract; this
  // one does not. Real jq answers 3.0000000000000004 here, which is its
  // libm's rounding of the cube root, while V8's Math.cbrt lands exactly on
  // 3. The exact answer is the one worth asserting — a card author computing
  // a cube root of a perfect cube should get the integer.
  { covers: 'cbrt/0', source: 'cbrt', input: 27, expected: 3 },
  // pow's unary form reads the base from the input: 2^5, not 5^2.
  { covers: 'pow/1', source: 'pow(5)', input: 2, expected: 32 },
  { covers: 'pow/2', source: 'pow(3; 2)', expected: 9 },
  { covers: 'hypot/1', source: 'hypot(4)', input: 3, expected: 5 },
  { covers: 'hypot/2', source: 'hypot(5; 12)', expected: 13 },
  // Rounding families. Each case picks a value where the modes disagree:
  // round is half-away-from-zero, nearbyint/rint are half-to-even, trunc
  // drops toward zero, floor moves down.
  { covers: 'round/0', source: 'round', input: 2.5, expected: 3 },
  // libm round ties away from zero on negatives too: round(-2.5) = -3.
  {
    covers: 'round/0',
    source: 'round',
    input: -2.5,
    expected: -3,
  },
  { covers: 'floor/0', source: 'floor', input: -1.5, expected: -2 },
  { covers: 'ceil/0', source: 'ceil', input: 1.2, expected: 2 },
  { covers: 'trunc/0', source: 'trunc', input: -1.9, expected: -1 },
  { covers: 'nearbyint/0', source: 'nearbyint', input: 2.5, expected: 2 },
  { covers: 'rint/0', source: 'rint', input: 0.5, expected: 0 },
  { covers: 'fabs/0', source: 'fabs', input: -2.5, expected: 2.5 },
  { covers: 'abs/0', source: 'abs', input: -5, expected: 5 },
  // Sign transfer and clamped difference
  { covers: 'copysign/1', source: 'copysign(-2)', input: 3, expected: -3 },
  { covers: 'copysign/2', source: 'copysign(3; -2)', expected: -3 },
  { covers: 'fdim/1', source: 'fdim(3)', input: 7, expected: 4 },
  // fdim clamps a negative difference to zero.
  { covers: 'fdim/2', source: 'fdim(3; 7)', expected: 0 },
  { covers: 'fmax/1', source: 'fmax(3)', input: 2, expected: 3 },
  // C fmax/fmin skip a NaN operand instead of propagating it.
  { covers: 'fmax/2', source: 'fmax(nan; 2)', expected: 2 },
  { covers: 'fmin/1', source: 'fmin(3)', input: 2, expected: 2 },
  { covers: 'fmin/2', source: 'fmin(nan; 5)', expected: 5 },
  // Remainders: fmod truncates the quotient (dividend-signed, unlike Excel
  // MOD); drem/remainder round it half-to-even.
  { covers: 'fmod/2', source: 'fmod(-7; 2)', expected: -1 },
  // 5/2 = 2.5 rounds to the even quotient 2, giving +1; rounding half away
  // from zero would give -1.
  { covers: 'drem/2', source: 'drem(5; 2)', expected: 1 },
  // 7/2 = 3.5 rounds to 4, giving -1 where fmod gives +1.
  { covers: 'remainder/2', source: 'remainder(7; 2)', expected: -1 },
  { covers: 'fma/3', source: 'fma(2; 3; 4)', expected: 10 },
  // Float decomposition
  // frexp yields one [mantissa, exponent] pair with mantissa in [0.5, 1).
  { covers: 'frexp/0', source: 'frexp', input: 12, expected: [0.75, 4] },
  // modf yields [fractional, integral]; both halves carry the input's sign.
  { covers: 'modf/0', source: 'modf', input: -3.25, expected: [-0.25, -3] },
  // ldexp(m; e) = m * 2^e, mantissa first.
  { covers: 'ldexp/2', source: 'ldexp(1.5; 3)', expected: 12 },
  { covers: 'scalb/2', source: 'scalb(3; 2)', expected: 12 },
  { covers: 'scalbln/2', source: 'scalbln(5; 3)', expected: 40 },
  // 48 = 1.5 * 2^5: significand is in [1, 2), logb is floor(log2(|x|)).
  { covers: 'significand/0', source: 'significand', input: 48, expected: 1.5 },
  { covers: 'logb/0', source: 'logb', input: -10, expected: 3 },
  // One ulp on either side of 1: 1 + 2^-52 going up, 1 - 2^-53 going down.
  {
    covers: 'nextafter/2',
    source: 'nextafter(1; 2)',
    expected: 1.0000000000000002,
  },
  {
    covers: 'nexttoward/2',
    source: 'nexttoward(1; 0)',
    expected: 0.9999999999999999,
  },
  // Non-finite values and their predicates. NaN and Infinity JSON-stringify
  // to null, so the producers are asserted through checks.
  {
    covers: 'nan/0',
    source: 'nan',
    check: (outputs) => {
      strictEqual(outputs.length, 1);
      ok(Number.isNaN(outputs[0]));
    },
  },
  {
    covers: 'infinite/0',
    source: 'infinite',
    check: (outputs) => {
      strictEqual(outputs.length, 1);
      strictEqual(outputs[0], Number.POSITIVE_INFINITY);
    },
  },
  { covers: 'isnan/0', source: 'nan | isnan', expected: true },
  { covers: 'isnan/0', source: 'isnan', input: 1, expected: false },
  { covers: 'isinfinite/0', source: 'infinite | isinfinite', expected: true },
  // NaN is not an infinity: C isinf(NaN) and jq's isinfinite are false.
  {
    covers: 'isinfinite/0',
    source: 'nan | isinfinite',
    expected: false,
  },
  { covers: 'isfinite/0', source: 'infinite | isfinite', expected: false },
  // isfinite is defined in jq source as type == "number" and (isinfinite |
  // not), so it inherits whatever isinfinite decides about NaN. NaN is a
  // number and is not an infinity, so it is finite.
  {
    covers: 'isfinite/0',
    source: 'nan | isfinite',
    expected: true,
  },
  // 1e-320 is subnormal: finite and nonzero, but below the normal threshold.
  { covers: 'isnormal/0', source: 'isnormal', input: 1e-320, expected: false },
  { covers: 'isnormal/0', source: 'isnormal', input: 1, expected: true },
  // Gamma and error functions
  // gamma is true Γ (Γ(5) = 4! = 24), not the historical POSIX log-Γ alias.
  {
    covers: 'gamma/0',
    source: 'gamma',
    input: 5,
    expected: 24,
    tolerance: 1e-9,
  },
  {
    covers: 'tgamma/0',
    source: 'tgamma',
    input: 0.5,
    expected: 1.7724539,
    tolerance: 1e-7,
  },
  {
    covers: 'lgamma/0',
    source: 'lgamma',
    input: 5,
    expected: 3.1780538,
    tolerance: 1e-7,
  },
  // lgamma_r exists to report the sign that lgamma discards: Γ(-2.5) is
  // negative, so the answer is the pair [ln|Γ(x)|, -1].
  {
    covers: 'lgamma_r/0',
    source: 'lgamma_r',
    input: -2.5,
    check: (outputs) => {
      const [pair] = outputs as number[][];
      ok(
        Array.isArray(pair) && pair.length === 2,
        `expected a [ln|gamma|, sign] pair, got ${JSON.stringify(pair)}`,
      );
      ok(Math.abs(pair[0] - -0.0562437) <= 1e-7, `ln|gamma| was ${pair[0]}`);
      strictEqual(pair[1], -1, 'sign of gamma(-2.5)');
    },
  },
  // The erf implementation is a rational approximation good to ~1.5e-7.
  {
    covers: 'erf/0',
    source: 'erf',
    input: 1,
    expected: 0.8427008,
    tolerance: 1e-6,
  },
  {
    covers: 'erfc/0',
    source: 'erfc',
    input: 1,
    expected: 0.1572992,
    tolerance: 1e-6,
  },
  // Bessel functions (single-precision polynomial fits, hence the loose
  // tolerances). jn/yn take POSIX (n; x) order — Excel BESSELJ reverses it.
  {
    covers: 'j0/0',
    source: 'j0',
    input: 1,
    expected: 0.7651977,
    tolerance: 1e-6,
  },
  {
    covers: 'j1/0',
    source: 'j1',
    input: 1,
    expected: 0.4400506,
    tolerance: 1e-6,
  },
  {
    covers: 'jn/2',
    source: 'jn(2; 1.5)',
    expected: 0.2320877,
    tolerance: 1e-6,
  },
  {
    covers: 'y0/0',
    source: 'y0',
    input: 1,
    expected: 0.088257,
    tolerance: 1e-6,
  },
  {
    covers: 'y1/0',
    source: 'y1',
    input: 1,
    expected: -0.7812128,
    tolerance: 1e-6,
  },
  {
    covers: 'yn/2',
    source: 'yn(2; 1.5)',
    expected: -0.9321938,
    tolerance: 1e-6,
  },
]);
