// The import map is a tree file (importmap.json at the root) — the deck's
// manifest. The vendor key is `deck`; `boxel` is honored for content
// authored in Boxel realms. Same shape, one namespace per ecosystem.
//
// Part of the browser-safe surface (see `resolve.ts`): no `node:` import
// here, or in anything this file reaches. Reading a manifest out of a pack
// needs a zip reader, so that lives in `import-map-pack.ts`.

export const IMPORT_MAP_PATH = 'importmap.json';
export const MOUNT_SEPARATOR = '.pack.zip!/';

export interface PackageMapEntry {
  version?: string;
  entry?: string;
  exports?: Record<string, string>;
  baseApi?: string;
  // The canonical identity of what was pulled in, when this deck is a
  // vendored copy of something else. A plain string for a CDN vendor; the
  // full provenance record (registry, integrity, repo, commit, cooldown
  // verdict) for an npm source vendor.
  vendoredFrom?: string | Record<string, unknown>;
}

export function parsePackages(
  jsonText: string,
): Record<string, PackageMapEntry> | undefined {
  try {
    let parsed = JSON.parse(jsonText);
    let packages = parsed?.deck?.packages ?? parsed?.boxel?.packages;
    if (packages && typeof packages === 'object' && !Array.isArray(packages)) {
      return packages as Record<string, PackageMapEntry>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// What this deck depends on, as RANGES: `"acme/confetti": "^1.0.0"`. The
// author writes intent here; `deck lock` resolves it into `imports` pins
// (see lock.ts) so consumers of a published deck never inherit somebody
// else's working tree.
export function parseDependencies(
  jsonText: string,
): Record<string, string> | undefined {
  try {
    let parsed = JSON.parse(jsonText);
    let dependencies =
      parsed?.deck?.dependencies ?? parsed?.boxel?.dependencies;
    if (
      dependencies &&
      typeof dependencies === 'object' &&
      !Array.isArray(dependencies)
    ) {
      return dependencies as Record<string, string>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// The token for "the root of this deck's own tree".
//
// It used to be `$REALM/`, which was wrong twice over: the value points at
// the DECK's root, not at the enclosing mount, and "realm" is Boxel's word
// for something richer than a depot (docs/deck-depot-and-realm-backport.md).
//
// `$REALM/` is still accepted, and always will be. It is not a deprecation
// to be swept up later: it appears inside SEALED trees, and L4 says a
// published version never changes. A pack written last year must keep
// resolving, byte for byte, forever. New trees write `$DECK/`.
export const TREE_ROOT = '$DECK/';
export const LEGACY_TREE_ROOTS = ['$REALM/'];

// Map values point into the tree as `$DECK/<path>`, `./<path>`, or a bare
// relative path. Absolute URLs (references to web decks) and traversal
// shapes are not tree paths. `!` is legal only as the mount separator.
export function treePathFromMapValue(value: string): string | undefined {
  let path = value;
  let root = [TREE_ROOT, ...LEGACY_TREE_ROOTS].find((prefix) =>
    path.startsWith(prefix),
  );
  if (root) {
    path = path.slice(root.length);
  } else if (path.startsWith('./')) {
    path = path.slice('./'.length);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || path.startsWith('$')) {
    return undefined;
  }
  if (path.length === 0 || path.startsWith('/')) {
    return undefined;
  }
  if (path.includes('!') && !path.includes(MOUNT_SEPARATOR)) {
    return undefined;
  }
  let segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    return undefined;
  }
  return path;
}
