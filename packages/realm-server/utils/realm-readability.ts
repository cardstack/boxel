import type { DBAdapter } from '@cardstack/runtime-common';
import {
  ensureTrailingSlash,
  fetchUserPermissions,
  param,
  query,
  separatedByCommas,
  type Expression,
} from '@cardstack/runtime-common';

export async function getPublishedRealmURLs(
  dbAdapter: DBAdapter,
  realmList: string[],
): Promise<Set<string>> {
  if (realmList.length === 0) {
    return new Set();
  }

  let publishedRealms = (await query(dbAdapter, [
    'SELECT published_realm_url FROM published_realms WHERE published_realm_url IN (',
    ...separatedByCommas(realmList.map((realmURL) => [param(realmURL)])),
    ')',
  ] as Expression)) as { published_realm_url: string }[];

  return new Set(
    publishedRealms.map((row) => ensureTrailingSlash(row.published_realm_url)),
  );
}

export function buildReadableRealms(
  permissionsByRealm: Record<string, string[]>,
  publishedRealmURLs: Set<string>,
): Set<string> {
  let readableRealms = new Set(
    Object.entries(permissionsByRealm)
      .filter(([, permissions]) => permissions.includes('read'))
      .map(([realmURL]) => ensureTrailingSlash(realmURL)),
  );
  for (let realmURL of publishedRealmURLs) {
    readableRealms.add(realmURL);
  }
  return readableRealms;
}

export async function getPublicReadableRealms(
  dbAdapter: DBAdapter,
  realmList: string[],
): Promise<Set<string>> {
  let publicPermissions = await fetchUserPermissions(dbAdapter, {
    userId: '*',
    onlyOwnRealms: false,
  });

  let publishedRealmURLs = await getPublishedRealmURLs(dbAdapter, realmList);
  let publicReadable = buildReadableRealms(
    publicPermissions,
    publishedRealmURLs,
  );

  let normalizedRealmList = realmList.map((realmURL) =>
    ensureTrailingSlash(realmURL),
  );
  return new Set(
    normalizedRealmList.filter((realmURL) => publicReadable.has(realmURL)),
  );
}
