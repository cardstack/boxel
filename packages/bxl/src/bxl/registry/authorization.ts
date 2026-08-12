import type { BuiltinLibrary } from '../../jqtools/evaluate/filters/registry.ts';
import { authorizationNativeFilters } from '../bridge/authorization-native.ts';

export const authorizationLibrary: BuiltinLibrary = {
  jq: {},
  native: authorizationNativeFilters,
};
