import type { BuiltinLibrary } from '../../jqtools/evaluate/filters/registry.ts';
import { formulaFinancialNativeFilters } from '../bridge/formula-financial-native.ts';

export const formulaFinancialLibrary: BuiltinLibrary = {
  jq: {},
  native: formulaFinancialNativeFilters,
};
