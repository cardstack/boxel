import {
  prefixRealmNetworkFor,
  type PrefixRealmNetwork,
} from '@cardstack/runtime-common/prefix-realm-network';
import { isPrefixForm } from '@cardstack/runtime-common/realm-identifiers';
import { getProfileManager, type ProfileManager } from './profile-manager.ts';

/**
 * Realm identifiers in prefix form (`@cardstack/catalog/…`) resolve on a
 * network built from the prefix map the realm server serves (ADR 002 §1.2):
 * where each prefix realm is served is whatever that server says, not a
 * function of the prefix's spelling.
 */

export interface ResolveRealmIdentifierOptions {
  /** Override the ProfileManager used to look up the realm-server URL (tests). */
  profileManager?: ProfileManager;
  /**
   * Explicit realm-server base URL whose prefix map to resolve against. Takes
   * precedence over the active profile and the REALM_SERVER_URL environment
   * variable.
   */
  realmServerUrl?: string;
  /** The fetch that reads the realm server's prefix map (tests). */
  fetch?: typeof globalThis.fetch;
}

export type RealmIdentifierResolution =
  | { ok: true; url: string }
  | { ok: false; error: string };

export type RealmNetworkResolution =
  | { ok: true; network: PrefixRealmNetwork }
  | { ok: false; error: string };

export type { PrefixRealmNetwork };

/**
 * The network built from the prefix map of the realm server the CLI is
 * configured against: `options.realmServerUrl`, else the active profile's
 * server, else REALM_SERVER_URL. Read once per server for the life of the
 * process.
 */
export async function resolveRealmNetwork(
  options?: ResolveRealmIdentifierOptions,
): Promise<RealmNetworkResolution> {
  let server = resolveRealmServerUrl(options);
  if (!server.ok) {
    return server;
  }
  try {
    return {
      ok: true,
      network: await prefixRealmNetworkFor(server.url, options?.fetch),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Resolve a realm identifier argument to a URL. URL form passes through
 * unchanged; prefix form resolves on the realm server's network (see
 * `resolveRealmNetwork`).
 */
export async function resolveRealmIdentifier(
  input: string,
  options?: ResolveRealmIdentifierOptions,
): Promise<RealmIdentifierResolution> {
  if (!isPrefixForm(input)) {
    return { ok: true, url: input };
  }
  let resolved = await resolveRealmNetwork(options);
  if (!resolved.ok) {
    return resolved;
  }
  try {
    return { ok: true, url: resolved.network.toURLHref(input) };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function resolveRealmServerUrl(
  options?: ResolveRealmIdentifierOptions,
): { ok: true; url: string } | { ok: false; error: string } {
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
