// The reference (rather than tsconfig `include`) carries the ambient module
// declaration into any project that reaches this file through its import
// graph — the host type-checks these sources under its own tsconfig, which
// never sees this package's include list. An `import` cannot do this job:
// it would be executed at node runtime, where a .d.ts is not loadable.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../types/bessel.d.ts" />
import besselImport from 'bessel';

import { parseExcelNumber } from './common.ts';

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
