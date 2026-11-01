import type { RealmEventContent } from '@cardstack/base/matrix-event';

// A realm's event feed (ADR 020): one small invalidation per change to a
// card the feed's audience may read under the realm's permissions and policy,
// whether the realm is public or private. The audience it serves today is
// callers who aren't signed in, the hosts that have no Matrix session to hear
// realm events through. An event names the card by its path
// in the realm, never by its absolute URL, so a site that serves the realm
// under an alias (ADR 018) passes events through unchanged and a visitor never
// learns the realm's own address. It carries no card content: a client
// re-reads the card through the ordinary gated read.

export const EVENT_FEED_PATH = '_events';

// The query parameter that addresses a card read by revision (ADR 020 §1.5).
// A client re-reading a card after an event asks for `{card}?rev=<rev>`, with
// the event's `rev`, so every reader of that revision asks for the same URL
// and a shared cache answers all but the first. The realm answers that URL
// with a long cache lifetime only while `rev` is the card's current one.
export const CARD_REVISION_PARAM = 'rev';

// A card's revision as its card+json validator names it: the ETag without its
// quotes. The validator already changes whenever the document does, its link
// closure and the server's assembly settings included, so a revision never
// names two documents.
export function cardRevisionOf(
  etag: string | null | undefined,
): string | undefined {
  if (!etag || etag.startsWith('W/')) {
    return undefined;
  }
  return etag.replace(/^"|"$/g, '') || undefined;
}

// `refresh` is a writer's request that every page following the feed reload
// (ADR 020 §1.7). It names no card.
export type FeedChangeKind =
  | 'written'
  | 'indexed'
  | 'removed'
  | 'reset'
  | 'refresh';

export interface FeedEvent {
  // Position in this feed's sequence. Only increases within one `epoch`.
  seq: number;
  kind: FeedChangeKind;
  // The card's path in the realm, without `.json`. Empty for `reset` and
  // `refresh`.
  path: string;
  // The revision a visitor who isn't signed in reads the card at, for an
  // `indexed` change, when the realm could name one (see
  // `CARD_REVISION_PARAM`). Absent for every other kind: a `written` change
  // is announced before indexing, when the read would still find the last
  // revision.
  rev?: string;
}

// What the cacheable poll answers: the head of the sequence and the latest
// events, the same for every caller, so a shared cache can collapse a crowd's
// polls into one request (ADR 020 §1.3).
export interface FeedEventWindow {
  epoch: string;
  head: number;
  events: FeedEvent[];
}

// How many events the feed keeps for replay and for the poll's window.
export const EVENT_FEED_WINDOW = 256;

// The least time between two refresh requests a realm accepts, so the
// request stays the rare thing it is meant to be (ADR 020 §1.7).
export const EVENT_FEED_REFRESH_COOLDOWN_MS = 60_000;

// How often an idle stream sends a comment, so proxies keep it open.
export const EVENT_FEED_HEARTBEAT_MS = 25_000;

// The changes a realm event announces, as card URLs and what happened to
// them. A full reindex can have changed anything, so it is a reset.
export function changesIn(
  event: RealmEventContent,
): { url: string; kind: FeedChangeKind }[] | 'reset' {
  switch (event.eventName) {
    case 'update':
      return [
        ...(event.added ?? []).map((url) => ({
          url,
          kind: 'written' as const,
        })),
        ...(event.updated ?? []).map((url) => ({
          url,
          kind: 'written' as const,
        })),
        ...(event.removed ?? []).map((url) => ({
          url,
          kind: 'removed' as const,
        })),
      ];
    case 'index':
      if (event.indexType === 'full') {
        return 'reset';
      }
      if (event.indexType === 'incremental-index-initiation') {
        return [{ url: event.updatedFile, kind: 'written' }];
      }
      return event.invalidations.map((url) => ({ url, kind: 'indexed' }));
    default:
      // Prerendered markup changes no card's data.
      return [];
  }
}

// What `mayRead` answers: whether a visitor who isn't signed in may read the
// card, and the revision they read it at when the realm can name one.
export type FeedReadability = false | { rev?: string };

// One realm's feed, held in memory by the process that serves the realm.
// `mayRead` answers whether a visitor who isn't signed in may read a card, as
// the realm itself answers that visitor's read (ADR 020 §1.2). It is asked
// once per change, never per subscriber.
export class RealmEventFeed {
  readonly epoch = randomEpoch();
  #seq = 0;
  #events: FeedEvent[] = [];
  #subscribers = new Set<(event: FeedEvent) => void>();
  // Cards this feed has announced as readable, so a removal is announced
  // only for a card a visitor could have seen.
  #visible = new Set<string>();
  // The last kind and revision announced per path, to drop a repeat of the
  // same change the realm reports through two events.
  #lastKind = new Map<
    string,
    { kind: FeedChangeKind; rev?: string; at: number }
  >();
  #queue: Promise<void> = Promise.resolve();
  #lastRefresh: number | undefined;

  readonly realmURL: string;
  private mayRead: (cardURL: string) => Promise<FeedReadability>;

  constructor(
    realmURL: string,
    mayRead: (cardURL: string) => Promise<FeedReadability>,
  ) {
    this.realmURL = realmURL;
    this.mayRead = mayRead;
  }

  get head(): number {
    return this.#seq;
  }

  // Takes a realm event in. Events are judged and announced in the order
  // they arrive.
  ingest(event: RealmEventContent): Promise<void> {
    this.#queue = this.#queue
      .then(() => this.#ingest(event))
      .catch(() => {
        // A failed check announces nothing; the next change is judged anew.
      });
    return this.#queue;
  }

  async #ingest(event: RealmEventContent) {
    let changes = changesIn(event);
    if (changes === 'reset') {
      this.#visible.clear();
      this.#announce('reset', '');
      return;
    }
    for (let { url, kind } of changes) {
      let path = this.#pathOf(url);
      if (path === undefined) {
        continue;
      }
      if (kind === 'removed') {
        if (this.#visible.delete(path)) {
          this.#announce('removed', path);
        }
        continue;
      }
      let readable = await this.mayRead(new URL(path, this.realmURL).href);
      if (!readable) {
        // A card that stops being readable is announced once more, so a
        // visitor holding it finds out it is gone.
        if (this.#visible.delete(path)) {
          this.#announce('removed', path);
        }
        continue;
      }
      this.#visible.add(path);
      this.#announce(kind, path, kind === 'indexed' ? readable.rev : undefined);
    }
  }

  #pathOf(url: string): string | undefined {
    if (!url.startsWith(this.realmURL)) {
      return undefined;
    }
    let path = url.slice(this.realmURL.length).replace(/\.json$/, '');
    // A module, a file or the realm's own config is not a card a visitor
    // reads through the card read, so `mayRead` answers false for it; the
    // dot test spares that read for the obvious cases.
    if (!path || path.startsWith('_') || /\.[a-z0-9]+$/i.test(path)) {
      return undefined;
    }
    return path;
  }

  #announce(kind: FeedChangeKind, path: string, rev?: string) {
    let now = Date.now();
    let last = this.#lastKind.get(path);
    if (
      kind !== 'reset' &&
      kind !== 'refresh' &&
      last?.kind === kind &&
      last.rev === rev &&
      now - last.at < 1000
    ) {
      return;
    }
    this.#lastKind.set(path, { kind, rev, at: now });
    if (this.#lastKind.size > EVENT_FEED_WINDOW * 4) {
      this.#lastKind.clear();
    }
    let event: FeedEvent = {
      seq: ++this.#seq,
      kind,
      path,
      ...(rev ? { rev } : {}),
    };
    this.#events.push(event);
    if (this.#events.length > EVENT_FEED_WINDOW) {
      this.#events.splice(0, this.#events.length - EVENT_FEED_WINDOW);
    }
    for (let subscriber of [...this.#subscribers]) {
      subscriber(event);
    }
  }

  // A writer's request that every page following the feed reload (ADR 020
  // §1.7). Refused within the cooldown of the last accepted one, with how
  // long until another would be accepted.
  requestRefresh(
    now = Date.now(),
  ): { accepted: true } | { accepted: false; retryAfterMs: number } {
    if (this.#lastRefresh !== undefined) {
      let wait = this.#lastRefresh + EVENT_FEED_REFRESH_COOLDOWN_MS - now;
      if (wait > 0) {
        return { accepted: false, retryAfterMs: wait };
      }
    }
    this.#lastRefresh = now;
    this.#announce('refresh', '');
    return { accepted: true };
  }

  window(): FeedEventWindow {
    return { epoch: this.epoch, head: this.#seq, events: [...this.#events] };
  }

  // The events after `lastEventId` (an id this feed sent), or a reset when
  // that id is from another epoch or older than the window holds.
  replay(lastEventId: string | null): FeedEvent[] {
    if (!lastEventId) {
      return [];
    }
    let [epoch, seqText] = lastEventId.split(':');
    let seq = Number(seqText);
    let oldest = this.#events[0]?.seq ?? this.#seq + 1;
    if (epoch !== this.epoch || !Number.isInteger(seq) || seq < oldest - 1) {
      return [{ seq: this.#seq, kind: 'reset', path: '' }];
    }
    return this.#events.filter((event) => event.seq > seq);
  }

  subscribe(subscriber: (event: FeedEvent) => void): () => void {
    this.#subscribers.add(subscriber);
    return () => {
      this.#subscribers.delete(subscriber);
    };
  }

  get subscriberCount(): number {
    return this.#subscribers.size;
  }

  // One event in the `text/event-stream` format. The id carries the epoch, so
  // a client reconnecting to a restarted server is told to reset rather than
  // missing what changed meanwhile.
  serialize(event: FeedEvent): string {
    return `id: ${this.epoch}:${event.seq}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`;
  }
}

function randomEpoch(): string {
  return Math.random().toString(36).slice(2, 10);
}
