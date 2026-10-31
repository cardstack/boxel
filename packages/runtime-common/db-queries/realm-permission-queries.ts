import type { DBAdapter } from '../db.ts';
import type { RealmAction } from '../index.ts';
import type { RealmPermissions } from '../index.ts';
import {
  asExpressions,
  dbAdapterQuerier,
  param,
  query,
  type Expression,
  type Querier,
  upsert,
} from '../expression.ts';
import { aiBotUsername, submissionBotUsername } from '../constants.ts';
import { getMatrixUsername } from '../matrix-client.ts';
import { isUserOfMatrixServer } from '../matrix-server-name.ts';
import {
  accountCheck,
  effectiveRealmPermissions,
} from '../realm-permission-checker.ts';

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
  querier?: Querier,
) {
  let q = querier ?? dbAdapterQuerier(dbAdapter);
  await q([
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

/**
 * One user's effective permissions in one realm — what `Realm#checkPermission`
 * will compute for them, so this is the set to mint a session token from.
 *
 * Needs only the database and the paired homeserver's server name, so it
 * serves worker tasks, which run in a child process that holds no matrix
 * client. A `users` grant is resolved against the realm server's `users`
 * table (`accountCheck`), and only when the realm carries one and the user
 * is on the paired homeserver (ADR 004 §1.4).
 */
export async function fetchEffectiveRealmPermissions(
  dbAdapter: DBAdapter,
  realmURL: URL,
  username: string,
  matrixServerName: string,
): Promise<RealmAction[]> {
  let realmPermissions = await fetchRealmPermissions(dbAdapter, realmURL);
  return await effectiveRealmPermissions(
    realmPermissions,
    username,
    matrixServerName,
    accountCheck(dbAdapter, username),
  );
}

// The permission rows that grant to many accounts at once: `*` (everyone,
// Boxel account or not) and `users` (any user of the paired homeserver with a
// Boxel account).
const wildcardUsernames = new Set(['*', 'users']);

// The platform's service accounts, by matrix localpart.
const botLocalparts = new Set([aiBotUsername, submissionBotUsername]);

// A realm's own matrix user is `@realm/…` for a published realm and
// `@<name>_realm` for a bootstrap realm; the shared accounts that sync content
// into bootstrap realms are `@<name>_writer`. Matching the naming convention,
// rather than listing the accounts, keeps a newly added bootstrap realm from
// counting as a person. Registration doesn't reserve the suffixes, so a person
// who picks one is treated as a bot, which only ever withholds something.
const botLocalpartSuffixes = ['_realm', '_writer'];

// The localpart of `userId` when it is the full Matrix id of an account on
// `matrixServerName`. Undefined for an account on any other server, and for
// text that is no Matrix id, such as a wildcard row's `*` or `users`. Every
// service account the platform runs lives on the realm server's paired
// homeserver (ADR 004 §1.1), so an account elsewhere is never one of them,
// whatever it is called (ADR 004 §1.2).
function localpartOn(
  userId: string,
  matrixServerName: string,
): string | undefined {
  return isUserOfMatrixServer(userId, matrixServerName)
    ? getMatrixUsername(userId)
    : undefined;
}

// Whether `userId` is the account a published realm is registered under:
// `@realm/<directory>_<id>` on the paired homeserver.
export function isPublishedRealmAccount(
  userId: string,
  matrixServerName: string,
): boolean {
  return localpartOn(userId, matrixServerName)?.startsWith('realm/') ?? false;
}

// Whether `userId` is one of the platform's service accounts: an account on
// the paired homeserver named by one of the conventions above.
export function isBotAccount(
  userId: string,
  matrixServerName: string,
): boolean {
  let localpart = localpartOn(userId, matrixServerName);
  if (localpart === undefined) {
    return false;
  }
  return (
    localpart.startsWith('realm/') ||
    botLocalparts.has(localpart) ||
    botLocalpartSuffixes.some((suffix) => localpart.endsWith(suffix))
  );
}

function isDirectWriterRow(
  username: string,
  write: boolean,
  matrixServerName: string,
): boolean {
  return (
    write &&
    !wildcardUsernames.has(username) &&
    !isBotAccount(username, matrixServerName)
  );
}

/**
 * Whether `userId` is a direct writer of the realm: a person whose own
 * permission row grants `write`. It is the narrower question asked before a
 * realm takes something on in a person's name, such as a shared key or a
 * scheduled pipeline they pay for, so it answers for that person alone. A
 * `*` or `users` row grants write to everyone it matches without naming
 * anyone, a bot account acts for the platform rather than a person, and a
 * policy grant admits a write without making its caller a writer of the
 * realm, so none of them counts. `matrixServerName` names the paired
 * homeserver, the only server a bot account can be on.
 *
 * Read fresh on each call, like every permission check, so a removed row
 * stops counting at once.
 */
export async function isDirectWriter(
  dbAdapter: DBAdapter,
  realmURL: URL,
  userId: string,
  matrixServerName: string,
): Promise<boolean> {
  let [row] = (await query(dbAdapter, [
    `SELECT write FROM realm_user_permissions WHERE realm_url =`,
    param(realmURL.href),
    `AND username =`,
    param(userId),
  ])) as { write: boolean }[];
  return !!row && isDirectWriterRow(userId, row.write, matrixServerName);
}

/**
 * `isDirectWriter`, asked inside the caller's transaction with the person's
 * permission row locked until it ends. Anything that takes something on in a
 * person's name on the strength of the answer asks it this way, so a change
 * to that row made meanwhile waits for the caller's work to commit and then
 * sees it.
 */
export async function isDirectWriterLocked(
  txQuerier: Querier,
  realmURL: URL,
  userId: string,
  matrixServerName: string,
): Promise<boolean> {
  let [row] = (await txQuerier([
    `SELECT write FROM realm_user_permissions WHERE realm_url =`,
    param(realmURL.href),
    `AND username =`,
    param(userId),
    `FOR SHARE`,
  ])) as { write: boolean }[];
  return !!row && isDirectWriterRow(userId, row.write, matrixServerName);
}

/**
 * The realm's direct writers, as `isDirectWriter` answers it, in username
 * order.
 */
export async function fetchDirectWriters(
  dbAdapter: DBAdapter,
  realmURL: URL,
  matrixServerName: string,
): Promise<string[]> {
  let rows = (await query(dbAdapter, [
    `SELECT username, write FROM realm_user_permissions WHERE write = true AND realm_url =`,
    param(realmURL.href),
    `ORDER BY username`,
  ])) as { username: string; write: boolean }[];
  return rows
    .filter(({ username, write }) =>
      isDirectWriterRow(username, write, matrixServerName),
    )
    .map(({ username }) => username);
}

export interface DirectWriterRealm {
  url: string;
  // From the realm's indexed `realm.json`; null until that is indexed.
  name: string | null;
}

/**
 * The realms `userId` is a direct writer of, as `isDirectWriter` answers it,
 * named from each realm's indexed `realm.json` so that listing them mounts
 * none of them. Archived realms and published snapshots are left out. A
 * permission row is all this reads, so a caller that offers these realms
 * checks that each is still served. In URL order.
 */
export async function fetchDirectWriterRealms(
  dbAdapter: DBAdapter,
  userId: string,
  matrixServerName: string,
): Promise<DirectWriterRealm[]> {
  return (await fetchNamedRealmRows(dbAdapter, userId, 'write'))
    .filter(({ username, write }) =>
      isDirectWriterRow(username, write, matrixServerName),
    )
    .map(({ realm_url, name }) => ({ url: realm_url, name }));
}

/**
 * The realms `userId` can read by a permission row of their own, named and
 * filtered as `fetchDirectWriterRealms` does. A realm readable by everyone
 * (`*`) or by every signed-in user (`users`) isn't one of theirs, so it isn't
 * listed. In URL order.
 */
export async function fetchOwnReadableRealms(
  dbAdapter: DBAdapter,
  userId: string,
): Promise<DirectWriterRealm[]> {
  return (await fetchNamedRealmRows(dbAdapter, userId, 'read')).map(
    ({ realm_url, name }) => ({ url: realm_url, name }),
  );
}

// The user's own permission rows granting `action`, with each realm's name
// from its indexed `realm.json`, leaving out archived realms and published
// snapshots.
async function fetchNamedRealmRows(
  dbAdapter: DBAdapter,
  userId: string,
  action: 'read' | 'write',
) {
  return (await query(dbAdapter, [
    `SELECT rup.realm_url, rup.username, rup.write,
            config.pristine_doc->'attributes'->'cardInfo'->>'name' AS name
     FROM realm_user_permissions rup
     LEFT JOIN realm_registry rr
       ON rr.url = rup.realm_url AND rr.kind = 'published'
     LEFT JOIN boxel_index config
       ON config.url = rup.realm_url || 'realm.json'
      AND config.realm_url = rup.realm_url
      AND config.type = 'instance'
      AND (config.is_deleted = FALSE OR config.is_deleted IS NULL)
     WHERE rr.url IS NULL AND rup.${action} = true AND rup.username =`,
    param(userId),
    `AND rup.realm_url NOT IN (SELECT url FROM realm_metadata WHERE archived_at IS NOT NULL)
     ORDER BY rup.realm_url`,
  ])) as {
    realm_url: string;
    username: string;
    write: boolean;
    name: string | null;
  }[];
}

export async function fetchUserPermissions(
  dbAdapter: DBAdapter,
  args: {
    userId: string;
    onlyOwnRealms?: boolean;
    // Archived realms are sealed: by default they're omitted from this
    // enumeration so _realm-auth, multi-realm authorization, the indexer
    // sweep, etc. see only active realms. Set true to include them.
    // The archive-management endpoints reach archived realms by URL via
    // fetchRealmPermissions / fetchArchivedRealmsForOwner instead, so
    // they bypass this filter and don't need the opt-in.
    includeArchived?: boolean;
    // Realms readable by everyone (a `'*'` read row) are reachable by every
    // user, so they aren't part of a user's own set: by default only realms
    // the user has a row of their own for are returned. Set true to add the
    // world-readable realms too, as anything that authorizes or renders on
    // the user's behalf needs. Ignored with `onlyOwnRealms`.
    includePublicRealms?: boolean;
  },
): Promise<{
  [realm: string]: RealmAction[];
}> {
  const {
    userId,
    onlyOwnRealms = false,
    includeArchived = false,
    includePublicRealms = false,
  } = args;
  // Rendered inline into each arm below rather than appended once, so the
  // own-rows arm and the public arm filter archived realms the same way.
  const excludeArchivedSql = includeArchived
    ? ''
    : `AND realm_url NOT IN (SELECT url FROM realm_metadata WHERE archived_at IS NOT NULL)`;
  let permissions: {
    realm_url: string;
    read: boolean;
    write: boolean;
    realm_owner: boolean;
  }[];

  // The user's own permission rows — only the ones they own when
  // `onlyOwnRealms` — leaving out published snapshots and, unless asked for,
  // archived realms.
  let ownRows: Expression = [
    `SELECT realm_url, read, write, realm_owner FROM realm_user_permissions WHERE username =`,
    param(userId),
    `${onlyOwnRealms ? 'AND realm_owner = true' : ''}
     AND realm_url NOT IN (SELECT url FROM realm_registry WHERE kind = 'published')
     ${excludeArchivedSql}`,
  ];
  // The world-readable realms the user has no row of their own for. UNION
  // deduplicates, and the NOT IN keeps a user's own row the one that counts.
  let publicRows: Expression =
    includePublicRealms && !onlyOwnRealms
      ? [
          `UNION
           SELECT realm_url, true as read, false as write, false as realm_owner FROM realm_user_permissions WHERE username = '*' AND read = true
           AND realm_url NOT IN (SELECT realm_url FROM realm_user_permissions WHERE username =`,
          param(userId),
          `)
           AND realm_url NOT IN (SELECT url FROM realm_registry WHERE kind = 'published')
           ${excludeArchivedSql}`,
        ]
      : [];
  permissions = (await query(dbAdapter, [...ownRows, ...publicRows])) as {
    realm_url: string;
    read: boolean;
    write: boolean;
    realm_owner: boolean;
  }[];

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

// The active realms whose indexed `realm.json` names a policy card. A realm a
// caller may not read can still answer them through its policy, so a render
// made as that caller carries a session for each of these alongside the realms
// its permissions name (see the capture task). It is read from the index, which
// lags a write to `realm.json` by an index pass. A pointer of only whitespace
// names no policy, as `namesNoRealmPolicy` reads it; a realm whose pointer it
// drops as malformed is listed anyway, and a session there lets its ACL judge
// the render as it would judge the user.
//
// Driven by the realms' permission rows, which every realm has (its owner's),
// so each realm costs one primary-key probe of its `realm.json` row rather
// than a pass over the index. Published realms are left out, as
// `fetchUserPermissions` leaves them out.
export async function fetchRealmsNamingPolicy(
  dbAdapter: DBAdapter,
): Promise<string[]> {
  let rows = (await query(dbAdapter, [
    `SELECT realms.realm_url
     FROM (SELECT DISTINCT realm_url FROM realm_user_permissions) realms
     JOIN boxel_index config
       ON config.url = realms.realm_url || 'realm.json'
      AND config.realm_url = realms.realm_url
      AND config.type = 'instance'
     WHERE (config.is_deleted = FALSE OR config.is_deleted IS NULL)
       AND COALESCE(config.search_doc->>'policy', config.pristine_doc->'attributes'->>'policy', '') ~ '[^[:space:]]'
       AND realms.realm_url NOT IN (SELECT url FROM realm_registry WHERE kind = 'published')
       AND realms.realm_url NOT IN (SELECT url FROM realm_metadata WHERE archived_at IS NOT NULL)`,
  ])) as { realm_url: string }[];
  return rows.map(({ realm_url }) => realm_url);
}

export async function fetchCatalogRealms(dbAdapter: DBAdapter) {
  // Catalog realms are the publicly-readable realms an operator has opted
  // into the catalog (`realm_metadata.show_as_catalog`), leaving out archived
  // realms and published snapshots — published rows live in realm_registry
  // with kind='published'.
  let results = (await query(dbAdapter, [
    `SELECT rup.realm_url
     FROM realm_user_permissions rup
     JOIN realm_metadata rm
       ON rm.url = rup.realm_url
      AND rm.show_as_catalog = true
      AND rm.archived_at IS NULL
     LEFT JOIN realm_registry rr
       ON rup.realm_url = rr.url AND rr.kind = 'published'
     WHERE rup.username = '*' AND rup.read = true AND rr.url IS NULL`,
  ])) as {
    realm_url: string;
  }[];

  return results;
}

export interface PublicRealmSummary {
  url: string;
  name: string | null;
  iconURL: string | null;
  backgroundURL: string | null;
}

// Every active source realm anyone may read, named and pictured from its
// indexed `realm.json` so listing them mounts none of them. A realm whose
// `realm.json` isn't indexed yet comes back with null display fields.
export async function fetchPublicRealmSummaries(
  dbAdapter: DBAdapter,
): Promise<PublicRealmSummary[]> {
  let rows = (await query(dbAdapter, [
    `SELECT rup.realm_url,
            config.pristine_doc->'attributes'->'cardInfo'->>'name' AS name,
            config.pristine_doc->'attributes'->>'iconURL' AS icon_url,
            config.pristine_doc->'attributes'->>'backgroundURL' AS background_url
     FROM realm_user_permissions rup
     JOIN realm_registry rr
       ON rr.url = rup.realm_url AND rr.kind <> 'published'
     LEFT JOIN boxel_index config
       ON config.url = rup.realm_url || 'realm.json'
      AND config.realm_url = rup.realm_url
      AND config.type = 'instance'
      AND (config.is_deleted = FALSE OR config.is_deleted IS NULL)
     WHERE rup.username = '*' AND rup.read = true
       AND rup.realm_url NOT IN (SELECT url FROM realm_metadata WHERE archived_at IS NOT NULL)
     ORDER BY rup.realm_url`,
  ])) as {
    realm_url: string;
    name: string | null;
    icon_url: string | null;
    background_url: string | null;
  }[];
  return rows.map(({ realm_url, name, icon_url, background_url }) => ({
    url: realm_url,
    name,
    iconURL: icon_url,
    backgroundURL: background_url,
  }));
}

/**
 * Every realm with the full Matrix id of the owner it is indexed as: the
 * owner its permissions name, and for a published realm whose permissions
 * name none, its source realm's owner, or failing that the owner its registry
 * row records. `matrixServerName` names the paired homeserver, which the
 * registry row's owner is on.
 */
export async function fetchAllRealmsWithOwners(
  dbAdapter: DBAdapter,
  matrixServerName: string,
): Promise<{ realm_url: string; owner_user_id: string }[]> {
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

  let ownerByRealm = new Map<string, string>();
  for (const [realmUrl, owners] of realmOwners) {
    ownerByRealm.set(realmUrl, preferredOwner(owners, matrixServerName)!);
  }

  // Published realms may not have realm_user_permissions entries in older data.
  // Fall back to the published realm's owner (or source realm owner) when missing.
  const publishedRealms = (await query(dbAdapter, [
    `SELECT url AS published_realm_url, source_url AS source_realm_url, owner_username FROM realm_registry WHERE kind = 'published'`,
  ])) as {
    published_realm_url: string;
    source_realm_url: string;
    owner_username: string;
  }[];

  for (const publishedRealm of publishedRealms) {
    if (ownerByRealm.has(publishedRealm.published_realm_url)) {
      continue;
    }
    const sourceOwner = ownerByRealm.get(publishedRealm.source_realm_url);
    ownerByRealm.set(
      publishedRealm.published_realm_url,
      sourceOwner ??
        registryOwnerUserId(publishedRealm.owner_username, matrixServerName),
    );
  }

  return [...ownerByRealm].map(([realm_url, owner_user_id]) => ({
    realm_url,
    owner_user_id,
  }));
}

// The full Matrix id of the owner the realm at `realmURL` is indexed as, by
// the rule `fetchAllRealmsWithOwners` applies to every realm. Undefined for a
// realm with no owner either way.
export async function fetchRealmOwnerUserId(
  dbAdapter: DBAdapter,
  realmURL: string,
  matrixServerName: string,
): Promise<string | undefined> {
  let owner = await ownerByPermissions(dbAdapter, realmURL, matrixServerName);
  if (owner) {
    return owner;
  }
  let [published] = (await query(dbAdapter, [
    `SELECT source_url, owner_username FROM realm_registry WHERE kind = 'published' AND url =`,
    param(realmURL),
  ])) as { source_url: string | null; owner_username: string | null }[];
  if (!published) {
    return undefined;
  }
  let sourceOwner = published.source_url
    ? await ownerByPermissions(
        dbAdapter,
        published.source_url,
        matrixServerName,
      )
    : undefined;
  if (sourceOwner) {
    return sourceOwner;
  }
  return published.owner_username
    ? registryOwnerUserId(published.owner_username, matrixServerName)
    : undefined;
}

async function ownerByPermissions(
  dbAdapter: DBAdapter,
  realmURL: string,
  matrixServerName: string,
): Promise<string | undefined> {
  let rows = (await query(dbAdapter, [
    `SELECT username FROM realm_user_permissions WHERE realm_owner = true AND realm_url =`,
    param(realmURL),
  ])) as { username: string }[];
  return preferredOwner(
    rows.map(({ username }) => username),
    matrixServerName,
  );
}

// Of the users a realm's permissions name as its owner, the one it is indexed
// as: its human owner, where the realm's own account owns it too.
function preferredOwner(
  owners: string[],
  matrixServerName: string,
): string | undefined {
  if (owners.length > 1) {
    return (
      owners.find(
        (owner) => !isPublishedRealmAccount(owner, matrixServerName),
      ) ?? owners[0]
    );
  }
  return owners[0];
}

// The full Matrix id of the owner a `realm_registry` row records. The column
// holds the owner's localpart (a published realm's row names the realm's own
// `realm/…` account), and every account a realm server registers a realm
// under is on its paired homeserver, so that is the server the id is on. A
// row that already records a full id is read as it is.
function registryOwnerUserId(
  ownerUsername: string,
  matrixServerName: string,
): string {
  if (/^@[^:]+:.+$/.test(ownerUsername)) {
    return ownerUsername;
  }
  return `@${ownerUsername.replace(/^@/, '')}:${matrixServerName}`;
}
