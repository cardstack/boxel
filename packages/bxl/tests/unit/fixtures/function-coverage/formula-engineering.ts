import { ok } from 'node:assert';
import type { CoverageCase } from './case.ts';

/**
 * A complex-valued case, asserted on both components.
 *
 * Complex numbers travel as strings like '3+4i', and pinning the string would
 * pin 17-digit formatting rather than the value — but reading back a single
 * component leaves the other one free, which is exactly where a sign slip or
 * a swapped real and imaginary part hides. So the case reads both, each to a
 * tolerance, and the input is chosen to make both non-zero and unequal.
 */
function complexCase(
  covers: string,
  call: string,
  real: number,
  imaginary: number,
  tolerance = 1e-9,
): CoverageCase {
  return {
    covers,
    source: `[IMREAL(${call}), IMAGINARY(${call})]`,
    check(outputs) {
      const [actualReal, actualImaginary] = outputs[0] as number[];
      ok(
        Math.abs(actualReal - real) <= tolerance &&
          Math.abs(actualImaginary - imaginary) <= tolerance,
        `expected ${real} + ${imaginary}i +/- ${tolerance}, got ` +
          `${actualReal} + ${actualImaginary}i`,
      );
    },
  };
}

// Excel's engineering family, which loads as the lazy formula-extras chunk.
// Base conversions return text except the *2DEC forms and DECIMAL, which
// return numbers; complex numbers travel as strings like '3+4i'.
export const formulaEngineeringCases: CoverageCase[] = [
  // Base conversions
  { covers: 'BASE/2', source: 'BASE(7, 2)', expected: '111' },
  // Digits above 9 are uppercase: Excel documents BASE(255, 16) as 'FF'.
  {
    covers: 'BASE/2',
    source: 'BASE(255, 16)',
    expected: 'FF',
  },
  // The third argument is a minimum length, zero-padded.
  { covers: 'BASE/3', source: 'BASE(15, 2, 10)', expected: '0000001111' },
  // Ten-digit binary reads as 10-bit two's complement.
  { covers: 'BIN2DEC/1', source: 'BIN2DEC("1110011100")', expected: -100 },
  { covers: 'BIN2HEX/1', source: 'BIN2HEX("10000")', expected: '10' },
  { covers: 'BIN2HEX/1', source: 'BIN2HEX("11111111")', expected: 'FF' },
  { covers: 'BIN2HEX/2', source: 'BIN2HEX("1001", 3)', expected: '009' },
  { covers: 'BIN2OCT/1', source: 'BIN2OCT("1100100")', expected: '144' },
  { covers: 'BIN2OCT/2', source: 'BIN2OCT("1001", 3)', expected: '011' },
  { covers: 'DEC2BIN/1', source: 'DEC2BIN(-100)', expected: '1110011100' },
  { covers: 'DEC2BIN/2', source: 'DEC2BIN(9, 4)', expected: '1001' },
  { covers: 'DEC2HEX/1', source: 'DEC2HEX(100)', expected: '64' },
  // Excel renders hex digits uppercase — DEC2HEX(-54) is documented as
  // 'FFFFFFFFCA'.
  {
    covers: 'DEC2HEX/1',
    source: 'DEC2HEX(255)',
    expected: 'FF',
  },
  { covers: 'DEC2HEX/2', source: 'DEC2HEX(100, 4)', expected: '0064' },
  { covers: 'DEC2OCT/1', source: 'DEC2OCT(58)', expected: '72' },
  { covers: 'DEC2OCT/2', source: 'DEC2OCT(58, 3)', expected: '072' },
  { covers: 'DECIMAL/2', source: 'DECIMAL("FF", 16)', expected: 255 },
  { covers: 'HEX2BIN/1', source: 'HEX2BIN("B7")', expected: '10110111' },
  { covers: 'HEX2BIN/2', source: 'HEX2BIN("F", 8)', expected: '00001111' },
  // Ten-digit hex reads as 40-bit two's complement.
  { covers: 'HEX2DEC/1', source: 'HEX2DEC("FFFFFFFF5B")', expected: -165 },
  { covers: 'HEX2OCT/1', source: 'HEX2OCT("ff")', expected: '377' },
  { covers: 'HEX2OCT/2', source: 'HEX2OCT("F", 3)', expected: '017' },
  { covers: 'OCT2BIN/1', source: 'OCT2BIN("3")', expected: '11' },
  { covers: 'OCT2BIN/2', source: 'OCT2BIN("3", 3)', expected: '011' },
  { covers: 'OCT2DEC/1', source: 'OCT2DEC("54")', expected: 44 },
  { covers: 'OCT2HEX/1', source: 'OCT2HEX("100")', expected: '40' },
  { covers: 'OCT2HEX/1', source: 'OCT2HEX("377")', expected: 'FF' },
  { covers: 'OCT2HEX/2', source: 'OCT2HEX("100", 4)', expected: '0040' },
  // Bitwise — operands limited to 48 bits, shift counts signed
  { covers: 'BITAND/2', source: 'BITAND(13, 25)', expected: 9 },
  { covers: 'BITAND/2', source: 'BITAND(281474976710656, 1)', throws: /#NUM!/ },
  { covers: 'BITOR/2', source: 'BITOR(23, 10)', expected: 31 },
  { covers: 'BITXOR/2', source: 'BITXOR(5, 3)', expected: 6 },
  { covers: 'BITLSHIFT/2', source: 'BITLSHIFT(4, 2)', expected: 16 },
  // A negative count shifts the other way.
  { covers: 'BITLSHIFT/2', source: 'BITLSHIFT(16, -2)', expected: 4 },
  { covers: 'BITRSHIFT/2', source: 'BITRSHIFT(13, 2)', expected: 3 },
  // Complex construction and parts
  { covers: 'COMPLEX/2', source: 'COMPLEX(3, 4)', expected: '3+4i' },
  // Excel drops a unit coefficient for -1 just as it does for +1:
  // COMPLEX(0, -1) is '-i', the same form IMAGINARY accepts as input.
  {
    covers: 'COMPLEX/2',
    source: 'COMPLEX(0, -1)',
    expected: '-i',
  },
  { covers: 'COMPLEX/3', source: 'COMPLEX(3, 4, "j")', expected: '3+4j' },
  { covers: 'IMREAL/1', source: 'IMREAL("6-9i")', expected: 6 },
  { covers: 'IMAGINARY/1', source: 'IMAGINARY("3+4i")', expected: 4 },
  { covers: 'IMABS/1', source: 'IMABS("3+4i")', expected: 5 },
  {
    covers: 'IMARGUMENT/1',
    source: 'IMARGUMENT("1+i")',
    expected: Math.PI / 4,
    tolerance: 1e-12,
  },
  { covers: 'IMCONJUGATE/1', source: 'IMCONJUGATE("3+4i")', expected: '3-4i' },
  // Complex arithmetic — integer-exact operands, so the strings are exact
  { covers: 'IMSUM/1', source: 'IMSUM(["3+4i", "5-3i"])', expected: '8+i' },
  { covers: 'IMSUM/2', source: 'IMSUM("3+4i", "5-3i")', expected: '8+i' },
  {
    covers: 'IMSUM/3',
    source: 'IMSUM("1+2i", "2+3i", "3-4i")',
    expected: '6+i',
  },
  { covers: 'IMSUB/2', source: 'IMSUB("13+4i", "5+3i")', expected: '8+i' },
  {
    covers: 'IMPRODUCT/1',
    source: 'IMPRODUCT(["3+4i", "5-3i"])',
    expected: '27+11i',
  },
  {
    covers: 'IMDIV/2',
    source: 'IMDIV("-238+240i", "10+24i")',
    expected: '5+12i',
  },
  // (1+i)^3 = -2+2i, both components moving.
  complexCase('IMPOWER/2', 'IMPOWER("1+i", 3)', -2, 2),
  // The principal square root of 3+4i is 2+i.
  complexCase('IMSQRT/1', 'IMSQRT("3+4i")', 2, 1),
  // Complex exp/log. e^(1+i) = e*(cos 1 + i sin 1).
  complexCase(
    'IMEXP/1',
    'IMEXP("1+i")',
    1.4686939399158851,
    2.2873552871788423,
  ),
  // ln(3+4i) = ln 5 + i*atan2(4, 3), principal branch.
  complexCase('IMLN/1', 'IMLN("3+4i")', 1.6094379124341003, 0.9272952180016122),
  // The other two logs are that one divided by ln 10 and ln 2.
  complexCase(
    'IMLOG10/1',
    'IMLOG10("3+4i")',
    0.6989700043360187,
    0.4027191962733731,
  ),
  complexCase(
    'IMLOG2/1',
    'IMLOG2("3+4i")',
    2.321928094887362,
    1.3378042124509761,
  ),
  // Complex trig at z = 1+i rather than at i: on the imaginary axis each of
  // these collapses to a real constant times 1 or i, which leaves the other
  // component at zero and unable to catch a swap. Off the axis, cos and cosh
  // differ only in the sign of the imaginary part, and cot, csc, sec and
  // their hyperbolic partners each pair with another member of the family.
  complexCase(
    'IMCOS/1',
    'IMCOS("1+i")',
    0.8337300251311491,
    -0.9888977057628651,
  ),
  complexCase(
    'IMSIN/1',
    'IMSIN("1+i")',
    1.2984575814159773,
    0.6349639147847361,
  ),
  complexCase(
    'IMTAN/1',
    'IMTAN("1+i")',
    0.2717525853195118,
    1.0839233273386946,
  ),
  complexCase(
    'IMCOT/1',
    'IMCOT("1+i")',
    0.21762156185440273,
    -0.8680141428959249,
  ),
  complexCase(
    'IMCSC/1',
    'IMCSC("1+i")',
    0.6215180171704284,
    -0.30393100162842646,
  ),
  complexCase(
    'IMSEC/1',
    'IMSEC("1+i")',
    0.49833703055518686,
    0.5910838417210451,
  ),
  complexCase(
    'IMCOSH/1',
    'IMCOSH("1+i")',
    0.8337300251311491,
    0.9888977057628651,
  ),
  complexCase(
    'IMSINH/1',
    'IMSINH("1+i")',
    0.6349639147847361,
    1.2984575814159773,
  ),
  complexCase(
    'IMCSCH/1',
    'IMCSCH("1+i")',
    0.30393100162842646,
    -0.6215180171704284,
  ),
  complexCase(
    'IMSECH/1',
    'IMSECH("1+i")',
    0.49833703055518686,
    -0.5910838417210451,
  ),
  // Unit conversion
  { covers: 'CONVERT/3', source: 'CONVERT(1, "hr", "sec")', expected: 3600 },
  // Temperature converts through an offset, not a ratio.
  {
    covers: 'CONVERT/3',
    source: 'CONVERT(0, "C", "F")',
    expected: 32,
    tolerance: 1e-9,
  },
  // Step and error functions
  { covers: 'DELTA/1', source: 'DELTA(0)', expected: 1 },
  { covers: 'DELTA/2', source: 'DELTA(5, 4)', expected: 0 },
  { covers: 'GESTEP/1', source: 'GESTEP(-1)', expected: 0 },
  { covers: 'GESTEP/2', source: 'GESTEP(5, 4)', expected: 1 },
  // Excel's ERF and ERFC are computed to full double precision through the
  // regularized incomplete gamma, not the rational approximation that jq's
  // own `erf` uses, so these tolerances are tight rather than loose.
  {
    covers: 'ERF/1',
    source: 'ERF(1)',
    expected: 0.8427007929497149,
    tolerance: 1e-15,
  },
  // erf is odd and zero at the origin, both exactly.
  { covers: 'ERF/1', source: 'ERF(0)', expected: 0 },
  {
    covers: 'ERF/1',
    source: 'ERF(-1)',
    expected: -0.8427007929497149,
    tolerance: 1e-15,
  },
  // The two-argument form integrates between bounds: erf(upper) - erf(lower).
  // Both bounds are non-zero, so ignoring the lower one is visible.
  {
    covers: 'ERF/2',
    source: 'ERF(1, 2)',
    expected: 0.15262147206923782,
    tolerance: 1e-15,
  },
  {
    covers: 'ERFC/1',
    source: 'ERFC(1)',
    expected: 0.15729920705028513,
    tolerance: 1e-15,
  },
  { covers: 'ERFC/1', source: 'ERFC(0)', expected: 1 },
  // x² is what the series takes, and it runs out of exponent long before erf
  // stops being ±1: past about 1.3e154 it overflows, and the answer is the
  // saturated one rather than the NaN a series would return.
  { covers: 'ERF/1', source: 'ERF(POWER(10, 200))', expected: 1 },
  { covers: 'ERF/1', source: 'ERF(-POWER(10, 200))', expected: -1 },
  { covers: 'ERFC/1', source: 'ERFC(POWER(10, 200))', expected: 0 },
  { covers: 'ERFC/1', source: 'ERFC(-POWER(10, 200))', expected: 2 },
  // At the other end x² is subnormal, where erf is 2x/√π exactly.
  {
    covers: 'ERF/1',
    source: 'ERF(POWER(10, -300))',
    expected: 1.1283791670955126e-300,
    tolerance: 1e-315,
  },
  // The complement is computed as the upper tail rather than as 1 - ERF, which
  // is the only way the far tail keeps any significant digits at all.
  {
    covers: 'ERFC/1',
    source: 'ERFC(6)',
    expected: 2.1519736712498913e-17,
    tolerance: 1e-25,
  },
  { covers: 'UNICHAR/1', source: 'UNICHAR(66)', expected: 'B' },
];
