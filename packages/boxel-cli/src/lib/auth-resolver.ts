import {
  getProfileManager,
  type ProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
} from './profile-manager.ts';
import type { RealmAuthenticator } from './realm-authenticator.ts';
import { SeedAuthenticator } from './seed-auth.ts';

export interface AuthResolverOptions {
  /** Realm URL the command is operating on (used for registering the seed-auth cache). */
  realmUrl: string;
  /**
   * Already-resolved realm secret seed. Callers who want env + prompt
   * resolution should go through `resolveRealmSecretSeed` in `./prompt` first.
   */
  realmSecretSeed?: string;
  /** Override the ProfileManager (tests). When seed mode is active we won't touch it. */
  profileManager?: ProfileManager;
}

export type AuthResolution =
  | { ok: true; authenticator: RealmAuthenticator; mode: 'seed' | 'profile' }
  | { ok: false; error: string };

/**
 * Pick between seed-based auth and profile-based auth.
 *
 *  - If `realmSecretSeed` is present, use `SeedAuthenticator`. We do NOT
 *    require a profile in this mode — operators using the seed typically
 *    don't have a Matrix account configured.
 *  - Otherwise, fall back to the profile flow and require an active profile.
 */
export function resolveRealmAuthenticator(
  options: AuthResolverOptions,
): AuthResolution {
  if (options.realmSecretSeed) {
    // registerRealmUrl throws on a malformed realm URL; surface that as a
    // resolver error so pull/push/sync keep their friendly CLI error path.
    try {
      const authenticator = new SeedAuthenticator({
        seed: options.realmSecretSeed,
      });
      authenticator.registerRealmUrl(options.realmUrl);
      return { ok: true, authenticator, mode: 'seed' };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const pm = options.profileManager ?? getProfileManager();
  if (!pm.getActiveProfile()) {
    return { ok: false, error: NO_ACTIVE_PROFILE_ERROR };
  }
  return { ok: true, authenticator: pm, mode: 'profile' };
}
