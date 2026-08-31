/**
 * The realms addressed by a registered `@cardstack/…` prefix.
 *
 * Every process that resolves module references does so through its own
 * VirtualNetwork, and `internalKeyFor` keys the cross-process definitions cache
 * by the result. A prefix one process has registered and another has not
 * therefore yields keys that never match: the host's prerender writes that
 * cache and the realm-server reads it back. The two sides learn their mappings
 * from unrelated inputs — the host from baked build config, the realm-server
 * from `--fromUrl`/`--toUrl` arguments — so nothing in either mechanism keeps
 * their sets equal. This is the one declaration of that set, and each side is
 * checked against it.
 *
 * Only infrastructure realms are addressed this way. User realms are not, so
 * this list is the whole set rather than a sample of it, and it changes about
 * as often as a realm is added to the deployment.
 */
export interface PrefixRealm {
  /** The registered prefix. Always `@scope/name/`, with the trailing slash. */
  prefix: string;
  /**
   * A `https://` alias that must resolve to the same realm. Only the base realm
   * has one: it predates the prefix form and is still written into stored card
   * data, so both spellings have to land on the same place. A realm with no
   * alias is reached by its prefix and its served URL alone.
   */
  alias?: string;
  /**
   * The host build-config property holding this realm's resolved URL. The host
   * bakes its realm locations in at build time and cannot read the environment
   * at run time, so the property name is part of this contract rather than
   * derivable from the prefix — `@cardstack/openrouter/` is spelled
   * `resolvedOpenRouterRealmURL`, which no casing rule recovers from the
   * lowercase prefix segment. The realm-server takes the same URL from
   * `--toUrl` instead and needs no entry here.
   *
   * A property that is absent or empty means the realm is not present in that
   * build, and the mapping is skipped: the catalog and openrouter realms are
   * nulled for the host test environment.
   */
  hostConfigKey: string;
}

export const PREFIX_REALMS: readonly PrefixRealm[] = Object.freeze([
  {
    prefix: '@cardstack/base/',
    alias: 'https://cardstack.com/base/',
    hostConfigKey: 'resolvedBaseRealmURL',
  },
  {
    prefix: '@cardstack/catalog/',
    hostConfigKey: 'resolvedCatalogRealmURL',
  },
  {
    prefix: '@cardstack/skills/',
    hostConfigKey: 'resolvedSkillsRealmURL',
  },
  {
    prefix: '@cardstack/openrouter/',
    hostConfigKey: 'resolvedOpenRouterRealmURL',
  },
]);

/** Just the prefixes, for comparing one side's registered set against this one. */
export const PREFIX_REALM_PREFIXES: readonly string[] = Object.freeze(
  PREFIX_REALMS.map((realm) => realm.prefix),
);
