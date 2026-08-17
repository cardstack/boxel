import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import type { CoverageCase } from './case.ts';

export const formulaMathCases: CoverageCase[] = [
  // Rounding: ROUND is half-away-from-zero (Excel), not half-even or JS's
  // half-up; ROUNDUP moves away from zero, ROUNDDOWN toward it.
  { covers: 'ROUND/1', source: 'ROUND(2.5)', expected: 3 },
  { covers: 'ROUND/2', source: 'ROUND(-1.475, 2)', expected: -1.48 },
  { covers: 'ROUNDUP/1', source: 'ROUNDUP(2.1)', expected: 3 },
  { covers: 'ROUNDUP/2', source: 'ROUNDUP(-3.141, 2)', expected: -3.15 },
  { covers: 'ROUNDDOWN/1', source: 'ROUNDDOWN(9.9)', expected: 9 },
  { covers: 'ROUNDDOWN/2', source: 'ROUNDDOWN(-3.149, 2)', expected: -3.14 },
  { covers: 'MROUND/2', source: 'MROUND(10, 3)', expected: 9 },
  // CEILING/FLOOR and their _MATH forms are documented aliases here: the
  // significance is applied by magnitude, and rounding is always toward
  // positive infinity (CEILING) or negative infinity (FLOOR).
  { covers: 'CEILING/1', source: 'CEILING(4.3)', expected: 5 },
  { covers: 'CEILING/2', source: 'CEILING(-4.6, 2)', expected: -4 },
  { covers: 'CEILING_MATH/1', source: 'CEILING_MATH(-5.5)', expected: -5 },
  { covers: 'CEILING_MATH/2', source: 'CEILING_MATH(24.3, 5)', expected: 25 },
  { covers: 'FLOOR/1', source: 'FLOOR(4.8)', expected: 4 },
  { covers: 'FLOOR/2', source: 'FLOOR(-4.2, 2)', expected: -6 },
  { covers: 'FLOOR_MATH/1', source: 'FLOOR_MATH(-5.5)', expected: -6 },
  { covers: 'FLOOR_MATH/2', source: 'FLOOR_MATH(26.7, 5)', expected: 25 },
  // Same argument, different answers: INT floors toward negative infinity,
  // TRUNC drops the fraction toward zero.
  { covers: 'INT/1', source: 'INT(-8.5)', expected: -9 },
  { covers: 'TRUNC/1', source: 'TRUNC(-8.5)', expected: -8 },
  { covers: 'TRUNC/2', source: 'TRUNC(-8.976, 2)', expected: -8.97 },
  // MOD takes the sign of the divisor; QUOTIENT truncates toward zero.
  { covers: 'MOD/2', source: 'MOD(-3, 5)', expected: 2 },
  { covers: 'QUOTIENT/2', source: 'QUOTIENT(-10, 3)', expected: -3 },
  // EVEN and ODD round away from zero.
  { covers: 'EVEN/1', source: 'EVEN(-2.5)', expected: -4 },
  { covers: 'ODD/1', source: 'ODD(-2)', expected: -3 },
  { covers: 'SIGN/1', source: 'SIGN(-7.5)', expected: -1 },
  { covers: 'ABS/1', source: 'ABS(-12.5)', expected: 12.5 },
  // Powers and logarithms.
  { covers: 'POWER/2', source: 'POWER(4, 1.5)', expected: 8 },
  {
    covers: 'EXP/1',
    source: 'EXP(1)',
    expected: 2.718281828459045,
    tolerance: 1e-12,
  },
  {
    covers: 'LN/1',
    source: 'LN(10)',
    expected: 2.302585092994046,
    tolerance: 1e-12,
  },
  { covers: 'LOG/1', source: 'LOG(1000)', expected: 3, tolerance: 1e-12 },
  { covers: 'LOG/1', source: 'LOG(0)', throws: /#NUM!/ },
  { covers: 'LOG/2', source: 'LOG(8, 2)', expected: 3, tolerance: 1e-12 },
  { covers: 'LOG10/1', source: 'LOG10(0.001)', expected: -3, tolerance: 1e-12 },
  {
    covers: 'SQRT/1',
    source: 'SQRT(2)',
    expected: 1.4142135623730951,
    tolerance: 1e-12,
  },
  { covers: 'SQRT/1', source: 'SQRT(-4)', throws: /#NUM!/ },
  {
    covers: 'SQRTPI/1',
    source: 'SQRTPI(2)',
    expected: 2.5066282746310002,
    tolerance: 1e-12,
  },
  // Combinatorics.
  { covers: 'FACT/1', source: 'FACT(6)', expected: 720 },
  { covers: 'FACTDOUBLE/1', source: 'FACTDOUBLE(7)', expected: 105 },
  { covers: 'COMBIN/2', source: 'COMBIN(8, 3)', expected: 56 },
  // COMBINA counts with repetition: C(n + k - 1, k), so C(6, 3).
  { covers: 'COMBINA/2', source: 'COMBINA(4, 3)', expected: 20 },
  // 9! / (2! * 3! * 4!)
  { covers: 'MULTINOMIAL/1', source: 'MULTINOMIAL([2, 3, 4])', expected: 1260 },
  { covers: 'GCD/1', source: 'GCD([24, 36, 60])', expected: 12 },
  { covers: 'LCM/1', source: 'LCM([4, 6, 10])', expected: 60 },
  // Trigonometry.
  {
    covers: 'PI/0',
    source: 'PI()',
    expected: 3.141592653589793,
    tolerance: 1e-12,
  },
  {
    covers: 'DEGREES/1',
    source: 'DEGREES(PI())',
    expected: 180,
    tolerance: 1e-12,
  },
  {
    covers: 'RADIANS/1',
    source: 'RADIANS(270)',
    expected: 4.71238898038469,
    tolerance: 1e-12,
  },
  { covers: 'SIN/1', source: 'SIN(PI()/6)', expected: 0.5, tolerance: 1e-12 },
  { covers: 'COS/1', source: 'COS(PI()/3)', expected: 0.5, tolerance: 1e-12 },
  { covers: 'TAN/1', source: 'TAN(PI()/4)', expected: 1, tolerance: 1e-12 },
  {
    covers: 'COT/1',
    source: 'COT(1)',
    expected: 0.6420926159343308,
    tolerance: 1e-12,
  },
  { covers: 'SEC/1', source: 'SEC(PI()/3)', expected: 2, tolerance: 1e-12 },
  { covers: 'CSC/1', source: 'CSC(PI()/6)', expected: 2, tolerance: 1e-12 },
  {
    covers: 'ASIN/1',
    source: 'ASIN(0.5)',
    expected: 0.5235987755982988,
    tolerance: 1e-12,
  },
  {
    covers: 'ACOS/1',
    source: 'ACOS(0.5)',
    expected: 1.0471975511965976,
    tolerance: 1e-12,
  },
  {
    covers: 'ATAN/1',
    source: 'ATAN(1)',
    expected: 0.7853981633974483,
    tolerance: 1e-12,
  },
  // Excel's ATAN2 takes x before y — the reverse of Math.atan2(y, x) — so an
  // asymmetric pair pins the order: ATAN2(1, 2) is the angle of point (1, 2).
  {
    covers: 'ATAN2/2',
    source: 'ATAN2(1, 2)',
    expected: 1.1071487177940904,
    tolerance: 1e-12,
  },
  // Excel's ACOT lands in (0, pi), not JS-style (-pi/2, pi/2): 3*pi/4 here.
  {
    covers: 'ACOT/1',
    source: 'ACOT(-1)',
    expected: 2.356194490192345,
    tolerance: 1e-12,
  },
  // Hyperbolics and their inverses.
  {
    covers: 'SINH/1',
    source: 'SINH(1)',
    expected: 1.1752011936438014,
    tolerance: 1e-12,
  },
  {
    covers: 'COSH/1',
    source: 'COSH(1)',
    expected: 1.5430806348152437,
    tolerance: 1e-12,
  },
  {
    covers: 'TANH/1',
    source: 'TANH(1)',
    expected: 0.761594155955765,
    tolerance: 1e-12,
  },
  {
    covers: 'COTH/1',
    source: 'COTH(1)',
    expected: 1.3130352854993312,
    tolerance: 1e-12,
  },
  {
    covers: 'SECH/1',
    source: 'SECH(1)',
    expected: 0.6480542736638855,
    tolerance: 1e-12,
  },
  {
    covers: 'CSCH/1',
    source: 'CSCH(1)',
    expected: 0.8509181282393216,
    tolerance: 1e-12,
  },
  {
    covers: 'ASINH/1',
    source: 'ASINH(1)',
    expected: 0.8813735870195429,
    tolerance: 1e-12,
  },
  {
    covers: 'ACOSH/1',
    source: 'ACOSH(2)',
    expected: 1.3169578969248166,
    tolerance: 1e-12,
  },
  {
    covers: 'ATANH/1',
    source: 'ATANH(0.5)',
    expected: 0.5493061443340548,
    tolerance: 1e-12,
  },
  {
    covers: 'ACOTH/1',
    source: 'ACOTH(2)',
    expected: 0.5493061443340548,
    tolerance: 1e-12,
  },
  // Array aggregates.
  { covers: 'SUM/1', source: 'SUM([1, 2, 3, 4.5])', expected: 10.5 },
  { covers: 'PRODUCT/1', source: 'PRODUCT([1.5, 4, 5])', expected: 30 },
  { covers: 'SUMSQ/1', source: 'SUMSQ([3, 4, 12])', expected: 169 },
  {
    covers: 'SUMPRODUCT/1',
    source: 'SUMPRODUCT([[1, 2, 3], [4, 5, 6]])',
    expected: 32,
  },
  { covers: 'SUMX2MY2/2', source: 'SUMX2MY2([3, 5], [1, 2])', expected: 29 },
  { covers: 'SUMX2PY2/2', source: 'SUMX2PY2([3, 5], [1, 2])', expected: 39 },
  { covers: 'SUMXMY2/2', source: 'SUMXMY2([3, 5], [1, 2])', expected: 13 },
  // 2*3^2 + 4*3^3: coefficients each step the exponent by m from n.
  {
    covers: 'SERIESSUM/4',
    source: 'SERIESSUM(3, 2, 1, [2, 4])',
    expected: 126,
  },
  // Nondeterministic, so the assertion is over a sample rather than a value.
  // Range membership alone would be satisfied by a constant, which is the one
  // way a random number generator most obviously fails, so each case draws
  // enough times to insist the answers actually vary.
  {
    covers: 'RAND/0',
    source: '[range(200) | RAND]',
    readableSyntax: false,
    check(outputs) {
      const draws = outputs[0] as number[];
      strictEqual(draws.length, 200);
      ok(
        draws.every(
          (draw) => typeof draw === 'number' && draw >= 0 && draw < 1,
        ),
        'every RAND() draw lands in [0, 1)',
      );
      // Two independent uniform draws collide with probability ~2^-53, so a
      // near-perfect distinct count is expected and a repeat-heavy generator
      // is not.
      ok(
        new Set(draws).size >= 190,
        `expected ~200 distinct draws, got ${new Set(draws).size}`,
      );
      ok(
        draws.some((draw) => draw < 0.5) && draws.some((draw) => draw >= 0.5),
        'draws reach both halves of the range',
      );
    },
  },
  {
    covers: 'RANDBETWEEN/2',
    source: '[range(200) | RANDBETWEEN(5; 10)]',
    readableSyntax: false,
    check(outputs) {
      const draws = outputs[0] as number[];
      strictEqual(draws.length, 200);
      ok(
        draws.every(
          (draw) => Number.isInteger(draw) && draw >= 5 && draw <= 10,
        ),
        'every RANDBETWEEN(5, 10) draw is an integer in [5, 10]',
      );
      // Excel's bounds are inclusive at both ends, which range membership
      // cannot show. Missing any one of the six values across 200 draws has
      // probability (5/6)^200, about 2e-16.
      deepStrictEqual([...new Set(draws)].sort(), [10, 5, 6, 7, 8, 9]);
    },
  },
  // Numeral systems.
  { covers: 'ROMAN/1', source: 'ROMAN(1994)', expected: 'MCMXCIV' },
  { covers: 'ARABIC/1', source: 'ARABIC("MCMXCIV")', expected: 1994 },
];
