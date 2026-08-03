import { rri } from '../realm-identifiers.ts';
import { hasExecutableExtension, trimExecutableExtension } from '../index.ts';
import { segmentNamesFile } from '../file-def-code-ref.ts';
import type { VirtualNetwork } from '../virtual-network.ts';
import { canonicalURL, type CanonicalURLMemo } from './dependency-url.ts';

// Which resource a dependency URL names: a card instance, whose index row lives
// at `<id>.json`, or a file, whose row lives at the file's own URL. A known
// extension — one a file link resolves a FileDef subtype through, or an
// executable extension a module is served under — settles it, and a last
// segment with no dot at all settles it the other way, because an instance's
// `.json` is stripped from its id.
//
// Nothing settles the rest. A dotted last segment is a card id (`hello.test`
// beside the `hello.test.gts` module, a `ModelConfiguration/claude-sonnet-4.6`
// instance) as readily as a file whose extension is outside the FileDef
// registry (a `report.pdf` attachment), so those come back as 'either'.
//
// `.json` is itself a registered extension, which is what leaves a dep already
// in an instance's stored form alone. The one id shape that reads wrong is a
// card id ending in `.json`, whose row is at `<id>.json.json`.
type NamedResource = 'file' | 'instance' | 'either';

// The dotless test runs first: it alone settles the dominant case (module deps
// are stored with their executable extension stripped, so most deps are
// dotless), and this classifier sits on the per-dep loop of every index visit
// — including successful ones, via the index-backed dependency-error scan — so
// the registry walk must stay off that path. Ordering is free: the registry
// and executable tests can only match a segment that has a dot.
//
// String-based for the same reason: `path` may be a pathname or a whole
// canonical href — any query and hash must already be stripped — so the
// per-dep loop never constructs a URL.
function namedResourceForPath(path: string): NamedResource {
  let lastSegment = path.slice(path.lastIndexOf('/') + 1);
  if (!lastSegment.includes('.')) {
    return 'instance';
  }
  if (segmentNamesFile(lastSegment) || hasExecutableExtension(path)) {
    return 'file';
  }
  return 'either';
}

function namedResource(url: URL): NamedResource {
  return namedResourceForPath(url.pathname);
}

export function normalizeStoredDependency(
  dep: string,
  relativeTo: URL,
  virtualNetwork: VirtualNetwork,
  memo?: CanonicalURLMemo,
): string {
  return canonicalURL(dep, relativeTo.href, virtualNetwork, memo);
}

// Every stored form an in-realm relationship dependency can take. Invalidation
// matches a dep against a row URL by exact string, so a dep recorded in the
// wrong form matches nothing and writing the target never invalidates this
// consumer. Where `namedResource` can't tell a card id from a file, both
// candidate forms are recorded rather than one guessed: an unmatched dep costs
// a string, a missing one costs the consumer its invalidation.
export function relationshipDependencyForms(
  dep: string,
  relativeTo: URL,
  realmURL: URL,
  virtualNetwork: VirtualNetwork,
  memo?: CanonicalURLMemo,
): string[] {
  let canonical = canonicalURL(dep, relativeTo.href, virtualNetwork, memo);
  // Prefix-form deps (e.g. @cardstack/catalog/foo) are already canonical.
  // Resolve to check realm membership and add .json if needed.
  if (virtualNetwork.isRegisteredPrefix(canonical)) {
    let resolved = virtualNetwork.toURL(canonical).href;
    try {
      let parsed = new URL(resolved);
      if (parsed.href.startsWith(realmURL.href)) {
        let named = namedResource(parsed);
        if (named === 'file') {
          return [canonical];
        }
        let instanceForm = `${canonical}.json`;
        return named === 'instance'
          ? [instanceForm]
          : [canonical, instanceForm];
      }
    } catch (_err) {
      // fall through
    }
    return [canonical];
  }
  try {
    let normalized = new URL(canonical);
    if (!normalized.href.startsWith(realmURL.href)) {
      return [normalized.href];
    }
    let named = namedResource(normalized);
    if (named === 'file') {
      return [normalized.href];
    }
    let fileForm = normalized.href;
    normalized.pathname = `${normalized.pathname}.json`;
    return named === 'instance'
      ? [normalized.href]
      : [fileForm, normalized.href];
  } catch (_err) {
    return [canonical];
  }
}

// Traversal follows a dep to the index row named by that exact URL, so it takes
// every dep that could name one. A dep reading as a bare instance id never
// does — no row is keyed on that form — and such a dep is a module reference in
// node-resolution form, whose errors reach a consumer through the definition
// cache instead. Everything else is admitted, undecidable dotted names
// included: a dep naming no row reads as a miss, so admitting one costs a
// lookup rather than correctness.
// String-only on the same per-visit-per-dep grounds as `namedResourceForPath`.
// Both callers hand this `normalizeStoredDependency` output — a canonical href
// (already a parsed URL's `.href`, query and hash stripped) or a prefix form
// the memoized `toURLHref` converts to one — so parsing through `new URL`
// would only re-derive the same string. The realm gate keeps that safe for
// any other input too: a string that isn't a canonical URL fails `startsWith`
// and is rejected, exactly as URL-parsing would reject it. The query/hash
// strip is belt-and-braces for direct callers, at two indexOf calls.
export function canTraverseRelationshipDependency(
  dep: string,
  realmURL: URL,
  virtualNetwork: VirtualNetwork,
): boolean {
  let resolved = dep;
  if (virtualNetwork.isRegisteredPrefix(dep)) {
    try {
      resolved = virtualNetwork.toURLHref(dep);
    } catch (_err) {
      return false;
    }
  }
  if (!resolved.startsWith(realmURL.href)) {
    return false;
  }
  let hashIdx = resolved.indexOf('#');
  if (hashIdx !== -1) {
    resolved = resolved.slice(0, hashIdx);
  }
  let searchIdx = resolved.indexOf('?');
  if (searchIdx !== -1) {
    resolved = resolved.slice(0, searchIdx);
  }
  return namedResourceForPath(resolved) !== 'instance';
}

export function normalizeDependencyForLookup(
  dep: string,
  relativeTo: URL,
  virtualNetwork: VirtualNetwork,
  memo?: CanonicalURLMemo,
): string {
  let canonical = canonicalURL(dep, relativeTo.href, virtualNetwork, memo);
  return trimExecutableExtension(rri(canonical));
}
