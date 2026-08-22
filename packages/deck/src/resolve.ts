// The browser-safe half of Deck Core.
//
// READ THIS BEFORE ADDING AN IMPORT. Nothing in this module — or in anything
// it imports — may reach a `node:` builtin. It is the one part of Core that
// runs in a browser as well as on a server, because a host with its own
// module loader (rather than native import maps) has to perform this
// resolution itself, in the page. `eslint` enforces the rule; see the
// `no-restricted-imports` override in `.eslintrc.cjs`.
//
// Everything here is a pure function of its arguments. No clock, no
// filesystem, no network, no ambient configuration.

export {
  IMPORT_MAP_PATH,
  MOUNT_SEPARATOR,
  TREE_ROOT,
  parseDependencies,
  parsePackages,
  treePathFromMapValue,
} from './import-map.ts';
export type { PackageMapEntry } from './import-map.ts';

export { classifyReference, summarise } from './classify.ts';
export { planPack, unmetDependencies } from './pack-mode.ts';
export type { PackPlan, PlanPackOptions } from './pack-mode.ts';
export type {
  Classification,
  ClassificationReport,
  ClassifyOptions,
  ReferenceRole,
} from './classify.ts';

export {
  EXTENDS_KEY,
  EXTENDS_MAX_DEPTH,
  flattenInheritance,
  isExactParent,
  parseExtends,
  parseLink,
  resolveInheritance,
} from './inherit.ts';
export type {
  DecklistLink,
  FlatMap,
  InheritableMap,
  MapValue,
} from './inherit.ts';

/**
 * Resolve one specifier the way a browser resolves it against an import map.
 *
 * This is "resolve a module specifier" / "resolve an imports match" from
 * the HTML Standard (reference/html.spec.whatwg.org/import-maps.html,
 * snapshot of https://html.spec.whatwg.org/multipage/webappapis.html#import-maps).
 *
 * An exact key wins. Failing that, the longest key ending in `/` that
 * prefixes the specifier, with the remainder appended. Scopes are consulted
 * first, longest scope prefix first. A scope key that does not end in `/`
 * must match the importer URL exactly.
 *
 * `fromUrl` is the importing document or module — the argument that makes
 * scopes possible at all. Two decks can depend on different versions of one
 * library only because resolution knows who is asking.
 *
 * Returns `undefined` when the map says nothing about this specifier, which
 * the caller must distinguish from "resolved to nothing": a bare specifier
 * with no mapping is an error at load time, not a blank.
 */
export function resolveSpecifier(options: {
  specifier: string;
  fromUrl: string;
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
}): string | undefined {
  let { specifier, fromUrl, imports, scopes } = options;
  let applicable = Object.keys(scopes)
    .map((prefix) => ({ prefix, matched: scopeMatch(prefix, fromUrl) }))
    .filter((candidate) => candidate.matched !== undefined)
    .sort((a, b) => b.matched!.length - a.matched!.length);
  for (let { prefix } of applicable) {
    let hit = lookup(specifier, scopes[prefix]);
    if (hit) {
      return hit;
    }
  }
  return lookup(specifier, imports);
}

/**
 * Does this scope apply to this importer, and how specifically?
 *
 * Returns the matched prefix, so the caller can rank by how long the match
 * actually was rather than by how long the key was written.
 *
 * A scope key is a URL. The import maps spec resolves it against the map's
 * base URL and compares full URLs, and this does the same with the importer
 * as the base — because a page's map and the modules it governs are
 * same-origin by construction.
 *
 * Doing it by string prefix alone was enough for the reference server, which
 * emits `/site/…` scope keys and asks about `/site/…` module paths. It is not
 * enough for a host whose loader deals in absolute URLs: `/site/x/` would
 * never prefix `https://depot/site/x/y.js`, and the scope would be skipped in
 * silence — the resolution would still return an answer, just the wrong
 * version. That is the failure this had to not have.
 *
 * A prefix only prefixes when it ENDS IN A SLASH. Otherwise it must match the
 * importer exactly. That is the spec's rule, and dropping it is the classic
 * sibling-directory bug: a scope written `…/gallery` silently governs
 * `…/gallery-legacy/scene`, because one string does start with the other.
 * It matters more the more identifiers are hand-written — a Boxel decklist
 * spelling scopes as `@workspace/acme/gallery` is exactly that shape, and the
 * symptom is a neighbouring deck quietly resolving to the wrong version.
 */
function scopeMatch(prefix: string, fromUrl: string): string | undefined {
  if (covers(prefix, fromUrl)) {
    return prefix;
  }
  let absolute;
  try {
    absolute = new URL(prefix, fromUrl).href;
  } catch {
    return undefined; // fromUrl is not a usable base, so there is nothing to resolve against
  }
  return covers(absolute, fromUrl) ? absolute : undefined;
}

function covers(prefix: string, fromUrl: string): boolean {
  return (
    prefix === fromUrl || (prefix.endsWith('/') && fromUrl.startsWith(prefix))
  );
}

function lookup(
  specifier: string,
  table: Record<string, string>,
): string | undefined {
  if (table[specifier]) {
    return table[specifier];
  }
  // Longest prefix, not first match. A map holding both `three` and
  // `three-bvh-csg` resolves correctly whatever order the keys arrive in.
  let best: string | undefined;
  for (let key of Object.keys(table)) {
    if (key.endsWith('/') && specifier.startsWith(key)) {
      if (best === undefined || key.length > best.length) {
        best = key;
      }
    }
  }
  return best ? table[best] + specifier.slice(best.length) : undefined;
}
