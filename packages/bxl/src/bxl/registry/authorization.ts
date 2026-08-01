import type { BuiltinLibrary } from '../../jqtools/evaluate/filters/registry.js';
import { authorizationNativeFilters } from '../bridge/authorization-native.js';

export const authorizationLibrary: BuiltinLibrary = {
  jq: {},
  native: authorizationNativeFilters,
};
