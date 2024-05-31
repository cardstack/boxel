import { DBAdapter } from './db';
import { RealmPermissions } from './realm';

async function insertPermission(
  dbAdapter: DBAdapter,
  realmURL: URL,
  username: string,
  read: boolean,
  write: boolean,
) {
  const query = `INSERT INTO realm_user_permissions (realm_url, username, read, write) VALUES ($1, $2, $3, $4);`;
  const values = [realmURL.href, username, read, write];
  return dbAdapter.execute(query, { bind: values });
}

export async function insertPermissions(
  dbAdapter: DBAdapter,
  realmURL: URL,
  permissions: RealmPermissions,
) {
  const insertPromises = Object.entries(permissions).map(
    ([user, userPermissions]) => {
      return insertPermission(
        dbAdapter,
        realmURL,
        user,
        userPermissions.includes('read'),
        userPermissions.includes('write'),
      );
    },
  );

  await Promise.all(insertPromises);
}

export async function permissionsExist(dbAdapter: DBAdapter, realmURL: URL) {
  return (
    await dbAdapter.execute(
      `SELECT EXISTS(SELECT 1 FROM realm_user_permissions WHERE realm_url = $1) AS has_rows`,
      { bind: [realmURL.href] },
    )
  )[0].has_rows;
}

export async function fetchUserPermissions(
  dbAdapter: DBAdapter,
  realmURL: URL,
) {
  let permissions = await dbAdapter.execute(
    `SELECT username, read, write FROM realm_user_permissions WHERE realm_url = $1;`,
    { bind: [realmURL.href] },
  );

  return permissions.reduce((permissionsAcc, { username, read, write }) => {
    const userPermissions: ('read' | 'write')[] = [];
    if (read) userPermissions.push('read');
    if (write) userPermissions.push('write');
    permissionsAcc[username as string] = userPermissions;
    return permissionsAcc;
  }, {}) as RealmPermissions;
}
