import type { MatrixClient } from './matrix-client.ts';
import type { RealmPermissions, RealmAction } from './index.ts';

/**
 * The permission set a realm enforces for one user: the union of the realm's
 * `users` row (any registered matrix user), its `*` row (everyone, matrix
 * account or not) and the user's own row.
 *
 * `Realm#assertPermissions` compares a session token's `permissions` claim
 * against exactly this union and rejects any difference as a
 * `PermissionMismatch`, so anything that mints a token has to mint the same
 * union rather than the bare per-username row.
 *
 * `matrixUserExists` answers whether the matrix account exists, which is what
 * gates the `users` row. It is consulted only when the realm carries such a
 * row, so realms without one cost no homeserver round trip.
 */
export async function effectiveRealmPermissions(
  realmPermissions: RealmPermissions,
  username: string,
  matrixUserExists: () => Promise<boolean>,
): Promise<RealmAction[]> {
  let includeUsersRow = realmPermissions['users']
    ? await matrixUserExists()
    : false;
  return Array.from(
    new Set([
      ...(includeUsersRow ? realmPermissions['users'] || [] : []),
      ...(realmPermissions['*'] || []),
      ...(realmPermissions[username] || []),
    ]),
  );
}

export default class RealmPermissionChecker {
  private realmPermissions: RealmPermissions = {};
  private matrixClient: MatrixClient;

  constructor(realmPermissions: RealmPermissions, matrixClient: MatrixClient) {
    this.realmPermissions = realmPermissions;
    this.matrixClient = matrixClient;
  }

  async for(username: string) {
    return await effectiveRealmPermissions(
      this.realmPermissions,
      username,
      async () => !!(await this.matrixClient.getProfile(username)),
    );
  }

  async can(username: string, action: RealmAction) {
    let userPermissions = await this.for(username);
    return userPermissions.includes(action);
  }
}
