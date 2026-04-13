import { getProfileManager } from './profile-manager';

/**
 * Returns a `fetch`-shaped function bound to a specific realm. Every call
 * automatically attaches the per-realm JWT for `realmUrl` (acquiring or
 * refreshing it via the active profile as needed) and retries once on a
 * 401 with a freshly minted token.
 *
 * Callers pass the returned function around like ordinary `fetch`; they
 * never see ProfileManager or any tokens. This is the shape downstream
 * code (factory tools, agent, etc.) already expects.
 */
export function createRealmFetch(realmUrl: string): typeof globalThis.fetch {
  let pm = getProfileManager();
  return ((input, init) =>
    pm.authedFetch(input, init, { realmUrl })) as typeof globalThis.fetch;
}
