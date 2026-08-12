import type { BuiltinLibrary } from '../../jqtools/evaluate/filters/registry.js';
import { formulaBesselNativeFilters } from '../bridge/formula-bessel-native.js';

export const formulaBesselLibrary: BuiltinLibrary = {
  jq: {},
  native: formulaBesselNativeFilters,
};
