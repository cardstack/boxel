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
} from '../../jqtools/evaluate/filters/registry.ts';
import {
  CORE_REGISTRY,
  resolveRegistry,
} from '../../jqtools/evaluate/filters/registry.ts';
import { formulaContribJqFilters } from '../bridge/formula-contrib-jq.ts';
import { formulaContribNativeFilters } from '../bridge/formula-contrib-native.ts';
import { authorizationLibrary } from './authorization.ts';
import { requestContextLibrary } from './request-context.ts';

export const formulaLibrary: BuiltinLibrary = {
  jq: formulaContribJqFilters,
  native: formulaContribNativeFilters,
};

export const BXL_REGISTRY: Record<string, BuiltinLibrary> = {
  ...CORE_REGISTRY,
  authorization: authorizationLibrary,
  formula: formulaLibrary,
  'request-context': requestContextLibrary,
};

/**
 * Every builtin library BXL can resolve, eager and lazily chunked alike.
 *
 * `BuiltinLibraryName` is derived from this list rather than written beside
 * it, so the names a caller may request and the names something has to load
 * cannot drift apart: the lazy loader takes its work list from here, and the
 * coverage gate checks that each one really registered.
 */
export const BUILTIN_LIBRARY_NAMES = [
  'core',
  'authorization',
  'formula',
  'request-context',
  'formula-statistical',
  'formula-bessel',
  'formula-engineering',
  'formula-financial',
  'validation',
] as const;

export type BuiltinLibraryName = (typeof BUILTIN_LIBRARY_NAMES)[number];

/**
 * The libraries that ship in the initial bundle. Everything else in
 * {@link BUILTIN_LIBRARY_NAMES} arrives through a lazy chunk.
 */
export const EAGER_BUILTIN_LIBRARIES: BuiltinLibraryName[] = [
  'core',
  'authorization',
  'formula',
  'request-context',
];

/** The lazily chunked libraries, as the complement of the eager ones. */
export const LAZY_BUILTIN_LIBRARIES: BuiltinLibraryName[] =
  BUILTIN_LIBRARY_NAMES.filter(
    (name) => !EAGER_BUILTIN_LIBRARIES.includes(name),
  );

export const DEFAULT_BUILTIN_LIBRARIES: BuiltinLibraryName[] = [
  'core',
  'formula',
];

/**
 * The library set a mutation program resolves against: whatever the caller
 * asked for, plus the request-context builtins the mutation dialect always
 * offers.
 *
 * Appending, rather than naming a fixed list, is what keeps the lazy formula
 * families reachable from a mutation program: `loadAllFormulaExtensions`
 * appends them to {@link DEFAULT_BUILTIN_LIBRARIES} in place, so a separate
 * default here would freeze the set as it stood before those chunks loaded.
 *
 * `request-context` is deliberately not in {@link DEFAULT_BUILTIN_LIBRARIES}.
 * A card's computed fields resolve against that list, and `params`/`actor`/
 * `instance` have no meaning there — the `derive` profile denies them, and
 * leaving them unresolvable means a computed field cannot even name one.
 */
export function mutationBuiltinLibraries(
  libraries: BuiltinLibraryName[] = DEFAULT_BUILTIN_LIBRARIES,
): BuiltinLibraryName[] {
  return libraries.includes('request-context')
    ? [...libraries]
    : [...libraries, 'request-context'];
}

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
