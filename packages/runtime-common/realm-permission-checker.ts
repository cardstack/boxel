import type { MatrixClient } from './matrix-client.ts';
import { isUserOfMatrixServer } from './matrix-server-name.ts';
import type { RealmPermissions, RealmAction } from './index.ts';

/**
 * The permission set a realm enforces for one user: the union of the realm's
 * `users` row (any registered user of the paired homeserver), its `*` row
 * (everyone, matrix account or not) and the user's own row.
 *
 * `Realm#checkPermission` compares a normal session token's `permissions` claim
 * against exactly this union and rejects any difference as a
 * `PermissionMismatch`, so anything that mints such a token has to mint the same
 * union rather than the bare per-username row. The three cases that bypass the
 * comparison entirely — the realm's own matrix user, an `X-Boxel-Assume-User`
 * indirection, and a delegated read-only token — are not modelled here.
 *
 * The `users` row grants only to users of the paired homeserver, the server
 * named `matrixServerName` (ADR 004 §1.4): a user of another server is
 * granted access by their own row or by a policy rule. `matrixUserExists`
 * answers whether the matrix account exists, which is the other gate on the
 * row. It is consulted only when the realm carries such a row and the user
 * is on the paired homeserver, so a realm without one costs no homeserver
 * round trip, and the homeserver is never asked about another server's user.
 */
export async function effectiveRealmPermissions(
  realmPermissions: RealmPermissions,
  username: string,
  matrixServerName: string,
  matrixUserExists: () => Promise<boolean>,
): Promise<RealmAction[]> {
  let includeUsersRow =
    realmPermissions['users'] &&
    isUserOfMatrixServer(username, matrixServerName)
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
      this.matrixClient.serverName,
      async () => !!(await this.matrixClient.getProfile(username)),
    );
  }

  async can(username: string, action: RealmAction) {
    let userPermissions = await this.for(username);
    return userPermissions.includes(action);
  }
}
