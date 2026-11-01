import type { DBAdapter } from './db.ts';
import { param, query } from './expression.ts';
import type { FeedEvent } from './event-feed.ts';

// Where a realm's event feeds keep their sequences (ADR 020 §1.3). A store
// gives out positions and keeps the recent events, so that every process
// serving the realm shares one sequence per feed and a restart continues it.
// The feed keeps its own copy of the window in memory for reads; the store is
// what makes positions agree across processes.
//
// A feed is named by its key: the realm's URL for the realm's own feed, or
// `channelFeedKey(realm, path)` for the live channel of one card (§1.8).

// The Postgres channel a store announces each append on. Its payload is the
// feed's key; a process that hears it reads what it hasn't seen.
export const REALM_FEED_EVENTS_CHANNEL = 'realm_feed_events';

// The key of a card's live channel: the realm's URL and the card's path in it.
export function channelFeedKey(realmURL: string, path: string): string {
  return `${realmURL}#${path}`;
}

// The realm and, for a channel, the card path a feed key names.
export function parseFeedKey(key: string): { realmURL: string; path?: string } {
  let at = key.indexOf('#');
  return at === -1
    ? { realmURL: key }
    : { realmURL: key.slice(0, at), path: key.slice(at + 1) };
}

export interface LoadedFeed {
  epoch: string;
  head: number;
  // The recent events, in order, with the latest message for each key even
  // when it is older than the rest.
  events: FeedEvent[];
  // The position the events are complete after: a client that last saw an
  // earlier one may have missed something and resets.
  floor: number;
  // The feed was found stored, so this process continues one that ran before:
  // the feed announces a reset, so every client revalidates once (ADR 020 §1.2).
  restarted: boolean;
}

export type RefreshClaim =
  | { accepted: true }
  | { accepted: false; retryAfterMs: number };

export interface FeedStore {
  // The feed's epoch, the last position it gave out and its recent events,
  // creating the feed if it is new.
  load(key: string, keep: number): Promise<LoadedFeed>;
  // Gives each event the next position, in order, and records them.
  append(
    key: string,
    events: Omit<FeedEvent, 'seq'>[],
    keep: number,
  ): Promise<FeedEvent[]>;
  // As `append`, for a feed some process has created; for one nobody has,
  // records nothing and answers undefined. A card's change is mirrored onto
  // its channel this way, so a card nobody follows gets no channel.
  appendIfExists(
    key: string,
    events: Omit<FeedEvent, 'seq'>[],
    keep: number,
  ): Promise<FeedEvent[] | undefined>;
  // The events after `seq`, in order: what another process appended.
  after(key: string, seq: number): Promise<FeedEvent[]>;
  // Records a refresh request unless one was accepted within `cooldownMs`.
  claimRefresh(key: string, cooldownMs: number): Promise<RefreshClaim>;
}

// A message superseded by a later one with the same key carries nothing a
// client needs: the later one replaces it.
export function supersededMessages(events: FeedEvent[]): Set<number> {
  let latest = new Map<string, number>();
  let superseded = new Set<number>();
  for (let event of events) {
    if (event.kind !== 'message' || event.key === undefined) {
      continue;
    }
    let previous = latest.get(event.key);
    if (previous !== undefined) {
      superseded.add(previous);
    }
    latest.set(event.key, event.seq);
  }
  return superseded;
}

// Feeds held in this process alone: a realm the host runs in the browser,
// and tests that run without Postgres.
export class MemoryFeedStore implements FeedStore {
  #feeds = new Map<
    string,
    {
      epoch: string;
      head: number;
      events: FeedEvent[];
      floor: number;
      lastRefresh?: number;
    }
  >();

  #feed(key: string) {
    let feed = this.#feeds.get(key);
    if (!feed) {
      feed = { epoch: randomEpoch(), head: 0, events: [], floor: 0 };
      this.#feeds.set(key, feed);
    }
    return feed;
  }

  async load(key: string, _keep: number): Promise<LoadedFeed> {
    let feed = this.#feed(key);
    return {
      epoch: feed.epoch,
      head: feed.head,
      events: [...feed.events],
      floor: feed.floor,
      restarted: false,
    };
  }

  async append(
    key: string,
    events: Omit<FeedEvent, 'seq'>[],
    keep: number,
  ): Promise<FeedEvent[]> {
    let feed = this.#feed(key);
    let appended = events.map(
      (event) => ({ ...event, seq: ++feed.head }) as FeedEvent,
    );
    feed.events.push(...appended);
    let kept = trimWindow(feed.events, keep * 4);
    feed.events = kept.events;
    feed.floor = Math.max(feed.floor, kept.floor);
    return appended;
  }

  async appendIfExists(
    key: string,
    events: Omit<FeedEvent, 'seq'>[],
    keep: number,
  ): Promise<FeedEvent[] | undefined> {
    return this.#feeds.has(key) ? this.append(key, events, keep) : undefined;
  }

  async after(key: string, seq: number): Promise<FeedEvent[]> {
    return this.#feed(key).events.filter((event) => event.seq > seq);
  }

  async claimRefresh(key: string, cooldownMs: number): Promise<RefreshClaim> {
    let feed = this.#feed(key);
    let now = Date.now();
    if (feed.lastRefresh !== undefined) {
      let wait = feed.lastRefresh + cooldownMs - now;
      if (wait > 0) {
        return { accepted: false, retryAfterMs: wait };
      }
    }
    feed.lastRefresh = now;
    return { accepted: true };
  }
}

// Keeps at most `limit` events, dropping the oldest first but the latest
// message for each key last, and says the position the kept events are
// complete after: the newest event it dropped that a client would have needed.
export function trimWindow(
  events: FeedEvent[],
  limit: number,
): { events: FeedEvent[]; floor: number } {
  if (events.length <= limit) {
    return { events, floor: 0 };
  }
  let superseded = supersededMessages(events);
  let latestOfKey = (event: FeedEvent) =>
    event.kind === 'message' &&
    event.key !== undefined &&
    !superseded.has(event.seq);
  let excess = events.length - limit;
  let floor = 0;
  let kept: FeedEvent[] = [];
  for (let event of events) {
    if (excess > 0 && !latestOfKey(event)) {
      excess--;
      if (!superseded.has(event.seq)) {
        floor = Math.max(floor, event.seq);
      }
      continue;
    }
    kept.push(event);
  }
  // More keys than the window holds: the oldest latest-messages go too.
  while (kept.length > limit) {
    floor = Math.max(floor, kept.shift()!.seq);
  }
  return { events: kept, floor };
}

// Feeds kept in Postgres and shared by every process serving the realm.
// Positions come from one row per feed, incremented under its row lock, so
// two processes appending at once get consecutive positions in commit order.
// Each append notifies `REALM_FEED_EVENTS_CHANNEL` inside its transaction, so
// the notification arrives only once the events can be read.
export class DbFeedStore implements FeedStore {
  #dbAdapter: DBAdapter;

  constructor(dbAdapter: DBAdapter) {
    this.#dbAdapter = dbAdapter;
  }

  async load(key: string, keep: number): Promise<LoadedFeed> {
    let created = await query(this.#dbAdapter, [
      'INSERT INTO realm_feeds (feed_key, epoch, head) VALUES (',
      param(key),
      ',',
      param(randomEpoch()),
      ', 0) ON CONFLICT (feed_key) DO NOTHING RETURNING epoch',
    ]);
    let [row] = await query(this.#dbAdapter, [
      'SELECT epoch, head FROM realm_feeds WHERE feed_key =',
      param(key),
    ]);
    let head = Number(row?.head ?? 0);
    let floor = Math.max(0, head - keep);
    // The recent events, and before them the latest message for each key.
    let rows = await query(this.#dbAdapter, [
      'SELECT event FROM realm_feed_events e WHERE feed_key =',
      param(key),
      'AND (seq >',
      param(floor),
      "OR (event->>'kind' = 'message' AND event->>'key' IS NOT NULL AND seq = (",
      'SELECT max(seq) FROM realm_feed_events l WHERE l.feed_key = e.feed_key',
      "AND l.event->>'key' = e.event->>'key'))) ORDER BY seq",
    ]);
    return {
      epoch: String(row?.epoch),
      head,
      events: rows.map((r) => eventOf(r.event)),
      floor,
      restarted: created.length === 0,
    };
  }

  async append(
    key: string,
    events: Omit<FeedEvent, 'seq'>[],
    keep: number,
  ): Promise<FeedEvent[]> {
    let appended = await this.appendIfExists(key, events, keep);
    if (!appended) {
      throw new Error(`no event feed is stored for ${key}`);
    }
    return appended;
  }

  async appendIfExists(
    key: string,
    events: Omit<FeedEvent, 'seq'>[],
    keep: number,
  ): Promise<FeedEvent[] | undefined> {
    if (events.length === 0) {
      return [];
    }
    return await this.#dbAdapter.withTransaction(
      async (tx) => {
        let [row] = await tx([
          'UPDATE realm_feeds SET head = head +',
          param(events.length),
          'WHERE feed_key =',
          param(key),
          'RETURNING head',
        ]);
        if (!row) {
          return undefined;
        }
        let head = Number(row.head);
        let first = head - events.length + 1;
        let appended = events.map(
          (event, i) => ({ ...event, seq: first + i }) as FeedEvent,
        );
        for (let event of appended) {
          await tx([
            'INSERT INTO realm_feed_events (feed_key, seq, event) VALUES (',
            param(key),
            ',',
            param(event.seq),
            ',',
            param(JSON.stringify(event)),
            '::jsonb)',
          ]);
        }
        // Kept a few windows deep, so a client a little behind can still
        // resume, with the latest message for each key kept however old;
        // older events are of no use to anyone.
        if (Math.floor(head / keep) !== Math.floor((first - 1) / keep)) {
          await tx([
            'DELETE FROM realm_feed_events e WHERE feed_key =',
            param(key),
            'AND seq <=',
            param(head - keep * 4),
            "AND (event->>'kind' IS DISTINCT FROM 'message' OR event->>'key' IS NULL",
            'OR seq < (SELECT max(seq) FROM realm_feed_events l',
            "WHERE l.feed_key = e.feed_key AND l.event->>'key' = e.event->>'key'))",
          ]);
        }
        await tx([
          'SELECT pg_notify(',
          param(REALM_FEED_EVENTS_CHANNEL),
          ',',
          param(key),
          ')',
        ]);
        return appended;
      },
      { label: `the event feed ${key}` },
    );
  }

  async after(key: string, seq: number): Promise<FeedEvent[]> {
    let rows = await query(this.#dbAdapter, [
      'SELECT event FROM realm_feed_events WHERE feed_key =',
      param(key),
      'AND seq >',
      param(seq),
      'ORDER BY seq',
    ]);
    return rows.map((row) => eventOf(row.event));
  }

  async claimRefresh(key: string, cooldownMs: number): Promise<RefreshClaim> {
    let claimed = await query(this.#dbAdapter, [
      'UPDATE realm_feeds SET last_refresh_at = now() WHERE feed_key =',
      param(key),
      'AND (last_refresh_at IS NULL OR last_refresh_at < now() - (',
      param(cooldownMs),
      "* interval '1 millisecond')) RETURNING feed_key",
    ]);
    if (claimed.length > 0) {
      return { accepted: true };
    }
    let [row] = await query(this.#dbAdapter, [
      'SELECT EXTRACT(EPOCH FROM (last_refresh_at + (',
      param(cooldownMs),
      "* interval '1 millisecond') - now())) * 1000 AS wait FROM realm_feeds WHERE feed_key =",
      param(key),
    ]);
    return {
      accepted: false,
      retryAfterMs: Math.max(1, Math.ceil(Number(row?.wait ?? cooldownMs))),
    };
  }
}

function eventOf(value: unknown): FeedEvent {
  return (typeof value === 'string' ? JSON.parse(value) : value) as FeedEvent;
}

// An epoch nobody can predict or collide with, so a client never mistakes a
// new feed's positions for the ones it held.
export function randomEpoch(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}
