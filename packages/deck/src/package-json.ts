// npm package.json — the package's suggestion, not the lock.
//
// The depot-root import map is the only resolution authority
// (docs/deck-package-json-and-depot-lock.md). This file parses the npm
// subset Deck honours: name, version, exports/module/main, and the
// dependency fields. Extra keys are ignored. The parser is browser-safe
// (no `node:` imports) so serve-time entry resolution can share it.

export const PACKAGE_JSON_PATH = 'package.json';

export const EXPORT_CONDITIONS = ['import', 'browser', 'default'] as const;

export interface PackageJson {
  name?: string;
  version?: string;
  type?: string;
  main?: string;
  module?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

export function parsePackageJson(jsonText: string): PackageJson | undefined {
  try {
    let parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as PackageJson;
  } catch {
    return undefined;
  }
}

function asStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  let out: Record<string, string> = {};
  for (let [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') {
      out[key] = entry;
    }
  }
  return out;
}

// npm merges these for the installer. Optional does not override a
// direct or peer range already named.
export function suggestedDependencies(
  pkg: PackageJson,
): Record<string, string> {
  let out: Record<string, string> = {};
  for (let field of [
    pkg.dependencies,
    pkg.peerDependencies,
    pkg.optionalDependencies,
  ]) {
    let record = asStringRecord(field);
    if (!record) {
      continue;
    }
    for (let [name, range] of Object.entries(record)) {
      if (out[name] === undefined) {
        out[name] = range;
      }
    }
  }
  return out;
}

function unwrapExport(
  value: unknown,
  conditions: readonly string[],
): string | undefined {
  if (typeof value === 'string') {
    return value.replace(/^\.\//, '');
  }
  if (Array.isArray(value)) {
    for (let item of value) {
      let found = unwrapExport(item, conditions);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  let record = value as Record<string, unknown>;
  for (let condition of conditions) {
    if (condition in record) {
      let found = unwrapExport(record[condition], conditions);
      if (found) {
        return found;
      }
    }
  }
  if ('default' in record && !conditions.includes('default')) {
    return unwrapExport(record.default, conditions);
  }
  return undefined;
}

function isConditionMap(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return !Object.keys(value as Record<string, unknown>).some((key) =>
    key.startsWith('.'),
  );
}

export function entryFromPackageJson(
  pkg: PackageJson,
  conditions: readonly string[] = EXPORT_CONDITIONS,
): string | undefined {
  if (pkg.exports !== undefined) {
    if (typeof pkg.exports === 'string' || Array.isArray(pkg.exports)) {
      return unwrapExport(pkg.exports, conditions);
    }
    if (pkg.exports && typeof pkg.exports === 'object') {
      let record = pkg.exports as Record<string, unknown>;
      if ('.' in record) {
        return unwrapExport(record['.'], conditions);
      }
      if (isConditionMap(pkg.exports)) {
        return unwrapExport(pkg.exports, conditions);
      }
    }
  }
  if (typeof pkg.module === 'string') {
    return pkg.module.replace(/^\.\//, '');
  }
  if (typeof pkg.main === 'string') {
    return pkg.main.replace(/^\.\//, '');
  }
  return undefined;
}

// Non-pattern subpaths only. `./addons/*` is a lock-time prefix, not an
// exact pin, and is left to the trailing-slash import-map entry.
export function subpathExports(
  pkg: PackageJson,
  conditions: readonly string[] = EXPORT_CONDITIONS,
): Record<string, string> {
  let out: Record<string, string> = {};
  if (!pkg.exports || typeof pkg.exports !== 'object' || Array.isArray(pkg.exports)) {
    return out;
  }
  if (isConditionMap(pkg.exports)) {
    return out;
  }
  for (let [key, value] of Object.entries(pkg.exports as Record<string, unknown>)) {
    if (key === '.' || key.includes('*')) {
      continue;
    }
    let path = unwrapExport(value, conditions);
    if (path) {
      out[key.replace(/^\.\//, '')] = path;
    }
  }
  return out;
}

export interface NpmAlias {
  name: string;
  range: string;
}

// `"foo": "npm:bar@^1.2.0"` / `"foo": "npm:@scope/bar@1.0.0"`.
export function parseNpmAlias(spec: string): NpmAlias | undefined {
  if (!spec.startsWith('npm:')) {
    return undefined;
  }
  let rest = spec.slice('npm:'.length);
  if (rest.startsWith('@')) {
    let slash = rest.indexOf('/');
    if (slash <= 0) {
      return undefined;
    }
    let at = rest.indexOf('@', slash);
    if (at <= 0) {
      return { name: rest, range: '*' };
    }
    return { name: rest.slice(0, at), range: rest.slice(at + 1) || '*' };
  }
  let at = rest.lastIndexOf('@');
  if (at <= 0) {
    return { name: rest, range: '*' };
  }
  return { name: rest.slice(0, at), range: rest.slice(at + 1) || '*' };
}

// Canonical write for "this specifier, this depot's working tree."
// `workspace:^` is pnpm's compatible-range protocol, not live; only `*`
// is this mode. See docs/deck-unfrozen-mode.md.
export function isWorkspaceSpec(spec: string): boolean {
  return spec === 'workspace:*';
}

// Working-tree spec: canonical `workspace:*`, plus `live` as a read
// synonym. `@live` as a bare value is not a spec — it looks like a
// scoped name. Alias form is `you/palette@live` (the token after `@`).
export function isLiveSpec(spec: string): boolean {
  return spec === 'live' || isWorkspaceSpec(spec);
}
