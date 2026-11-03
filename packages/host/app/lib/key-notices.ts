import type RealmServerService from '../services/realm-server';

// How many of the notices the realm server keeps for the user, as the owner of
// their keys, they haven't seen yet. The notices are shown, and marked read,
// on the secure origin's key page. The app reads only the count, `meta.unread`
// on the listing it asks for under the user's own realm-server session.
export async function unreadKeyNoticeCount(
  realmServer: RealmServerService,
): Promise<number> {
  let response = await realmServer.authedFetch(
    new URL('_key-policy-notices', realmServer.url).href,
    { headers: { Accept: 'application/vnd.api+json' } },
  );
  if (!response.ok) {
    throw new Error(
      `the realm server answered ${response.status} for the key notices`,
    );
  }
  let body = (await response.json()) as { meta?: { unread?: unknown } };
  let unread = body.meta?.unread;
  return typeof unread === 'number' && unread > 0 ? unread : 0;
}
