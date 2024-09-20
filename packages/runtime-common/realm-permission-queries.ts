import { DBAdapter } from './db';
import { RealmPermissions } from './realm';
import { query, asExpressions, param, upsert } from './expression';

async function insertPermission(
  dbAdapter: DBAdapter,
  realmURL: URL,
  username: string,
  permissions: {
    read?: boolean;
    write?: boolean;
    realmOwner?: boolean;
  },
) {
  let { read, write, realmOwner: realm_owner } = permissions;
  read = !!read;
  write = !!write;
  realm_owner = !!realm_owner;
  let { valueExpressions, nameExpressions } = asExpressions({
    realm_url: realmURL.href,
    username,
    read,
    write,
    realm_owner,
  });

  await query(
    dbAdapter,
    upsert(
      'realm_user_permissions',
      'realm_user_permissions_pkey',
      nameExpressions,
      valueExpressions,
    ),
  );
}

export async function insertPermissions(
  dbAdapter: DBAdapter,
  realmURL: URL,
  permissions: RealmPermissions,
) {
  let insertPromises = Object.entries(permissions).map(
    ([user, userPermissions]) => {
      return insertPermission(dbAdapter, realmURL, user, {
        read: userPermissions.includes('read'),
        write: userPermissions.includes('write'),
        realmOwner: userPermissions.includes('realm-owner'),
      });
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
): Promise<RealmPermissions> {
  let permissions = (await query(dbAdapter, [
    `SELECT username, read, write, realm_owner FROM realm_user_permissions WHERE realm_url =`,
    param(realmURL.href),
  ])) as {
    username: string;
    read: boolean;
    write: boolean;
    realm_owner: boolean;
  }[];

  return permissions.reduce(
    (permissionsAcc, { username, read, write, realm_owner }) => {
      let userPermissions: RealmPermissions['user'] = [];
      if (read) {
        userPermissions.push('read');
      }
      if (write) {
        userPermissions.push('write');
      }
      if (realm_owner) {
        userPermissions.push('realm-owner');
      }
      permissionsAcc[username as string] = userPermissions;
      return permissionsAcc;
    },
    {} as RealmPermissions,
  );
}

export async function fetchPublicRealms(dbAdapter: DBAdapter) {
  let results = (await query(dbAdapter, [
    `SELECT realm_url FROM realm_user_permissions WHERE username = '*' AND read = true`
  ])) as {
    realm_url: string;
  }[];

  return results;
}