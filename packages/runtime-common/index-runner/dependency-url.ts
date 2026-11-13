import type { VirtualNetwork } from '../virtual-network.ts';

// Pass-scoped cache for `canonicalURL`. A hit returns the cached canonical
// string and skips `resolveURL` (and its transient `URL` allocation) entirely.
// The set of registered realm prefixes is stable within a pass, so the inputs
// determine the result; the owner clears the map at each pass boundary. It is a
// string → string map — every consumer uses the returned string — so no `URL`
// instances are ever retained.
//
// The key holds only the part of `relativeTo` the result depends on
// (`memoKey`). `relativeTo` is usually the card being indexed, which differs
// for every card, so a key holding all of it never repeats across cards: the
// map gained an entry per (card, dependency) and held about a quarter of a
// megabyte per file until the pass ended, which ran a realm-sized pass out of
// heap. An absolute URL or a registered prefix ignores the base, a relative
// path depends only on the base's directory, and a root-relative one only on
// its origin, so those keys are shared by every card that has them.
export type CanonicalURLMemo = Map<string, string>;

// A ceiling on one pass's memo, should its keys ever stop repeating: past it
// the memo starts over, which costs only recomputation.
export const CANONICAL_URL_MEMO_MAX_ENTRIES = 50_000;

const SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const ORIGIN = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\/[^/?#]*/;

// The memo key for `(url, relativeTo)`: the URL, with the part of the base its
// resolution reads.
function memoKey(
  url: string,
  relativeTo: string | undefined,
  virtualNetwork: VirtualNetwork,
): string {
  if (SCHEME.test(url) || virtualNetwork.isRegisteredPrefix(url)) {
    return `\n${url}`;
  }
  let base = relativeTo ?? '';
  if (url === '' || url.startsWith('?') || url.startsWith('#')) {
    return `${base}\n${url}`;
  }
  if (url.startsWith('/') && !url.startsWith('//')) {
    let origin = ORIGIN.exec(base)?.[0];
    return origin !== undefined ? `${origin}\n${url}` : `${base}\n${url}`;
  }
  let path = base.split(/[?#]/)[0] ?? base;
  let slash = path.lastIndexOf('/');
  return slash >= 0
    ? `${path.slice(0, slash + 1)}\n${url}`
    : `${base}\n${url}`;
}

export function canonicalURL(
  url: string,
  relativeTo: string | undefined,
  virtualNetwork: VirtualNetwork,
  memo?: CanonicalURLMemo,
): string {
  if (!memo) {
    return computeCanonicalURL(url, relativeTo, virtualNetwork);
  }
  // URL strings never contain a newline, so a newline-joined key cannot
  // collide across inputs that resolve differently.
  let key = memoKey(url, relativeTo, virtualNetwork);
  let cached = memo.get(key);
  if (cached !== undefined) {
    return cached;
  }
  let result = computeCanonicalURL(url, relativeTo, virtualNetwork);
  if (memo.size >= CANONICAL_URL_MEMO_MAX_ENTRIES) {
    memo.clear();
  }
  memo.set(key, result);
  return result;
}

function computeCanonicalURL(
  url: string,
  relativeTo: string | undefined,
  virtualNetwork: VirtualNetwork,
): string {
  try {
    // If the URL is already a registered prefix (e.g. @cardstack/catalog/foo),
    // keep it in that form — it's already canonical.
    if (virtualNetwork.isRegisteredPrefix(url)) {
      let stripped = url.split('#')[0] ?? url;
      return stripped.split('?')[0] ?? stripped;
    }
    let parsed = virtualNetwork.resolveURL(url, relativeTo);
    parsed.search = '';
    parsed.hash = '';
    // Convert resolved URLs back to prefix form if possible
    return virtualNetwork.unresolveURL(parsed.href);
  } catch (_e) {
    let stripped = url.split('#')[0] ?? url;
    return stripped.split('?')[0] ?? stripped;
  }
}
