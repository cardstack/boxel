import {
  excelBesselI,
  excelBesselJ,
  excelBesselK,
  excelBesselY,
} from '../../formulajs/bessel.js';
import {
  BareNativeFilter,
  wrapBareNativeFilters,
} from '../../jqtools/evaluate/filters/lib/nativeFilter.js';

const bareNativeFilters: Record<string, BareNativeFilter> = {
  *'BESSELI/2'(_input, x, n) { yield excelBesselI(x, n); },
  *'BESSELJ/2'(_input, x, n) { yield excelBesselJ(x, n); },
  *'BESSELK/2'(_input, x, n) { yield excelBesselK(x, n); },
  *'BESSELY/2'(_input, x, n) { yield excelBesselY(x, n); },
};

export const formulaBesselNativeFilters =
  wrapBareNativeFilters(bareNativeFilters);
