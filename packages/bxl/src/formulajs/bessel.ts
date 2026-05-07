import besselImport from 'bessel';

import { parseExcelNumber } from './common.js';

const bessel = besselImport as any;

export function excelBesselI(xLike: unknown, nLike: unknown) {
  return bessel.besseli(parseExcelNumber(xLike), parseExcelNumber(nLike));
}

export function excelBesselJ(xLike: unknown, nLike: unknown) {
  return bessel.besselj(parseExcelNumber(xLike), parseExcelNumber(nLike));
}

export function excelBesselK(xLike: unknown, nLike: unknown) {
  return bessel.besselk(parseExcelNumber(xLike), parseExcelNumber(nLike));
}

export function excelBesselY(xLike: unknown, nLike: unknown) {
  return bessel.bessely(parseExcelNumber(xLike), parseExcelNumber(nLike));
}
