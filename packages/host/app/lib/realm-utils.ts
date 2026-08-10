import {
  RealmPaths,
  ri,
  rri,
  type VirtualNetwork,
} from '@cardstack/runtime-common';

/**
 * Normalizes realm identifiers by ensuring they have trailing slashes.
 *
 * Accepts either form an identifier can take — a realm URL or a canonical
 * identifier — and preserves it. Parsing as a URL would reject the canonical
 * form outright.
 *
 * @param realms - Array of realm identifiers to normalize
 * @returns Array of normalized realm identifiers
 *
 * @example
 * normalizeRealms(['http://localhost:4201/test', '@cardstack/base'])
 * // Returns: ['http://localhost:4201/test/', '@cardstack/base/']
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
