import type { BuiltinLibrary } from '../../jqtools/evaluate/filters/registry.ts';
import { formulaStatisticalNativeFilters } from '../bridge/formula-statistical-native.ts';

export const formulaStatisticalLibrary: BuiltinLibrary = {
  jq: {},
  native: formulaStatisticalNativeFilters,
};
