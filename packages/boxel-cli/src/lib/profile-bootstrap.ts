import { getProfileManager, getUsernameFromMatrixId } from './profile-manager';

export class NoActiveProfileError extends Error {
  readonly code: 'no_active_profile';
  constructor() {
    super(
      'No active Boxel profile. Run `boxel profile add` or set MATRIX_URL, MATRIX_USERNAME, MATRIX_PASSWORD, and REALM_SERVER_URL.',
    );
    this.code = 'no_active_profile';
  }
}

export interface ActiveProfileSummary {
  /** Full Matrix ID, e.g. "@alice:boxel.ai". */
  matrixId: string;
  /** Bare username portion of the Matrix ID. */
  username: string;
  matrixUrl: string;
  realmServerUrl: string;
}

/**
 * Ensures the boxel-cli singleton has an active profile. If none is
 * configured, attempts to create one from MATRIX_URL/MATRIX_USERNAME/
 * MATRIX_PASSWORD/REALM_SERVER_URL env vars. Throws NoActiveProfileError
 * if neither source produces a usable profile.
 *
 * Intended to be called once at process startup by library consumers
 * (e.g. the software factory) before invoking createRealm or
 * createRealmFetch.
 */
export async function ensureActiveProfile(): Promise<void> {
  let pm = getProfileManager();
  if (pm.getActiveProfile()) return;
  await pm.migrateFromEnv();
  if (!pm.getActiveProfile()) {
    throw new NoActiveProfileError();
  }
}

/**
 * Returns the public bits of the active profile (no JWTs, no password).
 * Throws NoActiveProfileError if there is no active profile — call
 * ensureActiveProfile() first.
 */
export function getActiveProfileSummary(): ActiveProfileSummary {
  let pm = getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    throw new NoActiveProfileError();
  }
  return {
    matrixId: active.id,
    username: getUsernameFromMatrixId(active.id),
    matrixUrl: active.profile.matrixUrl,
    realmServerUrl: active.profile.realmServerUrl,
  };
}
