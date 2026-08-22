// Canonical Realm Resource Identifier primitives.
//
// This module is deliberately browser-safe. RRI is logical identity; a host
// projects it to an HTTP URL only after canonical resolution is complete.

export type RealmResourceIdentifier = string & {
  readonly __rri: unique symbol;
};
export type RealmIdentifier = RealmResourceIdentifier & {
  readonly __realm: unique symbol;
};

export interface ParsedRRI {
  scope: string;
  name: string;
  version?: string;
  path: string;
  root: string;
}

export interface RRIImportMap {
  imports: Record<string, RealmResourceIdentifier>;
  scopes: Record<string, Record<string, RealmResourceIdentifier>>;
  integrity?: Record<string, string>;
}

export interface ProjectedImportMap {
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
  integrity?: Record<string, string>;
}

type AuthoredImportMap = {
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
  integrity?: Record<string, string>;
};

const NAME = '[a-z0-9][a-z0-9._-]{0,63}';
const VERSION = '[0-9][0-9A-Za-z.+-]*';
const ROOT_RE = new RegExp(`^@(${NAME})/(${NAME})(?:@(${VERSION}))?/(.*)$`);
const SYNTHETIC_ORIGIN = 'https://rri.invalid';

function canonicalPath(path: string): string {
  if (path.includes('\\') || path.startsWith('/') || path.includes('//')) {
    throw new Error(`invalid RRI path: ${JSON.stringify(path)}`);
  }
  let segments = path.split('/');
  let finalEmpty = segments.at(-1) === '';
  let members = finalEmpty ? segments.slice(0, -1) : segments;
  if (
    members.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    throw new Error(`invalid RRI path: ${JSON.stringify(path)}`);
  }
  return members.join('/') + (finalEmpty && members.length > 0 ? '/' : '');
}

export function parseRRI(value: string): ParsedRRI {
  if (value.startsWith('http:') || value.startsWith('https:')) {
    throw new Error('URL-form identity is not a Deck RRI');
  }
  let match = ROOT_RE.exec(value);
  if (!match) {
    throw new Error(`invalid Deck RRI: ${JSON.stringify(value)}`);
  }
  let [, scope, name, version, rawPath] = match;
  let path = canonicalPath(rawPath);
  let root =
    `@${scope}/${name}${version ? `@${version}` : ''}/` as RealmIdentifier;
  return { scope, name, ...(version ? { version } : {}), path, root };
}

export function normalizeRRI(value: string): RealmResourceIdentifier {
  let parsed = parseRRI(value);
  return `${parsed.root}${parsed.path}` as RealmResourceIdentifier;
}

export function rri(value: string): RealmResourceIdentifier {
  return normalizeRRI(value);
}

export function realmRRI(value: string): RealmIdentifier {
  let parsed = parseRRI(value);
  if (parsed.path !== '') {
    throw new Error(
      `realm RRI must end at its package root: ${JSON.stringify(value)}`,
    );
  }
  return parsed.root as RealmIdentifier;
}

export function isRRI(value: string): boolean {
  try {
    normalizeRRI(value);
    return true;
  } catch {
    return false;
  }
}

export function isRealmRRI(value: string): boolean {
  try {
    realmRRI(value);
    return true;
  } catch {
    return false;
  }
}

export function isExactVersionRRI(value: string): boolean {
  try {
    return parseRRI(value).version !== undefined;
  } catch {
    return false;
  }
}

function authoredTargetToRRI(
  value: string,
  relativeTo?: string,
): RealmResourceIdentifier {
  if (value.startsWith('@')) return normalizeRRI(value);
  if (
    value.startsWith('/') ||
    value.startsWith('http:') ||
    value.startsWith('https:')
  ) {
    throw new Error(
      `canonical Deck locks require RRI targets: ${JSON.stringify(value)}`,
    );
  }
  return resolveRRIReference(value, relativeTo);
}

// Canonical locks never enter transport URL space. Authored values are RRIs
// or references relative to the supplied package RRI. A host projects the
// resulting lock to URLs only after it has been hashed.
export function canonicalRRIImportMap(
  value: unknown,
  options: { relativeTo?: string } = {},
): RRIImportMap {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid authored import map');
  }
  let authored = value as AuthoredImportMap;
  let imports = Object.fromEntries(
    Object.entries(authored.imports ?? {}).map(([key, target]) => {
      if (typeof target !== 'string')
        throw new Error(`import target ${key} must be a string`);
      return [key, authoredTargetToRRI(target, options.relativeTo)];
    }),
  );
  let scopes = Object.fromEntries(
    Object.entries(authored.scopes ?? {}).map(([scope, table]) => {
      if (table === null || typeof table !== 'object' || Array.isArray(table)) {
        throw new Error(`import scope ${scope} must be an object`);
      }
      let scopeRRI = authoredTargetToRRI(scope, options.relativeTo);
      return [
        scopeRRI,
        Object.fromEntries(
          Object.entries(table).map(([key, target]) => {
            if (typeof target !== 'string')
              throw new Error(`import target ${key} must be a string`);
            return [key, authoredTargetToRRI(target, options.relativeTo)];
          }),
        ),
      ];
    }),
  );
  let integrity = authored.integrity
    ? Object.fromEntries(
        Object.entries(authored.integrity).map(([target, digest]) => {
          if (typeof digest !== 'string')
            throw new Error(`integrity for ${target} must be a string`);
          return [authoredTargetToRRI(target, options.relativeTo), digest];
        }),
      )
    : undefined;
  return { imports, scopes, ...(integrity ? { integrity } : {}) };
}

export function resolveRRIReference(
  reference: string,
  relativeTo?: string,
): RealmResourceIdentifier {
  if (reference.startsWith('@')) {
    return normalizeRRI(reference);
  }
  if (reference.startsWith('/') || reference.startsWith('~/')) {
    throw new Error('"/" and "~/" prefixes are not supported in an RRI');
  }
  if (reference === '$REALM' || reference.startsWith('$REALM/')) {
    throw new Error('$REALM is not part of the Deck RRI protocol');
  }
  if (!relativeTo) {
    throw new Error(
      `cannot resolve ${JSON.stringify(reference)} without a base RRI`,
    );
  }
  let base = parseRRI(relativeTo);
  let resolved = new URL(
    reference,
    `${SYNTHETIC_ORIGIN}/${base.path}`,
  ).pathname.slice(1);
  return normalizeRRI(`${base.root}${resolved}`);
}

function covers(scope: string, importer: string): boolean {
  return (
    scope === importer || (scope.endsWith('/') && importer.startsWith(scope))
  );
}

function lookup(
  specifier: string,
  table: Record<string, RealmResourceIdentifier>,
): RealmResourceIdentifier | undefined {
  let exact = table[specifier];
  if (exact) return normalizeRRI(exact);
  let best: string | undefined;
  for (let key of Object.keys(table)) {
    if (key.endsWith('/') && specifier.startsWith(key)) {
      if (best === undefined || key.length > best.length) best = key;
    }
  }
  return best
    ? resolveRRIReference(specifier.slice(best.length), table[best])
    : undefined;
}

export function resolveRRI(options: {
  specifier: string;
  fromRRI: string;
  imports: Record<string, RealmResourceIdentifier>;
  scopes: Record<string, Record<string, RealmResourceIdentifier>>;
}): RealmResourceIdentifier | undefined {
  let importer = normalizeRRI(options.fromRRI);
  if (options.specifier.startsWith('@') && isRRI(options.specifier)) {
    return normalizeRRI(options.specifier);
  }
  let applicable = Object.keys(options.scopes)
    .map((scope) => normalizeRRI(scope))
    .filter((scope) => covers(scope, importer))
    .sort((a, b) => b.length - a.length);
  for (let scope of applicable) {
    let hit = lookup(options.specifier, options.scopes[scope]);
    if (hit) return hit;
  }
  return lookup(options.specifier, options.imports);
}

function projectedURL(
  projector: (value: RealmResourceIdentifier) => string,
  value: string,
): string {
  let result = projector(normalizeRRI(value));
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    throw new Error(
      `RRI projector returned a non-URL: ${JSON.stringify(result)}`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `RRI projector returned a non-HTTP URL: ${JSON.stringify(result)}`,
    );
  }
  return url.href;
}

export function projectRRIImportMap(
  lock: RRIImportMap,
  projector: (value: RealmResourceIdentifier) => string,
): ProjectedImportMap {
  let imports = Object.fromEntries(
    Object.entries(lock.imports).map(([key, value]) => [
      key,
      projectedURL(projector, value),
    ]),
  );
  let scopes = Object.fromEntries(
    Object.entries(lock.scopes).map(([scope, table]) => [
      projectedURL(projector, scope),
      Object.fromEntries(
        Object.entries(table).map(([key, value]) => [
          key,
          projectedURL(projector, value),
        ]),
      ),
    ]),
  );
  let integrity = lock.integrity
    ? Object.fromEntries(
        Object.entries(lock.integrity).map(([key, value]) => [
          projectedURL(projector, key),
          value,
        ]),
      )
    : undefined;
  return { imports, scopes, ...(integrity ? { integrity } : {}) };
}
