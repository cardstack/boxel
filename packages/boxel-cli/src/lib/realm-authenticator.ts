/**
 * Narrow interface over whatever strategy provides authenticated fetch to a
 * realm. Both `ProfileManager` (Matrix login + per-realm JWT) and
 * `SeedAuthenticator` (mint a JWT directly from a shared secret seed) satisfy
 * this interface, so `RealmSyncBase` can accept either.
 */
export interface RealmAuthenticator {
  authedRealmFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response>;
}
