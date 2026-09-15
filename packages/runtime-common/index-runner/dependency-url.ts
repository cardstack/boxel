import type { VirtualNetwork } from '../virtual-network.ts';

// Realm mappings remain stable for this pass; the owner clears the memo at
// each pass boundary. Only relative references need the consuming card's base.
// Lattice's full-app workload exposed millions of redundant keys containing
// encoded CSS payloads. Bound both entry count and retained string lengths;
// eviction/bypass recomputes the result without discarding any dependency.
export type CanonicalURLMemo = Map<string, string>;
const MAX_MEMO_ENTRIES = 20_000;
const MAX_MEMO_ENTRY_CHARS = 4096;
const ABSOLUTE_HTTP_URL = /^https?:\/\//i;

export function canonicalURL(
  url: string,
  relativeTo: string | undefined,
  virtualNetwork: VirtualNetwork,
  memo?: CanonicalURLMemo,
): string {
  if (!memo) {
    return computeCanonicalURL(url, relativeTo, virtualNetwork);
  }
  let base =
    virtualNetwork.isRegisteredPrefix(url) || ABSOLUTE_HTTP_URL.test(url)
      ? ''
      : (relativeTo ?? '');
  if (base.length + url.length + 1 > MAX_MEMO_ENTRY_CHARS) {
    return computeCanonicalURL(url, relativeTo, virtualNetwork);
  }
  // URL strings do not contain newlines, so the pair remains unambiguous.
  let key = `${base}\n${url}`;
  let cached = memo.get(key);
  if (cached !== undefined) {
    return cached;
  }
  let result = computeCanonicalURL(url, relativeTo, virtualNetwork);
  if (key.length + result.length <= MAX_MEMO_ENTRY_CHARS) {
    if (memo.size >= MAX_MEMO_ENTRIES) {
      memo.delete(memo.keys().next().value!);
    }
    memo.set(key, result);
  }
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
