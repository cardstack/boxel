/**
 * BXL builtin registry.
 *
 * Extends the jqtools core registry (jq builtins) with the 'formula' library
 * — Excel helpers implemented in src/formulajs/ and wired to the jq runtime
 * via src/bxl/bridge/formula-contrib-*.ts.
 *
 * This module is the public BXL registry. Callers who want only jq's own
 * builtins can skip it and use jqtools/evaluate/filters/registry directly.
 */

import type {
  BuiltinLibrary,
  ResolvedBuiltinRegistry,
} from '../../jqtools/evaluate/filters/registry.js';
import {
  CORE_REGISTRY,
  resolveRegistry,
} from '../../jqtools/evaluate/filters/registry.js';
import { formulaContribJqFilters } from '../bridge/formula-contrib-jq.js';
import { formulaContribNativeFilters } from '../bridge/formula-contrib-native.js';

export const formulaLibrary: BuiltinLibrary = {
  jq: formulaContribJqFilters,
  native: formulaContribNativeFilters,
};

export const BXL_REGISTRY: Record<string, BuiltinLibrary> = {
  ...CORE_REGISTRY,
  formula: formulaLibrary,
};

export type BuiltinLibraryName =
  | 'core'
  | 'formula'
  | 'formula-statistical'
  | 'formula-bessel'
  | 'formula-engineering'
  | 'formula-financial'
  | 'validation';

export const DEFAULT_BUILTIN_LIBRARIES: BuiltinLibraryName[] = [
  'core',
  'formula',
];

const resolvedRegistryCache = new Map<string, ResolvedBuiltinRegistry>();

function registryCacheKey(libraries: BuiltinLibraryName[]): string {
  return [...new Set(libraries)].join('\0');
}

export function resolveBuiltinRegistry(
  libraries: BuiltinLibraryName[] = DEFAULT_BUILTIN_LIBRARIES,
): ResolvedBuiltinRegistry {
  const key = registryCacheKey(libraries);
  let cached = resolvedRegistryCache.get(key);
  if (!cached) {
    cached = resolveRegistry(BXL_REGISTRY, [...new Set(libraries)]);
    resolvedRegistryCache.set(key, cached);
  }
  return cached;
}

export function registerBuiltinLibrary(
  name: BuiltinLibraryName,
  library: BuiltinLibrary,
) {
  BXL_REGISTRY[name] = library;
  resolvedRegistryCache.clear();
}

export type { ResolvedBuiltinRegistry, BuiltinLibrary };
