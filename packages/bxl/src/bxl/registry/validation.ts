import type { BuiltinLibrary } from '../../jqtools/evaluate/filters/registry.js';
import { validationNativeFilters } from '../bridge/validation-native.js';

export const validationLibrary: BuiltinLibrary = {
  jq: {},
  native: validationNativeFilters,
};
