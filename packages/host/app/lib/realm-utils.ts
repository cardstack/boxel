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
 * The meaningful segments of a realm identifier, in whichever form it is
 * expressed.
 *
 * A realm identifier is either a URL (`https://host/foo/bar/`) or a registered
 * prefix (`@scope/name/`). Only the first has a pathname to take apart, so
 * anything deriving segments by parsing loses the prefix form — silently, if
 * the parse sits in a `try`. Both forms name the realm by the same trailing
 * segments, which is what callers here are after.
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
