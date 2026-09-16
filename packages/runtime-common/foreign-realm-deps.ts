import type { VirtualNetwork } from './virtual-network.ts';

// Whether any of a row's dependencies is a card instance in another realm.
//
// `index-writer.calculateInvalidations` filters dependents by
// `realm_url = $thisRealm` (see the comment there: "probably need to
// reevaluate this condition when we get to cross realm invalidation"), so a
// write to a foreign card moves that realm's `indexed_at` and never ours. A
// stable local `indexed_at` therefore does NOT mean this row's assembled
// `included[]` is current — `loadLinks` re-fetches the foreign card over HTTP
// and may surface new content. Anything keyed on the local row's freshness has
// to opt such a row out: the card+json GET suppresses its ETag, and the
// link-assembly cache declines to retain the resource.
export function hasForeignRealmDeps(
  deps: string[] | null | undefined,
  realmURL: string,
  virtualNetwork: VirtualNetwork,
): boolean {
  if (!deps?.length) {
    return false;
  }
  for (let dep of deps) {
    if (isForeignRealmDep(dep, realmURL, virtualNetwork)) {
      return true;
    }
  }
  return false;
}

function isForeignRealmDep(
  dep: string,
  realmURL: string,
  virtualNetwork: VirtualNetwork,
): boolean {
  // Resolve registered prefixes back to absolute URLs first. Production
  // deployments register every realm via `addRealmMapping`, so deps in
  // `boxel_index.deps` are typically stored in prefix form
  // (`@cardstack/foreign-realm/foo.json`) — comparing them as raw strings
  // against the realm URL would always say "not foreign" and the guard would
  // silently fail to fire.
  let resolved: string;
  try {
    resolved = virtualNetwork.toURL(dep).href;
  } catch {
    // Bare specifier with no matching prefix mapping. `loadLinks` can't fetch
    // it, so it's not a request-time mutation source — not a foreign-instance
    // dep for our purposes.
    return false;
  }
  // Only foreign card *instance* deps put a local-freshness key at risk.
  // Module deps (`.gts`/`.ts`/`.js`) and scoped CSS don't load through
  // `loadLinks` and don't contribute to the assembled `included[]`. Cards
  // universally adopt from base modules
  // (`https://cardstack.com/base/card-api.gts`) — treating those as foreign
  // would blanket-suppress every card. The relationship-dependency extractor
  // normalizes instance deps to `.json` (see `dependency-normalization.ts`),
  // so checking that suffix isolates the deps that actually matter.
  if (!resolved.endsWith('.json')) {
    return false;
  }
  return !resolved.startsWith(realmURL);
}
