import type { CoverageCase } from './case.ts';

// Excel's engineering family, which loads as the lazy formula-extras chunk.
// Base conversions return text except the *2DEC forms and DECIMAL, which
// return numbers; complex numbers travel as strings like '3+4i'. Where the
// exact string result would carry 17-digit decimals, the case extracts one
// numeric part with IMREAL/IMAGINARY and pins the identity the value must
// satisfy, with a tolerance, instead of pinning the formatting.
export const formulaEngineeringCases: CoverageCase[] = [
  // Base conversions
  { covers: 'BASE/2', source: 'BASE(7, 2)', expected: '111' },
  // Digits above 9 are uppercase: Excel documents BASE(255, 16) as 'FF'.
  {
    covers: 'BASE/2',
    source: 'BASE(255, 16)',
    expected: 'FF',
    knownDefect:
      'a bare toString(radix) with no toUpperCase. The whole hex-emitting ' +
      'family is affected — BIN2HEX, DEC2HEX, OCT2HEX, BASE. The input side ' +
      'already accepts either casing, so uppercasing output breaks no ' +
      'round trip',
  },
  // The third argument is a minimum length, zero-padded.
  { covers: 'BASE/3', source: 'BASE(15, 2, 10)', expected: '0000001111' },
  // Ten-digit binary reads as 10-bit two's complement.
  { covers: 'BIN2DEC/1', source: 'BIN2DEC("1110011100")', expected: -100 },
  { covers: 'BIN2HEX/1', source: 'BIN2HEX("10000")', expected: '10' },
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
    knownDefect: 'lowercase hex digits, as for BASE/2',
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
    knownDefect:
      'formatComplex special-cases an imaginary part of 1 to drop the ' +
      'coefficient but has no mirror for -1, so it emits "-1i". The library ' +
      'parses "-i" perfectly well — it just cannot write it — and every ' +
      'IM* function formats through here',
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
  // (1+i)^2 = 2i
  {
    covers: 'IMPOWER/2',
    source: 'IMAGINARY(IMPOWER("1+i", 2))',
    expected: 2,
    tolerance: 1e-9,
  },
  // The principal square root of -1 is i.
  {
    covers: 'IMSQRT/1',
    source: 'IMAGINARY(IMSQRT("-1"))',
    expected: 1,
    tolerance: 1e-9,
  },
  // Complex exp/log
  {
    covers: 'IMEXP/1',
    source: 'IMREAL(IMEXP("1"))',
    expected: 2.7182818285,
    tolerance: 1e-9,
  },
  // ln(i) = i*pi/2 (principal branch)
  {
    covers: 'IMLN/1',
    source: 'IMAGINARY(IMLN("i"))',
    expected: Math.PI / 2,
    tolerance: 1e-12,
  },
  {
    covers: 'IMLOG10/1',
    source: 'IMREAL(IMLOG10("100"))',
    expected: 2,
    tolerance: 1e-9,
  },
  {
    covers: 'IMLOG2/1',
    source: 'IMREAL(IMLOG2("8"))',
    expected: 3,
    tolerance: 1e-9,
  },
  // Complex trig at z = i, where each value reduces to a real hyperbolic
  // (or plain trig) constant: cos(i) = cosh(1), sin(i) = i*sinh(1), etc.
  {
    covers: 'IMCOS/1',
    source: 'IMREAL(IMCOS("i"))',
    expected: 1.5430806348,
    tolerance: 1e-9,
  },
  {
    covers: 'IMSIN/1',
    source: 'IMAGINARY(IMSIN("i"))',
    expected: 1.1752011936,
    tolerance: 1e-9,
  },
  {
    covers: 'IMTAN/1',
    source: 'IMAGINARY(IMTAN("i"))',
    expected: 0.761594156,
    tolerance: 1e-9,
  },
  {
    covers: 'IMCOT/1',
    source: 'IMAGINARY(IMCOT("i"))',
    expected: -1.3130352855,
    tolerance: 1e-9,
  },
  {
    covers: 'IMCSC/1',
    source: 'IMAGINARY(IMCSC("i"))',
    expected: -0.8509181282,
    tolerance: 1e-9,
  },
  {
    covers: 'IMSEC/1',
    source: 'IMREAL(IMSEC("i"))',
    expected: 0.6480542737,
    tolerance: 1e-9,
  },
  {
    covers: 'IMCOSH/1',
    source: 'IMREAL(IMCOSH("i"))',
    expected: 0.5403023059,
    tolerance: 1e-9,
  },
  {
    covers: 'IMSINH/1',
    source: 'IMAGINARY(IMSINH("i"))',
    expected: 0.8414709848,
    tolerance: 1e-9,
  },
  {
    covers: 'IMCSCH/1',
    source: 'IMAGINARY(IMCSCH("i"))',
    expected: -1.1883951058,
    tolerance: 1e-9,
  },
  {
    covers: 'IMSECH/1',
    source: 'IMREAL(IMSECH("i"))',
    expected: 1.8508157177,
    tolerance: 1e-9,
  },
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
  // erf tolerances are loose because the usual rational approximation is
  // only accurate to about 1e-7.
  {
    covers: 'ERF/1',
    source: 'ERF(1)',
    expected: 0.8427007929,
    tolerance: 1e-6,
  },
  // The two-argument form integrates between bounds: ERF(0, 1) = erf(1).
  {
    covers: 'ERF/2',
    source: 'ERF(0, 1)',
    expected: 0.8427007929,
    tolerance: 1e-6,
  },
  {
    covers: 'ERFC/1',
    source: 'ERFC(1)',
    expected: 0.1572992071,
    tolerance: 1e-6,
  },
  { covers: 'UNICHAR/1', source: 'UNICHAR(66)', expected: 'B' },
];
