/**
 * Core builtin registry mechanism.
 *
 * Defines the library/registry types and a resolver that knows only about
 * jq's native builtins. BXL's Excel-formula libraries are layered on top via
 * src/bxl/registry/, which combines this core registry with formulajs-backed
 * libraries.
 *
 * This module belongs to the jq runtime and must NOT import from src/bxl/ or
 * src/formulajs/.
 */

import type { DefAst } from '../../parser/AST.js';
import { createItem } from '../utils/utils.js';
import { builtinJqFilters } from './builtinJqFilters.js';
import { builtinNativeFilters } from './builtinNativeFilters.js';
import type { NativeFilter } from './lib/nativeFilter.js';

export interface BuiltinLibrary {
  jq: Record<string, DefAst>;
  native: Record<string, NativeFilter>;
}

export interface ResolvedBuiltinRegistry {
  jq: Record<string, DefAst>;
  native: Record<string, NativeFilter>;
  libraries: string[];
  publicNames: string[];
}

export const PUBLIC_SANDBOX_BLOCKED_BUILTINS = new Set(['env/0']);

export const coreLibrary: BuiltinLibrary = {
  jq: builtinJqFilters,
  native: builtinNativeFilters,
};

export function publicBuiltinNames(
  jqFilters: Record<string, DefAst>,
  nativeFilters: Record<string, NativeFilter>,
): string[] {
  return [
    ...new Set([...Object.keys(jqFilters), ...Object.keys(nativeFilters)]),
  ]
    .filter(
      (name) =>
        !name.startsWith('_') && !PUBLIC_SANDBOX_BLOCKED_BUILTINS.has(name),
    )
    .sort();
}

export function resolveRegistry(
  libraries: Record<string, BuiltinLibrary>,
  requested: string[],
): ResolvedBuiltinRegistry {
  const uniqueLibraries = [...new Set(requested)];
  const jq: Record<string, DefAst> = {};
  const native: Record<string, NativeFilter> = {};

  for (const name of uniqueLibraries) {
    const lib = libraries[name];
    if (!lib) throw new Error(`Unknown builtin library: ${name}`);
    Object.assign(jq, lib.jq);
    Object.assign(native, lib.native);
  }

  const publicNames = publicBuiltinNames(jq, native);
  native['builtins/0'] = function* () {
    yield createItem(publicNames);
  };

  return { jq, native, libraries: uniqueLibraries, publicNames };
}

/**
 * Core-only registry — jq's own native + jq-source builtins.
 * BXL wraps this with additional libraries in src/bxl/registry/.
 */
export const CORE_REGISTRY: Record<string, BuiltinLibrary> = {
  core: coreLibrary,
};

const coreRegistryCache = new Map<string, ResolvedBuiltinRegistry>();

export function resolveCoreRegistry(
  libraries: string[] = ['core'],
): ResolvedBuiltinRegistry {
  const uniqueLibraries = [...new Set(libraries)];
  const key = uniqueLibraries.join('\0');
  let cached = coreRegistryCache.get(key);
  if (!cached) {
    cached = resolveRegistry(CORE_REGISTRY, uniqueLibraries);
    coreRegistryCache.set(key, cached);
  }
  return cached;
}
