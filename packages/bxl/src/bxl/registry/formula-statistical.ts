import type { BuiltinLibrary } from '../../jqtools/evaluate/filters/registry.js';
import { formulaStatisticalNativeFilters } from '../bridge/formula-statistical-native.js';

export const formulaStatisticalLibrary: BuiltinLibrary = {
  jq: {},
  native: formulaStatisticalNativeFilters,
};
