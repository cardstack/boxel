// The import map is a tree file (importmap.json). At the depot root it is
// the lock. A thin per-pack copy may carry lineage (`forkedFrom`,
// `vendoredFrom`). Identity, ranges, and exports live in package.json.
// The vendor key is `deck`; `boxel` is honored for content authored in
// Boxel realms. Same shape, one namespace per ecosystem.
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
  // Lineage only — identity and ranges live in package.json. A thin
  // per-pack import map may still carry these so a fork, a vendor, or a
  // derivation stays self-describing.
  forkedFrom?: unknown;
  derivedFrom?: string;
  derivation?: unknown;
  sourceOnly?: boolean;
  recoveredFrom?: unknown;
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

// Ranges live in package.json (`dependencies`). This reader exists so a
// thin per-pack map written before that split can still be inspected; it
// is not how `deck lock` or serve resolve.
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

// The token for "the root of this deck's own tree". It is the only protocol
// spelling; old tokens are rejected instead of creating a second reader.
export const TREE_ROOT = '$DECK/';

// Map values point into the tree as `$DECK/<path>`, `./<path>`, or a bare
// relative path. Absolute URLs (references to web decks) and traversal
// shapes are not tree paths. `!` is legal only as the mount separator.
export function treePathFromMapValue(value: string): string | undefined {
  let path = value;
  if (path.startsWith(TREE_ROOT)) {
    path = path.slice(TREE_ROOT.length);
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
