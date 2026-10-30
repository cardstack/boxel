import type { DBAdapter } from './db.ts';
import { userExists } from './db-queries/user-queries.ts';
import { isUserOfMatrixServer } from './matrix-server-name.ts';
import type { RealmPermissions, RealmAction } from './index.ts';

/**
 * The permission set a realm enforces for one user: the union of the realm's
 * `users` row (any user of the paired homeserver with a Boxel account), its
 * `*` row (everyone, account or not) and the user's own row.
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
 * granted access by their own row or by a policy rule. `hasAccount` answers
 * whether the user holds a Boxel account, which is the other gate on the row.
 * It is consulted only when the realm carries such a row and the user is on
 * the paired homeserver, so a realm without one costs no lookup.
 */
export async function effectiveRealmPermissions(
  realmPermissions: RealmPermissions,
  username: string,
  matrixServerName: string,
  hasAccount: () => Promise<boolean>,
): Promise<RealmAction[]> {
  let includeUsersRow =
    realmPermissions['users'] &&
    isUserOfMatrixServer(username, matrixServerName)
      ? await hasAccount()
      : false;
  return Array.from(
    new Set([
      ...(includeUsersRow ? realmPermissions['users'] || [] : []),
      ...(realmPermissions['*'] || []),
      ...(realmPermissions[username] || []),
    ]),
  );
}

// Whether `username` holds a Boxel account on this realm server: a row in its
// `users` table. The realm server writes one when a person first signs in
// through it, after their OpenID token is verified with their homeserver, and
// `Realm#ensureSessionRoom` refuses a per-realm session to anyone without one.
// The table is the realm server's own, so the question is answered the same
// in every process that reaches the database, and never asks the homeserver,
// which answers a profile request only to a user who shares a room with the
// subject (ADR 011 §1.6).
export function accountCheck(
  dbAdapter: DBAdapter,
  username: string,
): () => Promise<boolean> {
  return async () => await userExists(dbAdapter, username);
}

export default class RealmPermissionChecker {
  private realmPermissions: RealmPermissions = {};
  private dbAdapter: DBAdapter;
  private matrixServerName: string;

  constructor(
    realmPermissions: RealmPermissions,
    dbAdapter: DBAdapter,
    matrixServerName: string,
  ) {
    this.realmPermissions = realmPermissions;
    this.dbAdapter = dbAdapter;
    this.matrixServerName = matrixServerName;
  }

  async for(username: string) {
    return await effectiveRealmPermissions(
      this.realmPermissions,
      username,
      this.matrixServerName,
      accountCheck(this.dbAdapter, username),
    );
  }

  async can(username: string, action: RealmAction) {
    let userPermissions = await this.for(username);
    return userPermissions.includes(action);
  }
}
