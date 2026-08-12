import type { BuiltinLibrary } from '../../jqtools/evaluate/filters/registry.ts';
import { validationNativeFilters } from '../bridge/validation-native.ts';

export const validationLibrary: BuiltinLibrary = {
  jq: {},
  native: validationNativeFilters,
};
