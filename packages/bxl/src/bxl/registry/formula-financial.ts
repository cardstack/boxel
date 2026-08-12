import type { BuiltinLibrary } from '../../jqtools/evaluate/filters/registry.js';
import { formulaFinancialNativeFilters } from '../bridge/formula-financial-native.js';

export const formulaFinancialLibrary: BuiltinLibrary = {
  jq: {},
  native: formulaFinancialNativeFilters,
};
