import { flattenExcelArgs, parseExcelNumber, parseExcelString } from './common.js';
import { EXCEL_ERROR, throwExcelError } from './errors.js';

const MAX_BITWISE = 281474976710655n;
const DEC2BIN_MIN = -512;
const DEC2BIN_MAX = 511;
const DEC2HEX_MIN = -549755813888;
const DEC2HEX_MAX = 549755813887;
const DEC2OCT_MIN = -536870912;
const DEC2OCT_MAX = 536870911;

type ImaginaryUnit = 'i' | 'j';

interface ComplexNumber {
  real: number;
  imaginary: number;
  unit: ImaginaryUnit;
}

function parseEngineeringInteger(value: unknown) {
  const number = parseExcelNumber(value);
  if (!Number.isInteger(number)) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return number;
}

function parsePlaces(placesLike: unknown) {
  if (placesLike === undefined) {
    return undefined;
  }

  const places = parseExcelNumber(placesLike);
  if (Number.isNaN(places)) {
    throwExcelError(EXCEL_ERROR.value);
  }
  if (places < 0) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return Math.floor(places);
}

function padResult(result: string, placesLike: unknown) {
  const places = parsePlaces(placesLike);
  if (places === undefined) {
    return result;
  }
  if (places < result.length) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return `${'0'.repeat(places - result.length)}${result}`;
}

function parseBitwiseOperand(value: unknown) {
  const number = parseEngineeringInteger(value);
  if (number < 0 || BigInt(number) > MAX_BITWISE) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return BigInt(number);
}

function ensureMatches(value: string, pattern: RegExp) {
  if (!pattern.test(value)) {
    throwExcelError(EXCEL_ERROR.num);
  }
}

function parseComplex(value: unknown): ComplexNumber {
  if (value === undefined || value === true || value === false) {
    throwExcelError(EXCEL_ERROR.value);
  }

  if (value === 0 || value === '0') {
    return { real: 0, imaginary: 0, unit: 'i' };
  }

  const raw = String(value);
  const last = raw.slice(-1);

  if (last !== 'i' && last !== 'j') {
    const real = Number(raw);
    if (Number.isNaN(real)) {
      throwExcelError(EXCEL_ERROR.num);
    }
    return { real, imaginary: 0, unit: 'i' };
  }

  const unit = last as ImaginaryUnit;
  const body = raw.slice(0, -1);

  if (body === '' || body === '+') {
    return { real: 0, imaginary: 1, unit };
  }

  if (body === '-') {
    return { real: 0, imaginary: -1, unit };
  }

  let splitIndex = -1;
  for (let index = 1; index < body.length; index++) {
    const char = body[index];
    if (char === '+' || char === '-') {
      splitIndex = index;
    }
  }

  if (splitIndex === -1) {
    const imaginary = Number(body);
    if (Number.isNaN(imaginary)) {
      throwExcelError(EXCEL_ERROR.num);
    }
    return { real: 0, imaginary, unit };
  }

  const realPart = Number(body.slice(0, splitIndex));
  const imaginaryPart = body.slice(splitIndex);
  const imaginary = imaginaryPart === '+'
    ? 1
    : imaginaryPart === '-'
      ? -1
      : Number(imaginaryPart);

  if (Number.isNaN(realPart) || Number.isNaN(imaginary)) {
    throwExcelError(EXCEL_ERROR.num);
  }

  return { real: realPart, imaginary, unit };
}

function formatComplex(real: number, imaginary: number, unit: ImaginaryUnit) {
  if (real === 0 && imaginary === 0) {
    return 0;
  }
  if (real === 0) {
    return imaginary === 1 ? unit : `${imaginary}${unit}`;
  }
  if (imaginary === 0) {
    return String(real);
  }
  const sign = imaginary > 0 ? '+' : '';
  return `${real}${sign}${imaginary === 1 ? unit : `${imaginary}${unit}`}`;
}

export function excelBitAnd(leftLike: unknown, rightLike: unknown) {
  return Number(parseBitwiseOperand(leftLike) & parseBitwiseOperand(rightLike));
}

export function excelBitOr(leftLike: unknown, rightLike: unknown) {
  return Number(parseBitwiseOperand(leftLike) | parseBitwiseOperand(rightLike));
}

export function excelBitXor(leftLike: unknown, rightLike: unknown) {
  return Number(parseBitwiseOperand(leftLike) ^ parseBitwiseOperand(rightLike));
}

export function excelBitLShift(numberLike: unknown, shiftLike: unknown) {
  const number = parseBitwiseOperand(numberLike);
  const shift = parseEngineeringInteger(shiftLike);

  if (Math.abs(shift) > 53) {
    throwExcelError(EXCEL_ERROR.num);
  }

  return Number(shift >= 0 ? number << BigInt(shift) : number >> BigInt(-shift));
}

export function excelBitRShift(numberLike: unknown, shiftLike: unknown) {
  const number = parseBitwiseOperand(numberLike);
  const shift = parseEngineeringInteger(shiftLike);

  if (Math.abs(shift) > 53) {
    throwExcelError(EXCEL_ERROR.num);
  }

  return Number(shift >= 0 ? number >> BigInt(shift) : number << BigInt(-shift));
}

export function excelBin2Dec(numberLike: unknown) {
  const number = parseExcelString(numberLike);
  ensureMatches(number, /^[01]{1,10}$/);
  if (number.length === 10 && number.startsWith('1')) {
    return parseInt(number.slice(1), 2) - 512;
  }
  return parseInt(number, 2);
}

export function excelBin2Hex(numberLike: unknown, placesLike?: unknown) {
  const number = parseExcelString(numberLike);
  ensureMatches(number, /^[01]{1,10}$/);

  if (number.length === 10 && number.startsWith('1')) {
    return (1099511627264 + parseInt(number.slice(1), 2)).toString(16);
  }

  return padResult(parseInt(number, 2).toString(16), placesLike);
}

export function excelBin2Oct(numberLike: unknown, placesLike?: unknown) {
  const number = parseExcelString(numberLike);
  ensureMatches(number, /^[01]{1,10}$/);

  if (number.length === 10 && number.startsWith('1')) {
    return (1073741312 + parseInt(number.slice(1), 2)).toString(8);
  }

  return padResult(parseInt(number, 2).toString(8), placesLike);
}

export function excelDec2Bin(numberLike: unknown, placesLike?: unknown) {
  const number = parseEngineeringInteger(numberLike);
  if (!/^-?[0-9]{1,3}$/.test(String(number)) || number < DEC2BIN_MIN || number > DEC2BIN_MAX) {
    throwExcelError(EXCEL_ERROR.num);
  }

  if (number < 0) {
    return `1${'0'.repeat(9 - (512 + number).toString(2).length)}${(512 + number).toString(2)}`;
  }

  return padResult(number.toString(2), placesLike);
}

export function excelDec2Hex(numberLike: unknown, placesLike?: unknown) {
  const number = parseEngineeringInteger(numberLike);
  if (!/^-?[0-9]{1,12}$/.test(String(number)) || number < DEC2HEX_MIN || number > DEC2HEX_MAX) {
    throwExcelError(EXCEL_ERROR.num);
  }

  if (number < 0) {
    return (1099511627776 + number).toString(16);
  }

  return padResult(number.toString(16), placesLike);
}

export function excelDec2Oct(numberLike: unknown, placesLike?: unknown) {
  const number = parseEngineeringInteger(numberLike);
  if (!/^-?[0-9]{1,9}$/.test(String(number)) || number < DEC2OCT_MIN || number > DEC2OCT_MAX) {
    throwExcelError(EXCEL_ERROR.num);
  }

  if (number < 0) {
    return (1073741824 + number).toString(8);
  }

  return padResult(number.toString(8), placesLike);
}

export function excelHex2Bin(numberLike: unknown, placesLike?: unknown) {
  const number = parseExcelString(numberLike);
  ensureMatches(number, /^[0-9A-Fa-f]{1,10}$/);

  const negative = number.length === 10 && number[0]!.toLowerCase() === 'f';
  const decimal = negative ? parseInt(number, 16) - 1099511627776 : parseInt(number, 16);
  if (decimal < DEC2BIN_MIN || decimal > DEC2BIN_MAX) {
    throwExcelError(EXCEL_ERROR.num);
  }

  if (negative) {
    return `1${'0'.repeat(9 - (512 + decimal).toString(2).length)}${(512 + decimal).toString(2)}`;
  }

  return padResult(decimal.toString(2), placesLike);
}

export function excelHex2Dec(numberLike: unknown) {
  const number = parseExcelString(numberLike);
  ensureMatches(number, /^[0-9A-Fa-f]{1,10}$/);
  const decimal = parseInt(number, 16);
  return decimal >= 549755813888 ? decimal - 1099511627776 : decimal;
}

export function excelHex2Oct(numberLike: unknown, placesLike?: unknown) {
  const number = parseExcelString(numberLike);
  ensureMatches(number, /^[0-9A-Fa-f]{1,10}$/);

  const decimal = parseInt(number, 16);
  if (decimal > 536870911 && decimal < 1098974756864) {
    throwExcelError(EXCEL_ERROR.num);
  }

  if (decimal >= 1098974756864) {
    return (decimal - 1098437885952).toString(8);
  }

  return padResult(decimal.toString(8), placesLike);
}

export function excelOct2Bin(numberLike: unknown, placesLike?: unknown) {
  const number = parseExcelString(numberLike);
  ensureMatches(number, /^[0-7]{1,10}$/);

  const negative = number.length === 10 && number.startsWith('7');
  const decimal = negative ? parseInt(number, 8) - 1073741824 : parseInt(number, 8);
  if (decimal < DEC2BIN_MIN || decimal > DEC2BIN_MAX) {
    throwExcelError(EXCEL_ERROR.num);
  }

  if (negative) {
    return `1${'0'.repeat(9 - (512 + decimal).toString(2).length)}${(512 + decimal).toString(2)}`;
  }

  return padResult(decimal.toString(2), placesLike);
}

export function excelOct2Dec(numberLike: unknown) {
  const number = parseExcelString(numberLike);
  ensureMatches(number, /^[0-7]{1,10}$/);
  const decimal = parseInt(number, 8);
  return decimal >= 536870912 ? decimal - 1073741824 : decimal;
}

export function excelOct2Hex(numberLike: unknown, placesLike?: unknown) {
  const number = parseExcelString(numberLike);
  ensureMatches(number, /^[0-7]{1,10}$/);

  const decimal = parseInt(number, 8);
  if (decimal >= 536870912) {
    return `ff${(decimal + 3221225472).toString(16)}`;
  }

  return padResult(decimal.toString(16), placesLike);
}

export function excelDelta(leftLike: unknown, rightLike: unknown = 0) {
  return parseExcelNumber(leftLike) === parseExcelNumber(rightLike) ? 1 : 0;
}

export function excelGestep(numberLike: unknown, stepLike: unknown = 0) {
  return parseExcelNumber(numberLike) >= parseExcelNumber(stepLike) ? 1 : 0;
}

export function excelBase(numberLike: unknown, radixLike: unknown, minLengthLike = 0) {
  const number = parseExcelNumber(numberLike);
  const radix = parseExcelNumber(radixLike);
  const minLength = parseExcelNumber(minLengthLike);

  if (radix === 0) {
    throwExcelError(EXCEL_ERROR.num);
  }

  const result = number.toString(radix);
  return `${'0'.repeat(Math.max(minLength - result.length, 0))}${result}`;
}

export function excelDecimal(textLike: unknown, radixLike: unknown) {
  const text = parseExcelString(textLike) || '0';
  const radix = parseExcelNumber(radixLike);
  if (radix === 0) {
    throwExcelError(EXCEL_ERROR.num);
  }
  const result = parseInt(text, radix);
  if (Number.isNaN(result)) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return result;
}

export function excelComplex(realLike: unknown, imaginaryLike: unknown, unitLike: unknown = 'i') {
  const real = parseExcelNumber(realLike);
  const imaginary = parseExcelNumber(imaginaryLike);
  const unitText = unitLike === undefined ? 'i' : parseExcelString(unitLike);

  if (unitText !== 'i' && unitText !== 'j') {
    throwExcelError(EXCEL_ERROR.value);
  }

  return formatComplex(real, imaginary, unitText);
}

export function excelImReal(valueLike: unknown) {
  return parseComplex(valueLike).real;
}

export function excelImImaginary(valueLike: unknown) {
  return parseComplex(valueLike).imaginary;
}

export function excelImAbs(valueLike: unknown) {
  const value = parseComplex(valueLike);
  return Math.sqrt(value.real ** 2 + value.imaginary ** 2);
}

export function excelImConjugate(valueLike: unknown) {
  const value = parseComplex(valueLike);
  return formatComplex(value.real, -value.imaginary, value.unit);
}

export function excelImSub(leftLike: unknown, rightLike: unknown) {
  const left = parseComplex(leftLike);
  const right = parseComplex(rightLike);
  const unit = left.unit === 'j' || right.unit === 'j' ? 'j' : 'i';
  return formatComplex(left.real - right.real, left.imaginary - right.imaginary, unit);
}

export function excelImSum(valuesLike: unknown) {
  const values = flattenExcelArgs(valuesLike);
  if (values.length === 0) {
    throwExcelError(EXCEL_ERROR.value);
  }

  let real = 0;
  let imaginary = 0;
  let unit: ImaginaryUnit = 'i';

  for (const valueLike of values) {
    const value = parseComplex(valueLike);
    if (value.unit === 'j') {
      unit = 'j';
    }
    real += value.real;
    imaginary += value.imaginary;
  }

  return formatComplex(real, imaginary, unit);
}

// ═══════════════════════════════════════════════════════════════
// Complex number trig/exp/log/arithmetic
// ═══════════════════════════════════════════════════════════════

export function excelImCos(valueLike: unknown) {
  const z = parseComplex(valueLike);
  // cos(a+bi) = cos(a)cosh(b) - i*sin(a)sinh(b)
  return formatComplex(
    Math.cos(z.real) * Math.cosh(z.imaginary),
    -Math.sin(z.real) * Math.sinh(z.imaginary),
    z.unit,
  );
}

export function excelImSin(valueLike: unknown) {
  const z = parseComplex(valueLike);
  // sin(a+bi) = sin(a)cosh(b) + i*cos(a)sinh(b)
  return formatComplex(
    Math.sin(z.real) * Math.cosh(z.imaginary),
    Math.cos(z.real) * Math.sinh(z.imaginary),
    z.unit,
  );
}

export function excelImTan(valueLike: unknown) {
  const z = parseComplex(valueLike);
  const d = Math.cos(2 * z.real) + Math.cosh(2 * z.imaginary);
  if (d === 0) throwExcelError(EXCEL_ERROR.num);
  return formatComplex(
    Math.sin(2 * z.real) / d,
    Math.sinh(2 * z.imaginary) / d,
    z.unit,
  );
}

export function excelImCot(valueLike: unknown) {
  return excelImDiv(excelImCos(valueLike), excelImSin(valueLike));
}

export function excelImCsc(valueLike: unknown) {
  return excelImDiv(1, excelImSin(valueLike));
}

export function excelImSec(valueLike: unknown) {
  return excelImDiv(1, excelImCos(valueLike));
}

export function excelImCosh(valueLike: unknown) {
  const z = parseComplex(valueLike);
  return formatComplex(
    Math.cosh(z.real) * Math.cos(z.imaginary),
    Math.sinh(z.real) * Math.sin(z.imaginary),
    z.unit,
  );
}

export function excelImSinh(valueLike: unknown) {
  const z = parseComplex(valueLike);
  return formatComplex(
    Math.sinh(z.real) * Math.cos(z.imaginary),
    Math.cosh(z.real) * Math.sin(z.imaginary),
    z.unit,
  );
}

export function excelImCsch(valueLike: unknown) {
  return excelImDiv(1, excelImSinh(valueLike));
}

export function excelImSech(valueLike: unknown) {
  return excelImDiv(1, excelImCosh(valueLike));
}

export function excelImExp(valueLike: unknown) {
  const z = parseComplex(valueLike);
  // e^(a+bi) = e^a * (cos(b) + i*sin(b))
  const ea = Math.exp(z.real);
  return formatComplex(
    ea * Math.cos(z.imaginary),
    ea * Math.sin(z.imaginary),
    z.unit,
  );
}

export function excelImLn(valueLike: unknown) {
  const z = parseComplex(valueLike);
  const r = Math.sqrt(z.real ** 2 + z.imaginary ** 2);
  if (r === 0) throwExcelError(EXCEL_ERROR.num);
  return formatComplex(Math.log(r), Math.atan2(z.imaginary, z.real), z.unit);
}

export function excelImLog10(valueLike: unknown) {
  const z = parseComplex(valueLike);
  const r = Math.sqrt(z.real ** 2 + z.imaginary ** 2);
  if (r === 0) throwExcelError(EXCEL_ERROR.num);
  const ln10 = Math.log(10);
  return formatComplex(Math.log(r) / ln10, Math.atan2(z.imaginary, z.real) / ln10, z.unit);
}

export function excelImLog2(valueLike: unknown) {
  const z = parseComplex(valueLike);
  const r = Math.sqrt(z.real ** 2 + z.imaginary ** 2);
  if (r === 0) throwExcelError(EXCEL_ERROR.num);
  const ln2 = Math.log(2);
  return formatComplex(Math.log(r) / ln2, Math.atan2(z.imaginary, z.real) / ln2, z.unit);
}

export function excelImDiv(leftLike: unknown, rightLike: unknown) {
  const a = parseComplex(leftLike);
  const b = parseComplex(rightLike);
  const denom = b.real ** 2 + b.imaginary ** 2;
  if (denom === 0) throwExcelError(EXCEL_ERROR.num);
  const unit = a.unit === 'j' || b.unit === 'j' ? 'j' : 'i';
  return formatComplex(
    (a.real * b.real + a.imaginary * b.imaginary) / denom,
    (a.imaginary * b.real - a.real * b.imaginary) / denom,
    unit,
  );
}

export function excelImProduct(valuesLike: unknown) {
  const values = flattenExcelArgs(valuesLike);
  if (values.length === 0) throwExcelError(EXCEL_ERROR.value);
  let real = 1;
  let imaginary = 0;
  let unit: ImaginaryUnit = 'i';
  for (const valueLike of values) {
    const z = parseComplex(valueLike);
    if (z.unit === 'j') unit = 'j';
    const newReal = real * z.real - imaginary * z.imaginary;
    const newImag = real * z.imaginary + imaginary * z.real;
    real = newReal;
    imaginary = newImag;
  }
  return formatComplex(real, imaginary, unit);
}

export function excelImPower(valueLike: unknown, powerLike: unknown) {
  const z = parseComplex(valueLike);
  const n = parseExcelNumber(powerLike);
  const r = Math.sqrt(z.real ** 2 + z.imaginary ** 2);
  const theta = Math.atan2(z.imaginary, z.real);
  const rn = Math.pow(r, n);
  return formatComplex(rn * Math.cos(n * theta), rn * Math.sin(n * theta), z.unit);
}

export function excelImSqrt(valueLike: unknown) {
  const z = parseComplex(valueLike);
  const r = Math.sqrt(z.real ** 2 + z.imaginary ** 2);
  const theta = Math.atan2(z.imaginary, z.real);
  return formatComplex(
    Math.sqrt(r) * Math.cos(theta / 2),
    Math.sqrt(r) * Math.sin(theta / 2),
    z.unit,
  );
}

export function excelImArgument(valueLike: unknown) {
  const z = parseComplex(valueLike);
  if (z.real === 0 && z.imaginary === 0) throwExcelError(EXCEL_ERROR.div0);
  return Math.atan2(z.imaginary, z.real);
}

// ═══════════════════════════════════════════════════════════════
// ERF / ERFC
// ═══════════════════════════════════════════════════════════════

// Horner approximation of erf (Abramowitz and Stegun 7.1.26)
export function excelErf(lowerLike: unknown, upperLike?: unknown) {
  function erf1(x: number) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const t = 1 / (1 + p * Math.abs(x));
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }
  const lower = parseExcelNumber(lowerLike);
  if (upperLike !== undefined) {
    const upper = parseExcelNumber(upperLike);
    return erf1(upper) - erf1(lower);
  }
  return erf1(lower);
}

export function excelErfc(valueLike: unknown) {
  return 1 - excelErf(valueLike);
}

// ═══════════════════════════════════════════════════════════════
// CONVERT — unit conversion (ported from formulajs)
// ═══════════════════════════════════════════════════════════════

// [symbol, alternates, category, factor-to-SI-base]
type UnitDef = [string, string[] | null, string, number];

const UNITS: UnitDef[] = [
  // Length (base: metre)
  ['m', null, 'length', 1],
  ['mi', null, 'length', 1609.344],
  ['Nmi', ['M'], 'length', 1852],
  ['in', null, 'length', 0.0254],
  ['ft', null, 'length', 0.3048],
  ['yd', null, 'length', 0.9144],
  ['ang', ['Å'], 'length', 1e-10],
  ['ell', null, 'length', 1.143],
  ['ly', null, 'length', 9460730472580800],
  ['pc', ['parsec'], 'length', 30856775814671900],
  ['Pica', ['Picapt'], 'length', 0.00423333333333333],
  ['pica', null, 'length', 0.00035277777777778],
  ['survey_mi', null, 'length', 1609.347219],
  ['ua', null, 'length', 149597870691.667],

  // Mass (base: kilogram)
  ['kg', null, 'mass', 1],
  ['g', null, 'mass', 0.001],
  ['lbm', null, 'mass', 0.45359237],
  ['ozm', null, 'mass', 0.028349523125],
  ['stone', null, 'mass', 6.35029318],
  ['ton', null, 'mass', 907.18474],
  ['t', null, 'mass', 1000],
  ['sg', null, 'mass', 14.59390294],
  ['grain', null, 'mass', 0.0000647989],
  ['cwt', ['shweight'], 'mass', 45.359237],
  ['lcwt', ['uk_cwt', 'hweight'], 'mass', 50.802345],
  ['brton', ['uk_ton', 'LTON'], 'mass', 1016.046909],
  ['Da', ['u'], 'mass', 1.66053886282828e-27],

  // Time (base: second)
  ['s', ['sec'], 'time', 1],
  ['min', ['mn'], 'time', 60],
  ['h', ['hr'], 'time', 3600],
  ['d', ['day'], 'time', 86400],
  ['yr', null, 'time', 31557600],

  // Temperature (base: kelvin — special handling below)
  ['K', ['kel'], 'temperature', 1],
  ['Rank', null, 'temperature', 0.555555555555556],

  // Speed (base: m/s)
  ['m/s', ['m/sec'], 'speed', 1],
  ['m/h', ['m/hr'], 'speed', 0.00027777777777778],
  ['mph', null, 'speed', 0.44704],
  ['kn', null, 'speed', 0.514444444444444],
  ['admkn', null, 'speed', 0.514773333],

  // Area (base: m²)
  ['m2', ['m^2'], 'area', 1],
  ['ft2', ['ft^2'], 'area', 0.09290304],
  ['in2', ['in^2'], 'area', 0.00064516],
  ['yd2', ['yd^2'], 'area', 0.83612736],
  ['mi2', ['mi^2'], 'area', 2589988.110336],
  ['Nmi2', ['Nmi^2'], 'area', 3429904],
  ['Pica2', ['Picapt2', 'Pica^2', 'Picapt^2'], 'area', 0.00001792111111111],
  ['ang2', ['ang^2'], 'area', 1e-20],
  ['ly2', ['ly^2'], 'area', 8.95054210748189e31],
  ['ar', null, 'area', 100],
  ['ha', null, 'area', 10000],
  ['uk_acre', null, 'area', 4046.8564224],
  ['us_acre', null, 'area', 4046.87261],
  ['Morgen', null, 'area', 2500],

  // Volume (base: m³)
  ['m3', ['m^3'], 'volume', 1],
  ['L', ['l', 'lt'], 'volume', 0.001],
  ['ft3', ['ft^3'], 'volume', 0.028316846592],
  ['in3', ['in^3'], 'volume', 0.000016387064],
  ['yd3', ['yd^3'], 'volume', 0.764554857984],
  ['mi3', ['mi^3'], 'volume', 4168181825.44058],
  ['Nmi3', ['Nmi^3'], 'volume', 6352182208],
  ['Pica3', ['Picapt3', 'Pica^3', 'Picapt^3'], 'volume', 7.58660370370369e-8],
  ['ang3', ['ang^3'], 'volume', 1e-30],
  ['ly3', ['ly^3'], 'volume', 8.46786664623715e-47],
  ['gal', null, 'volume', 0.003785411784],
  ['qt', null, 'volume', 0.000946352946],
  ['pt', ['us_pt'], 'volume', 0.000473176473],
  ['cup', null, 'volume', 0.0002365882365],
  ['oz', null, 'volume', 0.0000295735295625],
  ['tbs', null, 'volume', 0.0000147868],
  ['tsp', null, 'volume', 0.00000492892],
  ['tspm', null, 'volume', 0.000005],
  ['uk_gal', null, 'volume', 0.00454609],
  ['uk_qt', null, 'volume', 0.0011365225],
  ['uk_pt', null, 'volume', 0.00056826125],
  ['bushel', null, 'volume', 0.03523907],
  ['barrel', null, 'volume', 0.158987295],
  ['GRT', ['regton'], 'volume', 2.8316846592],
  ['MTON', null, 'volume', 1.13267386368],

  // Energy (base: joule)
  ['J', null, 'energy', 1],
  ['cal', null, 'energy', 4.1868],
  ['c', null, 'energy', 4.184],
  ['eV', ['ev'], 'energy', 1.60217656514141e-19],
  ['BTU', ['btu'], 'energy', 1055.05585262],
  ['HPh', ['hh', 'hph'], 'energy', 2684519.538],
  ['Wh', ['wh'], 'energy', 3600],
  ['flb', null, 'energy', 1.3558179483314],
  ['erg', null, 'energy', 1e-7],
  ['Eh', null, 'energy', 4.35974417757576e-18],

  // Power (base: watt)
  ['W', null, 'power', 1],
  ['HP', null, 'power', 745.69987158227],
  ['PS', null, 'power', 735.49875],

  // Force (base: newton)
  ['N', null, 'force', 1],
  ['dyn', ['dy'], 'force', 0.00001],
  ['lbf', null, 'force', 4.4482216152605],
  ['pond', null, 'force', 0.00980665],

  // Pressure (base: pascal)
  ['Pa', null, 'pressure', 1],
  ['bar', null, 'pressure', 100000],
  ['mmHg', null, 'pressure', 133.322],

  // Angle (base: radian)
  ['rad', null, 'angle', 1],
  // degree symbol handled via alternate
  ['deg', ['°'], 'angle', 0.0174532925199433],

  // Frequency (base: hertz)
  ['Hz', null, 'frequency', 1],

  // Electric current (base: ampere)
  ['A', null, 'electric_current', 1],

  // Voltage (base: volt)
  ['V', null, 'voltage', 1],

  // Information (base: bit — uses binary prefixes)
  ['bit', ['b'], 'information', 1],
  ['byte', null, 'information', 8],

  // Magnetic flux density
  ['T', null, 'magnetic_flux_density', 1],
  ['G', ['ga'], 'magnetic_flux_density', 0.0001],
];

// SI prefixes: [abbreviation, multiplier]
const SI_PREFIXES: [string, number][] = [
  ['Y', 1e24], ['Z', 1e21], ['E', 1e18], ['P', 1e15], ['T', 1e12],
  ['G', 1e9], ['M', 1e6], ['k', 1e3], ['h', 1e2], ['da', 1e1],
  ['e', 1e1], ['d', 1e-1], ['c', 1e-2], ['m', 1e-3], ['u', 1e-6],
  ['n', 1e-9], ['p', 1e-12], ['f', 1e-15], ['a', 1e-18],
  ['z', 1e-21], ['y', 1e-24],
];

// Binary prefixes for information units
const BINARY_PREFIXES: [string, number][] = [
  ['Yi', 1208925819614629174706176], ['Zi', 1180591620717411303424],
  ['Ei', 1152921504606846976], ['Pi', 1125899906842624],
  ['Ti', 1099511627776], ['Gi', 1073741824], ['Mi', 1048576], ['ki', 1024],
];

interface ResolvedUnit {
  def: UnitDef;
  multiplier: number;
}

function resolveUnit(unitStr: string): ResolvedUnit | null {
  // Exact match on symbol or alternates
  for (const def of UNITS) {
    if (def[0] === unitStr) return { def, multiplier: 1 };
    if (def[1]) {
      for (const alt of def[1]) {
        if (alt === unitStr) return { def, multiplier: 1 };
      }
    }
  }

  // Try binary prefixes (2-char, only for information)
  if (unitStr.length > 2) {
    const bPrefix = unitStr.slice(0, 2);
    const bBase = unitStr.slice(2);
    for (const [abbr, mult] of BINARY_PREFIXES) {
      if (abbr === bPrefix) {
        for (const def of UNITS) {
          if (def[2] === 'information' && (def[0] === bBase || (def[1] && def[1].includes(bBase)))) {
            return { def, multiplier: mult };
          }
        }
      }
    }
  }

  // Try 2-char SI prefix 'da' first
  if (unitStr.length > 2 && unitStr.startsWith('da')) {
    const base = unitStr.slice(2);
    for (const def of UNITS) {
      if (def[0] === base || (def[1] && def[1].includes(base))) {
        return { def, multiplier: 1e1 };
      }
    }
  }

  // Try 1-char SI prefix
  if (unitStr.length > 1) {
    const prefix = unitStr[0];
    const base = unitStr.slice(1);
    for (const [abbr, mult] of SI_PREFIXES) {
      if (abbr === prefix && abbr.length === 1) {
        for (const def of UNITS) {
          if (def[0] === base || (def[1] && def[1].includes(base))) {
            return { def, multiplier: mult };
          }
        }
      }
    }
  }

  return null;
}

// Temperature requires special offset handling
function convertTemperature(value: number, fromSym: string, toSym: string): number {
  // Normalize symbols
  const from = fromSym === 'kel' ? 'K' : fromSym === 'Rank' ? 'Rank' : fromSym;
  const to = toSym === 'kel' ? 'K' : toSym === 'Rank' ? 'Rank' : toSym;

  // Celsius detection via prefix
  const isCelsius = (s: string) => s === 'C' || s === 'cel';
  const isFahrenheit = (s: string) => s === 'F' || s === 'fah';

  let kelvin: number;

  if (from === 'K') kelvin = value;
  else if (from === 'Rank') kelvin = value * 5 / 9;
  else if (isCelsius(from)) kelvin = value + 273.15;
  else if (isFahrenheit(from)) kelvin = (value + 459.67) * 5 / 9;
  else return NaN;

  if (to === 'K') return kelvin;
  if (to === 'Rank') return kelvin * 9 / 5;
  if (isCelsius(to)) return kelvin - 273.15;
  if (isFahrenheit(to)) return kelvin * 9 / 5 - 459.67;
  return NaN;
}

export function excelConvert(numberLike: unknown, fromUnit: unknown, toUnit: unknown) {
  const number = parseExcelNumber(numberLike);
  const fromStr = parseExcelString(fromUnit);
  const toStr = parseExcelString(toUnit);

  // Temperature special case — needs offset, not just ratio
  const tempUnits = ['K', 'kel', 'C', 'cel', 'F', 'fah', 'Rank'];
  const fromIsTemp = tempUnits.includes(fromStr);
  const toIsTemp = tempUnits.includes(toStr);
  if (fromIsTemp && toIsTemp) {
    return convertTemperature(number, fromStr, toStr);
  }
  if (fromIsTemp || toIsTemp) {
    throwExcelError(EXCEL_ERROR.na); // mixed temp/non-temp
  }

  const from = resolveUnit(fromStr);
  const to = resolveUnit(toStr);

  if (!from || !to) throwExcelError(EXCEL_ERROR.na);
  if (from.def[2] !== to.def[2]) throwExcelError(EXCEL_ERROR.na); // different categories

  return (number * from.def[3] * from.multiplier) / (to.def[3] * to.multiplier);
}
