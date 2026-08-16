import type { BuiltinLibrary } from '../../jqtools/evaluate/filters/registry.ts';
import { formulaBesselNativeFilters } from '../bridge/formula-bessel-native.ts';

export const formulaBesselLibrary: BuiltinLibrary = {
  jq: {},
  native: formulaBesselNativeFilters,
};
