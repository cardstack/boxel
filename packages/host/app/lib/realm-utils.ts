import {
  isUrlLike,
  RealmPaths,
  ri,
  rri,
  type VirtualNetwork,
} from '@cardstack/runtime-common';

/**
 * Normalizes realm URLs by ensuring they have trailing slashes and
 * are properly formatted using RealmPaths.
 *
 * @param realms - Array of realm URL strings to normalize
 * @returns Array of normalized realm URL strings
 *
 * @example
 * normalizeRealms(['http://localhost:4201/test', 'http://localhost:4201/demo/'])
 * // Returns: ['http://localhost:4201/test/', 'http://localhost:4201/demo/']
 */
export function normalizeRealms(realms: string[]): string[] {
  return realms.map((r) => {
    return new RealmPaths(ri(r)).url;
  });
}

/**
 * Resolves which realm a card belongs to by checking if the card URL
 * is within any of the provided realm URLs.
 *
 * @param cardId - The card URL/ID to resolve
 * @param realms - Array of normalized realm URLs to check against
 * @returns The realm URL that contains the card, or the card's own realm if no match
 *
 * @example
 * resolveCardRealmUrl(
 *   'http://localhost:4201/test/cards/1',
 *   ['http://localhost:4201/test/', 'http://localhost:4201/demo/']
 * )
 * // Returns: 'http://localhost:4201/test/'
 */
export function resolveCardRealmUrl(
  cardId: string,
  realms: string[],
  virtualNetwork: VirtualNetwork,
): string {
  let cardRRI = rri(cardId);
  for (let realm of realms) {
    let realmUrl = new URL(realm);
    let realmPaths = new RealmPaths(realmUrl);
    if (realmPaths.inRealm(cardRRI)) {
      return realmPaths.url;
    }
  }
  return new RealmPaths(virtualNetwork.toURL(cardId)).url;
}

/**
 * A realm identifier as a URL href, whichever form it arrives in.
 *
 * `virtualNetwork.toURL` already resolves a registered prefix and parses a URL
 * form unchanged, so it covers both spellings on its own. What it does not do
 * is tolerate an identifier that is neither — an unregistered prefix, a bare
 * local id — where it throws. The callers here are display and lookup paths
 * that must not fail a render over an identifier they cannot place, so an
 * unresolvable identifier comes back untouched and the caller's existing
 * handling for an unplaceable realm applies.
 *
 * @example
 * // with '@cardstack/base/' mapped to 'https://realms.example.com/base/'
 * resolvedRealmURLHref(vn, '@cardstack/base/')  // 'https://realms.example.com/base/'
 * resolvedRealmURLHref(vn, 'https://x.test/r/') // 'https://x.test/r/'
 * resolvedRealmURLHref(vn, '@unmapped/thing/')  // '@unmapped/thing/'
 */
export function resolvedRealmURLHref(
  virtualNetwork: VirtualNetwork,
  realmIdentifier: string,
): string {
  return virtualNetwork.isRegisteredPrefix(realmIdentifier)
    ? virtualNetwork.toURL(realmIdentifier).href
    : realmIdentifier;
}

/**
 * The segments that *name* a realm, in whichever form its identifier is
 * expressed. For naming a realm — a label, a heading — not for locating it.
 *
 * A realm identifier is either a URL (`https://host/foo/bar/`) or a registered
 * prefix (`@scope/name/`). Only the first has a pathname to take apart, so
 * deriving segments by parsing loses the prefix form — silently, if the parse
 * sits in a `try`. Both forms end in the segment that names the realm, which
 * is what a label is after.
 *
 * The two forms do NOT agree on where a realm is mounted: `@cardstack/base/`
 * names two segments while the realm it maps to is served at `/base/`. Anything
 * matching a request path against a realm must resolve the identifier through
 * `virtualNetwork.toURL()` and use that pathname instead.
 *
 * @example
 * realmIdentifierSegments('https://cardstack.com/base/')  // ['base']
 * realmIdentifierSegments('@cardstack/base/')             // ['@cardstack', 'base']
 * realmIdentifierSegments('https://example.com/')         // []
 */
export function realmIdentifierSegments(realmIdentifier: string): string[] {
  if (!isUrlLike(realmIdentifier)) {
    return realmIdentifier.split('/').filter(Boolean);
  }
  try {
    return new URL(realmIdentifier).pathname.split('/').filter(Boolean);
  } catch {
    return [];
  }
}
