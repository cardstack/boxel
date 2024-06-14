import { DBAdapter } from './db';
import { RealmPermissions } from './realm';
import {
  query,
  separatedByCommas,
  Expression,
  asExpressions,
  param,
} from './expression';

async function insertPermission(
  dbAdapter: DBAdapter,
  realmURL: URL,
  username: string,
  read: boolean,
  write: boolean,
) {
  let { valueExpressions } = asExpressions({
    realm_url: realmURL.href,
    username,
    read,
    write,
  });

  return query(dbAdapter, [
    'INSERT INTO realm_user_permissions (realm_url, username, read, write) VALUES (',
    ...separatedByCommas(valueExpressions),
    ')',
  ] as Expression);
}

export async function insertPermissions(
  dbAdapter: DBAdapter,
  realmURL: URL,
  permissions: RealmPermissions,
) {
  let insertPromises = Object.entries(permissions).map(
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
    await query(dbAdapter, [
      `SELECT EXISTS(SELECT 1 FROM realm_user_permissions WHERE realm_url =`,
      param(realmURL.href),
      `) as has_rows`,
    ])
  )[0].has_rows;
}

export async function fetchUserPermissions(
  dbAdapter: DBAdapter,
  realmURL: URL,
) {
  let permissions = await query(dbAdapter, [
    `SELECT username, read, write FROM realm_user_permissions WHERE realm_url =`,
    param(realmURL.href),
  ]);

  return permissions.reduce((permissionsAcc, { username, read, write }) => {
    let userPermissions: ('read' | 'write')[] = [];
    if (read) userPermissions.push('read');
    if (write) userPermissions.push('write');
    permissionsAcc[username as string] = userPermissions;
    return permissionsAcc;
  }, {}) as RealmPermissions;
}
