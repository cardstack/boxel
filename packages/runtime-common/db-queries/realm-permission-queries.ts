import { DBAdapter } from '../db';
import { RealmAction, type RealmPermissions } from '../index';
import { query, asExpressions, param, upsert } from '../expression';
import { getMatrixUsername } from '../matrix-client';

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

async function removePermissions(
  dbAdapter: DBAdapter,
  realmURL: URL,
  username: string,
) {
  await query(dbAdapter, [
    'DELETE from realm_user_permissions WHERE username =',
    param(username),
    'and realm_url =',
    param(realmURL.href),
  ]);
}

export async function removeRealmPermissions(
  dbAdapter: DBAdapter,
  realmURL: URL,
) {
  await query(dbAdapter, [
    'DELETE from realm_user_permissions WHERE realm_url =',
    param(realmURL.href),
  ]);
}

export async function insertPermissions(
  dbAdapter: DBAdapter,
  realmURL: URL,
  permissions: RealmPermissions,
) {
  let insertPromises = Object.entries(permissions).map(
    ([user, userPermissions]) => {
      if (userPermissions == null || userPermissions.length === 0) {
        return removePermissions(dbAdapter, realmURL, user);
      }

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

export async function fetchRealmPermissions(
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
export async function fetchUserPermissions(
  dbAdapter: DBAdapter,
  args: {
    userId: string;
    onlyOwnRealms?: boolean;
  },
): Promise<{
  [realm: string]: RealmAction[];
}> {
  const { userId, onlyOwnRealms = false } = args;
  let permissions: {
    realm_url: string;
    read: boolean;
    write: boolean;
    realm_owner: boolean;
  }[];

  if (onlyOwnRealms) {
    // Only get realms where user is owner
    permissions = (await query(dbAdapter, [
      `SELECT realm_url, read, write, realm_owner FROM realm_user_permissions WHERE username =`,
      param(userId),
      `AND realm_owner = true`,
    ])) as {
      realm_url: string;
      read: boolean;
      write: boolean;
      realm_owner: boolean;
    }[];
  } else {
    // Get all user permissions (owned + read access) and public realms in one query
    // Use UNION to deduplicate, prioritizing user permissions over public permissions
    permissions = (await query(dbAdapter, [
      `SELECT realm_url, read, write, realm_owner FROM realm_user_permissions WHERE username =`,
      param(userId),
      `UNION
       SELECT realm_url, true as read, false as write, false as realm_owner FROM realm_user_permissions WHERE username = '*' AND read = true
       AND realm_url NOT IN (SELECT realm_url FROM realm_user_permissions WHERE username =`,
      param(userId),
      `)`,
    ])) as {
      realm_url: string;
      read: boolean;
      write: boolean;
      realm_owner: boolean;
    }[];
  }

  return permissions.reduce(
    (permissionsAcc, { realm_url, read, write, realm_owner }) => {
      let userPermissions: RealmAction[] = [];
      if (read) {
        userPermissions.push('read');
      }
      if (write) {
        userPermissions.push('write');
      }
      if (realm_owner) {
        userPermissions.push('realm-owner');
      }
      permissionsAcc[realm_url as string] = userPermissions;
      return permissionsAcc;
    },
    {} as { [realm: string]: RealmAction[] },
  );
}

export async function fetchCatalogRealms(dbAdapter: DBAdapter) {
  let results = (await query(dbAdapter, [
    `SELECT rup.realm_url
     FROM realm_user_permissions rup
     LEFT JOIN published_realms pr ON rup.realm_url = pr.published_realm_url
     WHERE rup.username = '*' AND rup.read = true AND pr.published_realm_url IS NULL`,
  ])) as {
    realm_url: string;
  }[];

  return results;
}

export async function fetchAllRealmsWithOwners(
  dbAdapter: DBAdapter,
): Promise<{ realm_url: string; owner_username: string }[]> {
  // Get all realms with their owners
  const allOwners = (await query(dbAdapter, [
    `SELECT
      realm_url,
      username,
      realm_owner
    FROM realm_user_permissions
    WHERE realm_owner = true`,
  ])) as { realm_url: string; username: string; realm_owner: boolean }[];

  // Group by realm to handle multiple owners case
  const realmOwners = new Map<string, string[]>();
  for (const row of allOwners) {
    if (!realmOwners.has(row.realm_url)) {
      realmOwners.set(row.realm_url, []);
    }
    realmOwners.get(row.realm_url)!.push(row.username);
  }

  // Process each realm to get the final owner
  const results: { realm_url: string; owner_username: string }[] = [];
  for (const [realmUrl, owners] of realmOwners) {
    let finalOwner = owners[0];

    // If multiple owners, prefer non-bot owner
    if (owners.length > 1) {
      const nonBotOwner = owners.find((owner) => !owner.startsWith('@realm/'));
      if (nonBotOwner) {
        finalOwner = nonBotOwner;
      }
    }

    const ownerUsername = getMatrixUsername(finalOwner);

    results.push({
      realm_url: realmUrl,
      owner_username: ownerUsername,
    });
  }

  return results;
}
