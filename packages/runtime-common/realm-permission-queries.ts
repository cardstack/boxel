import { DBAdapter } from './db';
import { RealmPermissions } from './realm';

export async function insertPermissions(
  dbAdapter: DBAdapter,
  realmURL: URL,
  permissions: RealmPermissions,
) {
  return dbAdapter.execute(
    `INSERT INTO realm_user_permissions (realm_url, username, read, write) VALUES ${Object.entries(
      permissions,
    )
      .map(
        ([user, userPermissions]) =>
          `('${realmURL}', '${user}', ${userPermissions.includes(
            'read',
          )}, ${userPermissions.includes('write')})`,
      )
      .join(', ')};`,
  );
}

export async function permissionsExist(dbAdapter: DBAdapter, realmURL: URL) {
  return (
    await dbAdapter.execute(
      `SELECT EXISTS(SELECT 1 FROM realm_user_permissions WHERE realm_url = '${realmURL.href}') AS has_rows`,
    )
  )[0].has_rows;
}

export async function fetchUserPermissions(
  dbAdapter: DBAdapter,
  realmURL: URL,
) {
  let permissions = await dbAdapter.execute(
    `SELECT username, read, write FROM realm_user_permissions WHERE realm_url = '${realmURL.href}';`,
  );

  return permissions.reduce((permissionsAcc, { username, read, write }) => {
    const userPermissions: ('read' | 'write')[] = [];
    if (read) userPermissions.push('read');
    if (write) userPermissions.push('write');
    permissionsAcc[username as string] = userPermissions;
    return permissionsAcc;
  }, {}) as RealmPermissions;
}
