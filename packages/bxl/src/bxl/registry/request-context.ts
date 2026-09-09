import type { BuiltinLibrary } from '../../jqtools/evaluate/filters/registry.ts';
import { requestContextNativeFilters } from '../bridge/request-context-native.ts';

export const requestContextLibrary: BuiltinLibrary = {
  jq: {},
  native: requestContextNativeFilters,
};
