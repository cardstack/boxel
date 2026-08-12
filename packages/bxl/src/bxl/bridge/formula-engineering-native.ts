import {
  excelBase,
  excelBin2Dec,
  excelBin2Hex,
  excelBin2Oct,
  excelBitAnd,
  excelBitLShift,
  excelBitOr,
  excelBitRShift,
  excelBitXor,
  excelComplex,
  excelConvert,
  excelDec2Bin,
  excelDec2Hex,
  excelDec2Oct,
  excelDecimal,
  excelDelta,
  excelErf,
  excelErfc,
  excelGestep,
  excelHex2Bin,
  excelHex2Dec,
  excelHex2Oct,
  excelImAbs,
  excelImArgument,
  excelImConjugate,
  excelImCos,
  excelImCosh,
  excelImCot,
  excelImCsc,
  excelImCsch,
  excelImDiv,
  excelImExp,
  excelImImaginary,
  excelImLn,
  excelImLog10,
  excelImLog2,
  excelImPower,
  excelImProduct,
  excelImReal,
  excelImSec,
  excelImSech,
  excelImSin,
  excelImSinh,
  excelImSqrt,
  excelImSub,
  excelImSum,
  excelImTan,
  excelOct2Bin,
  excelOct2Dec,
  excelOct2Hex,
} from '../../formulajs/engineering.js';
import { EXCEL_ERROR, throwExcelError } from '../../formulajs/errors.js';
import { parseExcelNumber } from '../../formulajs/common.js';
import {
  BareNativeFilter,
  wrapBareNativeFilters,
} from '../../jqtools/evaluate/filters/lib/nativeFilter.js';

const bareNativeFilters: Record<string, BareNativeFilter> = {
  *'BASE/2'(_input, number, radix) {
    yield excelBase(number, radix);
  },
  *'BASE/3'(_input, number, radix, minLength) {
    yield excelBase(number, radix, minLength);
  },
  *'BIN2DEC/1'(_input, number) {
    yield excelBin2Dec(number);
  },
  *'BIN2HEX/1'(_input, number) {
    yield excelBin2Hex(number);
  },
  *'BIN2HEX/2'(_input, number, places) {
    yield excelBin2Hex(number, places);
  },
  *'BIN2OCT/1'(_input, number) {
    yield excelBin2Oct(number);
  },
  *'BIN2OCT/2'(_input, number, places) {
    yield excelBin2Oct(number, places);
  },
  *'BITAND/2'(_input, left, right) {
    yield excelBitAnd(left, right);
  },
  *'BITLSHIFT/2'(_input, number, shift) {
    yield excelBitLShift(number, shift);
  },
  *'BITOR/2'(_input, left, right) {
    yield excelBitOr(left, right);
  },
  *'BITRSHIFT/2'(_input, number, shift) {
    yield excelBitRShift(number, shift);
  },
  *'BITXOR/2'(_input, left, right) {
    yield excelBitXor(left, right);
  },
  *'COMPLEX/2'(_input, real, imaginary) {
    yield excelComplex(real, imaginary);
  },
  *'COMPLEX/3'(_input, real, imaginary, suffix) {
    yield excelComplex(real, imaginary, suffix);
  },
  *'CONVERT/3'(_input, number, fromUnit, toUnit) { yield excelConvert(number, fromUnit, toUnit); },

  // ═══════════════════════════════════════════════════════════════
  // Text functions
  // ═══════════════════════════════════════════════════════════════

  *'UNICHAR/1'(_input, number) {
    const n = Math.floor(parseExcelNumber(number));
    if (n < 1 || n > 0x10FFFF) throwExcelError(EXCEL_ERROR.value);
    yield String.fromCodePoint(n);
  },
  *'DEC2BIN/1'(_input, number) {
    yield excelDec2Bin(number);
  },
  *'DEC2BIN/2'(_input, number, places) {
    yield excelDec2Bin(number, places);
  },
  *'DEC2HEX/1'(_input, number) {
    yield excelDec2Hex(number);
  },
  *'DEC2HEX/2'(_input, number, places) {
    yield excelDec2Hex(number, places);
  },
  *'DEC2OCT/1'(_input, number) {
    yield excelDec2Oct(number);
  },
  *'DEC2OCT/2'(_input, number, places) {
    yield excelDec2Oct(number, places);
  },
  *'DECIMAL/2'(_input, text, radix) {
    yield excelDecimal(text, radix);
  },
  *'DELTA/1'(_input, left) {
    yield excelDelta(left);
  },
  *'DELTA/2'(_input, left, right) {
    yield excelDelta(left, right);
  },
  *'ERF/2'(_input, lower, upper) { yield excelErf(lower, upper); },
  *'ERFC/1'(_input, value) { yield excelErfc(value); },
  *'GESTEP/1'(_input, number) {
    yield excelGestep(number);
  },
  *'GESTEP/2'(_input, number, step) {
    yield excelGestep(number, step);
  },
  *'HEX2BIN/1'(_input, number) {
    yield excelHex2Bin(number);
  },
  *'HEX2BIN/2'(_input, number, places) {
    yield excelHex2Bin(number, places);
  },
  *'HEX2DEC/1'(_input, number) {
    yield excelHex2Dec(number);
  },
  *'HEX2OCT/1'(_input, number) {
    yield excelHex2Oct(number);
  },
  *'HEX2OCT/2'(_input, number, places) {
    yield excelHex2Oct(number, places);
  },
  *'IMABS/1'(_input, value) {
    yield excelImAbs(value);
  },
  *'IMAGINARY/1'(_input, value) {
    yield excelImImaginary(value);
  },
  *'IMARGUMENT/1'(_input, value) { yield excelImArgument(value); },
  *'ERF/1'(_input, lower) { yield excelErf(lower); },
  *'IMCONJUGATE/1'(_input, value) {
    yield excelImConjugate(value);
  },
  *'IMCOS/1'(_input, value) { yield excelImCos(value); },
  *'IMCOSH/1'(_input, value) { yield excelImCosh(value); },
  *'IMCOT/1'(_input, value) { yield excelImCot(value); },
  *'IMCSC/1'(_input, value) { yield excelImCsc(value); },
  *'IMCSCH/1'(_input, value) { yield excelImCsch(value); },
  *'IMSIN/1'(_input, value) { yield excelImSin(value); },
  *'IMDIV/2'(_input, left, right) { yield excelImDiv(left, right); },
  *'IMPRODUCT/1'(_input, values) { yield excelImProduct(values); },
  *'IMEXP/1'(_input, value) { yield excelImExp(value); },
  *'IMLN/1'(_input, value) { yield excelImLn(value); },
  *'IMLOG10/1'(_input, value) { yield excelImLog10(value); },
  *'IMLOG2/1'(_input, value) { yield excelImLog2(value); },
  *'IMPOWER/2'(_input, value, power) { yield excelImPower(value, power); },
  *'IMSQRT/1'(_input, value) { yield excelImSqrt(value); },
  *'IMREAL/1'(_input, value) {
    yield excelImReal(value);
  },
  *'IMSEC/1'(_input, value) { yield excelImSec(value); },
  *'IMSECH/1'(_input, value) { yield excelImSech(value); },
  *'IMSINH/1'(_input, value) { yield excelImSinh(value); },
  *'IMTAN/1'(_input, value) { yield excelImTan(value); },
  *'IMSUB/2'(_input, left, right) {
    yield excelImSub(left, right);
  },
  *'IMSUM/1'(_input, values) {
    yield excelImSum(values);
  },
  *'IMSUM/2'(_input, left, right) {
    yield excelImSum([left, right]);
  },
  *'IMSUM/3'(_input, first, second, third) {
    yield excelImSum([first, second, third]);
  },
  *'OCT2BIN/1'(_input, number) {
    yield excelOct2Bin(number);
  },
  *'OCT2BIN/2'(_input, number, places) {
    yield excelOct2Bin(number, places);
  },
  *'OCT2DEC/1'(_input, number) {
    yield excelOct2Dec(number);
  },
  *'OCT2HEX/1'(_input, number) {
    yield excelOct2Hex(number);
  },
  *'OCT2HEX/2'(_input, number, places) {
    yield excelOct2Hex(number, places);
  },
};

export const formulaEngineeringNativeFilters =
  wrapBareNativeFilters(bareNativeFilters);
