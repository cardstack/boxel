import type RealmServerService from '../services/realm-server';

// The notices the realm server keeps for the user about their keys: policy
// notices, for a workspace's policy that opened one of their shares to people
// who aren't signed in, and limit notices, for a share's or key's use reaching
// its high-water mark or budget.
const NOTICE_LISTINGS = ['_key-policy-notices', '_key-limit-notices'];

// How many of those notices the user hasn't seen yet. The notices are shown,
// and marked read, on the secure origin's key page. The app reads only the
// count, `meta.unread` on each listing it asks for under the user's own
// realm-server session.
export async function unreadKeyNoticeCount(
  realmServer: RealmServerService,
): Promise<number> {
  let counts = await Promise.all(
    NOTICE_LISTINGS.map((listing) => unreadIn(realmServer, listing)),
  );
  return counts.reduce((total, count) => total + count, 0);
}

async function unreadIn(
  realmServer: RealmServerService,
  listing: string,
): Promise<number> {
  let response = await realmServer.authedFetch(
    new URL(listing, realmServer.url).href,
    { headers: { Accept: 'application/vnd.api+json' } },
  );
  if (!response.ok) {
    throw new Error(
      `the realm server answered ${response.status} for ${listing}`,
    );
  }
  let body = (await response.json()) as { meta?: { unread?: unknown } };
  let unread = body.meta?.unread;
  return typeof unread === 'number' && unread > 0 ? unread : 0;
}
