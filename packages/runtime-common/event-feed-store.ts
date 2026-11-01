import type { DBAdapter } from './db.ts';
import { dbAdapterQuerier, param, query, type Querier } from './expression.ts';
import type { FeedEvent } from './event-feed.ts';

// Where a realm's event feed keeps its sequence (ADR 020 §1.3). A store gives
// out positions and keeps the recent events, so that every process serving the
// realm shares one sequence and a restart continues it. The feed keeps its own
// copy of the window in memory for reads; the store is what makes positions
// agree across processes.

// The Postgres channel a store announces each append on. Its payload is the
// realm's URL; a process that hears it reads what it hasn't seen.
export const REALM_FEED_EVENTS_CHANNEL = 'realm_feed_events';

export interface LoadedFeed {
  epoch: string;
  head: number;
  events: FeedEvent[];
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
  load(realmURL: string, keep: number): Promise<LoadedFeed>;
  // Gives each event the next position, in order, and records them.
  append(
    realmURL: string,
    events: Omit<FeedEvent, 'seq'>[],
    keep: number,
  ): Promise<FeedEvent[]>;
  // The events after `seq`, in order: what another process appended.
  after(realmURL: string, seq: number): Promise<FeedEvent[]>;
  // Records a refresh request unless one was accepted within `cooldownMs`.
  claimRefresh(realmURL: string, cooldownMs: number): Promise<RefreshClaim>;
}

// A feed held in this process alone: a realm the host runs in the browser,
// and tests that run without Postgres.
export class MemoryFeedStore implements FeedStore {
  #epoch = randomEpoch();
  #head = 0;
  #events: FeedEvent[] = [];
  #lastRefresh: number | undefined;

  async load(_realmURL: string, _keep: number): Promise<LoadedFeed> {
    return {
      epoch: this.#epoch,
      head: this.#head,
      events: [...this.#events],
      restarted: false,
    };
  }

  async append(
    _realmURL: string,
    events: Omit<FeedEvent, 'seq'>[],
    keep: number,
  ): Promise<FeedEvent[]> {
    let appended = events.map(
      (event) => ({ ...event, seq: ++this.#head }) as FeedEvent,
    );
    this.#events.push(...appended);
    if (this.#events.length > keep) {
      this.#events.splice(0, this.#events.length - keep);
    }
    return appended;
  }

  async after(_realmURL: string, seq: number): Promise<FeedEvent[]> {
    return this.#events.filter((event) => event.seq > seq);
  }

  async claimRefresh(
    _realmURL: string,
    cooldownMs: number,
  ): Promise<RefreshClaim> {
    let now = Date.now();
    if (this.#lastRefresh !== undefined) {
      let wait = this.#lastRefresh + cooldownMs - now;
      if (wait > 0) {
        return { accepted: false, retryAfterMs: wait };
      }
    }
    this.#lastRefresh = now;
    return { accepted: true };
  }
}

// A feed kept in Postgres and shared by every process serving the realm.
// Positions come from one row per realm, incremented under its row lock, so
// two processes appending at once get consecutive positions in commit order.
// Each append notifies `REALM_FEED_EVENTS_CHANNEL` inside its transaction, so
// the notification arrives only once the events can be read.
export class DbFeedStore implements FeedStore {
  #dbAdapter: DBAdapter;

  constructor(dbAdapter: DBAdapter) {
    this.#dbAdapter = dbAdapter;
  }

  async load(realmURL: string, keep: number): Promise<LoadedFeed> {
    let created = await query(this.#dbAdapter, [
      'INSERT INTO realm_feeds (realm_url, epoch, head) VALUES (',
      param(realmURL),
      ',',
      param(randomEpoch()),
      ', 0) ON CONFLICT (realm_url) DO NOTHING RETURNING epoch',
    ]);
    let [row] = await query(this.#dbAdapter, [
      'SELECT epoch, head FROM realm_feeds WHERE realm_url =',
      param(realmURL),
    ]);
    let head = Number(row?.head ?? 0);
    let events = await this.#recent(
      dbAdapterQuerier(this.#dbAdapter),
      realmURL,
      head,
      keep,
    );
    return {
      epoch: String(row?.epoch),
      head,
      events,
      restarted: created.length === 0,
    };
  }

  async append(
    realmURL: string,
    events: Omit<FeedEvent, 'seq'>[],
    keep: number,
  ): Promise<FeedEvent[]> {
    if (events.length === 0) {
      return [];
    }
    return await this.#dbAdapter.withTransaction(
      async (tx) => {
        let [row] = await tx([
          'UPDATE realm_feeds SET head = head +',
          param(events.length),
          'WHERE realm_url =',
          param(realmURL),
          'RETURNING head',
        ]);
        if (!row) {
          throw new Error(`no event feed is stored for ${realmURL}`);
        }
        let head = Number(row.head);
        let first = head - events.length + 1;
        let appended = events.map(
          (event, i) => ({ ...event, seq: first + i }) as FeedEvent,
        );
        for (let event of appended) {
          await tx([
            'INSERT INTO realm_feed_events (realm_url, seq, event) VALUES (',
            param(realmURL),
            ',',
            param(event.seq),
            ',',
            param(JSON.stringify(event)),
            '::jsonb)',
          ]);
        }
        // Kept a few windows deep, so a client a little behind can still
        // resume; older events are of no use to anyone.
        if (Math.floor(head / keep) !== Math.floor((first - 1) / keep)) {
          await tx([
            'DELETE FROM realm_feed_events WHERE realm_url =',
            param(realmURL),
            'AND seq <=',
            param(head - keep * 4),
          ]);
        }
        await tx([
          'SELECT pg_notify(',
          param(REALM_FEED_EVENTS_CHANNEL),
          ',',
          param(realmURL),
          ')',
        ]);
        return appended;
      },
      { label: `the event feed of ${realmURL}` },
    );
  }

  async after(realmURL: string, seq: number): Promise<FeedEvent[]> {
    let rows = await query(this.#dbAdapter, [
      'SELECT event FROM realm_feed_events WHERE realm_url =',
      param(realmURL),
      'AND seq >',
      param(seq),
      'ORDER BY seq',
    ]);
    return rows.map((row) => eventOf(row.event));
  }

  async claimRefresh(
    realmURL: string,
    cooldownMs: number,
  ): Promise<RefreshClaim> {
    let claimed = await query(this.#dbAdapter, [
      'UPDATE realm_feeds SET last_refresh_at = now() WHERE realm_url =',
      param(realmURL),
      'AND (last_refresh_at IS NULL OR last_refresh_at < now() - (',
      param(cooldownMs),
      "* interval '1 millisecond')) RETURNING realm_url",
    ]);
    if (claimed.length > 0) {
      return { accepted: true };
    }
    let [row] = await query(this.#dbAdapter, [
      'SELECT EXTRACT(EPOCH FROM (last_refresh_at + (',
      param(cooldownMs),
      "* interval '1 millisecond') - now())) * 1000 AS wait FROM realm_feeds WHERE realm_url =",
      param(realmURL),
    ]);
    return {
      accepted: false,
      retryAfterMs: Math.max(1, Math.ceil(Number(row?.wait ?? cooldownMs))),
    };
  }

  async #recent(
    querier: Querier,
    realmURL: string,
    head: number,
    keep: number,
  ): Promise<FeedEvent[]> {
    let rows = await querier([
      'SELECT event FROM realm_feed_events WHERE realm_url =',
      param(realmURL),
      'AND seq >',
      param(head - keep),
      'ORDER BY seq',
    ]);
    return rows.map((row) => eventOf(row.event));
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
