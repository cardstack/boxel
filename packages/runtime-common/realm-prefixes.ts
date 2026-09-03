import { baseRealm, baseRealmRRI } from './constants.ts';

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
 *
 * `@cardstack/boxel-ui/` is deliberately absent. The host registers it as a
 * realm mapping in `externals.ts`, but it names a shimmed package namespace
 * pointing at the fake-packages origin rather than a realm, and the
 * realm-server reaches those modules as globally-public dependencies instead.
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
   * The host build-config property naming this realm's URL as a *member of the
   * environment* — what the realm lists, the catalog-realms endpoint and the
   * default card ids read. That is a different question from where the prefix
   * resolves to, which the host takes from `config.prefixRealmURLs` keyed by
   * `prefix`: a test build trims realms out of its lists for isolation while
   * still needing their prefixes to resolve.
   *
   * Named here because `serve-index` rewrites these properties for the deployed
   * host, and doing that from the declaration means adding a realm is one entry
   * rather than an entry plus an edit it is easy to forget.
   */
  hostConfigKey: string;
}

export const PREFIX_REALMS: readonly PrefixRealm[] = Object.freeze([
  {
    prefix: baseRealmRRI,
    alias: baseRealm.url,
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
