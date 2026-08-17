import type { BuiltinLibrary } from '../../jqtools/evaluate/filters/registry.ts';
import { formulaEngineeringNativeFilters } from '../bridge/formula-engineering-native.ts';

export const formulaEngineeringLibrary: BuiltinLibrary = {
  jq: {},
  native: formulaEngineeringNativeFilters,
};
