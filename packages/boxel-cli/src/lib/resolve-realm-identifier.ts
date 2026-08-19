import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { getProfileManager, type ProfileManager } from './profile-manager.ts';

/**
 * Realm resource identifiers (RRIs) in the cardstack scope follow the
 * convention `@cardstack/<realm>/…` → `<realm-server>/<realm>/…` in every
 * environment — the same prefix→URL pairs the realm server registers at boot
 * (`@cardstack/base/`, `@cardstack/catalog/`, `@cardstack/skills/`, …).
 */
const CARDSTACK_SCOPE = '@cardstack/';

export interface ResolveRealmIdentifierOptions {
  /** Override the ProfileManager used to look up the realm-server URL (tests). */
  profileManager?: ProfileManager;
  /**
   * Explicit realm-server base URL to resolve against. Takes precedence over
   * the active profile and the REALM_SERVER_URL environment variable.
   */
  realmServerUrl?: string;
}

export type RealmIdentifierResolution =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** Whether the input is a non-URL realm resource identifier (`@cardstack/…`). */
export function isRealmResourceIdentifier(input: string): boolean {
  return input.startsWith('@');
}

/**
 * Resolve a realm identifier argument to a URL. Plain URLs pass through
 * unchanged; `@cardstack/<realm>/…` identifiers resolve against the
 * realm-server base URL from (in order) `options.realmServerUrl`, the active
 * profile, or the REALM_SERVER_URL environment variable.
 */
export function resolveRealmIdentifier(
  input: string,
  options?: ResolveRealmIdentifierOptions,
): RealmIdentifierResolution {
  if (!isRealmResourceIdentifier(input)) {
    return { ok: true, url: input };
  }
  if (!input.startsWith(CARDSTACK_SCOPE)) {
    return {
      ok: false,
      error: `Unsupported realm identifier "${input}": only @cardstack/<realm>/ identifiers are supported`,
    };
  }
  let remainder = input.slice(CARDSTACK_SCOPE.length);
  if (!remainder.split('/')[0]) {
    return {
      ok: false,
      error: `Malformed realm identifier "${input}": expected @cardstack/<realm>/…`,
    };
  }
  let server = resolveRealmServerUrl(options);
  if (!server.ok) {
    return server;
  }
  return {
    ok: true,
    url: new URL(remainder, ensureTrailingSlash(server.url)).href,
  };
}

/**
 * Split a full-RRI file identifier into its realm identifier and
 * realm-relative path: `@cardstack/catalog/foo/bar.gts` →
 * `{ realm: '@cardstack/catalog/', path: 'foo/bar.gts' }`. Returns undefined
 * when the input isn't an RRI or has no path component after the realm.
 */
export function splitRealmResourceIdentifier(
  input: string,
): { realm: string; path: string } | undefined {
  if (!input.startsWith(CARDSTACK_SCOPE)) {
    return undefined;
  }
  let remainder = input.slice(CARDSTACK_SCOPE.length);
  let slash = remainder.indexOf('/');
  if (slash === -1 || slash === remainder.length - 1) {
    return undefined;
  }
  return {
    realm: `${CARDSTACK_SCOPE}${remainder.slice(0, slash)}/`,
    path: remainder.slice(slash + 1),
  };
}

function resolveRealmServerUrl(
  options?: ResolveRealmIdentifierOptions,
): RealmIdentifierResolution {
  if (options?.realmServerUrl) {
    return { ok: true, url: options.realmServerUrl };
  }
  let active = (
    options?.profileManager ?? getProfileManager()
  ).getActiveProfile();
  if (active) {
    return { ok: true, url: active.profile.realmServerUrl };
  }
  if (process.env.REALM_SERVER_URL) {
    return { ok: true, url: process.env.REALM_SERVER_URL };
  }
  return {
    ok: false,
    error:
      'Cannot resolve a @cardstack/ realm identifier without a realm-server URL. Run `boxel profile add` to create a profile, or set REALM_SERVER_URL.',
  };
}
