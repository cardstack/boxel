import type { BuiltinLibrary } from '../../jqtools/evaluate/filters/registry.js';
import { formulaEngineeringNativeFilters } from '../bridge/formula-engineering-native.js';

export const formulaEngineeringLibrary: BuiltinLibrary = {
  jq: {},
  native: formulaEngineeringNativeFilters,
};
