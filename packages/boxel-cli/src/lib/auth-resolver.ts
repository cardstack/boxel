import {
  getProfileManager,
  type ProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
} from './profile-manager';
import type { RealmAuthenticator } from './realm-authenticator';
import { SeedAuthenticator } from './seed-auth';

export interface AuthResolverOptions {
  /** Realm URL the command is operating on (used for registering the seed-auth cache). */
  realmUrl: string;
  /** Explicit seed (from --realm-secret-seed). Wins over BOXEL_REALM_SECRET_SEED. */
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
 * Rules:
 *  - If `realmSecretSeed` (or `BOXEL_REALM_SECRET_SEED`) is present, use
 *    `SeedAuthenticator`. We do NOT require a profile in this mode — operators
 *    using the seed typically don't have a Matrix account configured.
 *  - Otherwise, fall back to the profile flow and require an active profile,
 *    preserving the existing error message so callers' handling stays intact.
 */
export function resolveRealmAuthenticator(
  options: AuthResolverOptions,
): AuthResolution {
  const seed = options.realmSecretSeed ?? process.env.BOXEL_REALM_SECRET_SEED;
  if (seed) {
    const authenticator = new SeedAuthenticator({ seed });
    authenticator.registerRealmUrl(options.realmUrl);
    return { ok: true, authenticator, mode: 'seed' };
  }

  const pm = options.profileManager ?? getProfileManager();
  if (!pm.getActiveProfile()) {
    return { ok: false, error: NO_ACTIVE_PROFILE_ERROR };
  }
  return { ok: true, authenticator: pm, mode: 'profile' };
}
