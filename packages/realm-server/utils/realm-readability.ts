import type { DBAdapter } from '@cardstack/runtime-common';
import {
  ensureTrailingSlash,
  fetchRealmPermissions,
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
    "SELECT url FROM realm_registry WHERE kind = 'published' AND url IN (",
    ...separatedByCommas(realmList.map((realmURL) => [param(realmURL)])),
    ')',
  ] as Expression)) as { url: string }[];

  return new Set(publishedRealms.map((row) => ensureTrailingSlash(row.url)));
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

// The identity a realm resolves its cards' links under: its human owner. A
// realm assumes that user for every fetch it makes on a card's behalf — the
// `included` assembly behind a card GET, the index pass, and the prerender —
// so the owner's read permissions bound which realms a card stored here can
// link to. A realm co-owned by a `@realm/…` bot resolves as the human.
export async function fetchRealmOwnerUserId(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<string | undefined> {
  let permissions = await fetchRealmPermissions(
    dbAdapter,
    new URL(ensureTrailingSlash(realmURL)),
  );
  let owners = Object.entries(permissions)
    .filter(([, actions]) => actions.includes('realm-owner'))
    .map(([userId]) => userId);
  let humanOwners = owners.filter((userId) => !userId.startsWith('@realm/'));
  return (humanOwners.length > 0 ? humanOwners : owners)[0];
}

// The subset of `realmList` whose cards a card in `consumingRealm` can link
// to. A link only resolves when the consuming realm's owner can read the
// realm holding the target, so a chooser that offers anything wider hands the
// author a link its own realm cannot fetch. The consuming realm is always
// included — a realm can always read itself.
export async function fetchLinkableRealms(
  dbAdapter: DBAdapter,
  consumingRealm: string,
  realmList: string[],
): Promise<string[]> {
  let ownerUserId = await fetchRealmOwnerUserId(dbAdapter, consumingRealm);
  // A realm with no `realm-owner` row has no identity to resolve links under
  // at all: its outbound fetch fails while resolving the owner, before any
  // request goes out, so every cross-realm link from it is unfetchable. Only
  // its own cards are linkable.
  let readable = ownerUserId
    ? buildReadableRealms(
        await fetchUserPermissions(dbAdapter, {
          userId: ownerUserId,
          onlyOwnRealms: false,
        }),
        await getPublishedRealmURLs(dbAdapter, realmList),
      )
    : new Set<string>();
  readable.add(ensureTrailingSlash(consumingRealm));
  return realmList.filter((realmURL) => readable.has(realmURL));
}
