import type { VirtualNetwork } from '../virtual-network.ts';

// Pass-scoped cache for `canonicalURL`, keyed on the two string inputs
// `(relativeTo, url)`. A hit returns the cached canonical string and skips
// `resolveURL` (and its transient `URL` allocation) entirely. Across one index
// pass the same `(base, dep)` pairs recur on nearly every card, so almost all
// calls are duplicates. The set of registered realm prefixes is stable within a
// pass, so `(relativeTo, url)` fully determines the result; the owner clears the
// map at each pass boundary. It is a string → string map — every consumer uses
// the returned string — so no `URL` instances are ever retained.
export type CanonicalURLMemo = Map<string, string>;

export function canonicalURL(
  url: string,
  relativeTo: string | undefined,
  virtualNetwork: VirtualNetwork,
  memo?: CanonicalURLMemo,
): string {
  if (!memo) {
    return computeCanonicalURL(url, relativeTo, virtualNetwork);
  }
  // `relativeTo` and `url` are URL strings that never contain a newline, so a
  // newline-joined key cannot collide across distinct input pairs.
  let key = `${relativeTo ?? ''}\n${url}`;
  let cached = memo.get(key);
  if (cached !== undefined) {
    return cached;
  }
  let result = computeCanonicalURL(url, relativeTo, virtualNetwork);
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
