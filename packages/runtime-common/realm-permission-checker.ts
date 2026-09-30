import type { MatrixClient } from './matrix-client.ts';
import type { RealmPermissions, RealmAction } from './index.ts';

/**
 * The permission set a realm enforces for one user: the union of the realm's
 * `users` row (any registered matrix user), its `*` row (everyone, matrix
 * account or not) and the user's own row.
 *
 * `Realm#checkPermission` compares a normal session token's `permissions` claim
 * against exactly this union and rejects any difference as a
 * `PermissionMismatch`, so anything that mints such a token has to mint the same
 * union rather than the bare per-username row. The three cases that bypass the
 * comparison entirely — the realm's own matrix user, an `X-Boxel-Assume-User`
 * indirection, and a delegated read-only token — are not modelled here.
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

/**
 * The matrix user a realm's shared artifacts are made as: the one its
 * permissions name `realm-owner`. When both a person and the realm's own
 * `@realm/` bot hold the grant, the person is the owner. Undefined when no
 * matrix user holds it — a `*` or bare-username owner row names no one a
 * session can be minted for.
 */
export function realmOwnerUserId(
  realmPermissions: RealmPermissions,
): string | undefined {
  let userIds = Object.entries(realmPermissions)
    .filter(([_, realmActions]) => realmActions.includes('realm-owner'))
    .map(([userId]) => userId);
  if (userIds.length > 1) {
    userIds = userIds.filter((userId) => !userId.startsWith('@realm/'));
  }
  let [userId] = userIds;
  return userId?.startsWith('@') ? userId : undefined;
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
