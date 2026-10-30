import {
  ensureTrailingSlash,
  isPrefixForm,
  RealmPaths,
  ri,
  rri,
  type RealmIdentifier,
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
 * A realm in the form card ids carry: its registered prefix where it has one
 * (`@cardstack/base/` for the base realm's alias, the URL it is served from
 * and its prefix alike), otherwise the URL as given. For realm-membership
 * comparisons against ids, which deserialization canonicalizes the same way,
 * so the comparison itself is a same-form `RealmPaths` test with no
 * VirtualNetwork. Realm event subscriptions are keyed the same way.
 *
 * The trailing slash goes on first: the fold is a prefix match against
 * slash-terminated targets, so a slashless realm root would not fold. A realm
 * reached only through a URL mapping, with no prefix registered for it, is
 * returned as given; so is one whose spelling differs from its registered
 * target only by percent-encoding.
 */
export function canonicalRealmIdentifier(
  virtualNetwork: VirtualNetwork,
  realm: string,
): RealmIdentifier {
  return ri(virtualNetwork.unresolveURL(ensureTrailingSlash(realm)));
}

/**
 * A realm list in the form card ids carry: each entry folded by
 * `canonicalRealmIdentifier`, duplicates dropped, first spelling first. For
 * keys and comparisons that must treat every spelling of a realm as one.
 */
export function canonicalRealmIdentifiers(
  virtualNetwork: VirtualNetwork,
  realms: string[],
): RealmIdentifier[] {
  return [
    ...new Set(
      realms.map((realm) => canonicalRealmIdentifier(virtualNetwork, realm)),
    ),
  ];
}

/**
 * A realm list kept in the caller's spellings, each with its trailing slash,
 * with later spellings of a realm already listed dropped (two spellings are
 * one realm when `canonicalRealmIdentifier` folds them together). For a list
 * that is sent or reported as the caller named it.
 */
export function dedupeRealmsByIdentity(
  virtualNetwork: VirtualNetwork,
  realms: string[],
): RealmIdentifier[] {
  let seen = new Set<string>();
  let deduped: RealmIdentifier[] = [];
  for (let realm of normalizeRealms(realms)) {
    let identity = canonicalRealmIdentifier(virtualNetwork, realm);
    if (!seen.has(identity)) {
      seen.add(identity);
      deduped.push(ri(realm));
    }
  }
  return deduped;
}

/**
 * A realm's URL as shown beside its name, so realms that share a name can be
 * told apart: host and path, without the scheme or trailing slash.
 *
 * Every spelling (registered prefix, virtual alias, real URL) is folded onto
 * the real served URL, then back through any registered URL alias, as
 * `VirtualNetwork.realmForReference` does. For an aliased realm like base,
 * that is the URL its card ids use rather than the host serving it.
 *
 * @example
 * realmURLDisplayText(vn, '@cardstack/base/')                   // 'cardstack.com/base'
 * realmURLDisplayText(vn, 'https://app.boxel.ai/user/pret-ui/') // 'app.boxel.ai/user/pret-ui'
 * realmURLDisplayText(vn, '@unmapped/thing/')                   // '@unmapped/thing/'
 */
export function realmURLDisplayText(
  virtualNetwork: VirtualNetwork,
  realmIdentifier: string,
): string {
  let real = virtualNetwork.keyForIdentifier(realmIdentifier);
  let url: URL;
  try {
    url = virtualNetwork.mapURL(real, 'real-to-virtual') ?? new URL(real);
  } catch {
    return real;
  }
  return urlDisplayText(url);
}

/**
 * A URL as shown to a person: host and path, without the scheme or trailing
 * slash, which take room and tell addresses apart no better. A string that
 * isn't a URL comes back as it is.
 *
 * @example
 * urlDisplayText('https://my-site.boxel.site/') // 'my-site.boxel.site'
 */
export function urlDisplayText(url: URL | string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return String(url);
  }
  return parsed.host + parsed.pathname.replace(/\/$/, '');
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
  if (isPrefixForm(realmIdentifier)) {
    return realmIdentifier.split('/').filter(Boolean);
  }
  try {
    return new URL(realmIdentifier).pathname.split('/').filter(Boolean);
  } catch {
    return [];
  }
}
