import type { RealmEventContent } from '@cardstack/base/matrix-event';

// A realm's public change feed (ADR 020): one small invalidation per change to
// a card a visitor who isn't signed in may read, for hosts that have no Matrix
// session to hear realm events through. An event names the card by its path
// in the realm, never by its absolute URL, so a site that serves the realm
// under an alias (ADR 018) passes events through unchanged and a visitor never
// learns the realm's own address. It carries no card content: a client
// re-reads the card through the ordinary gated read.

export const PUBLIC_EVENTS_PATH = '_public-events';

export type PublicChangeKind = 'written' | 'indexed' | 'removed' | 'reset';

export interface PublicRealmEvent {
  // Position in this feed's sequence. Only increases within one `epoch`.
  seq: number;
  kind: PublicChangeKind;
  // The card's path in the realm, without `.json`. Empty for `reset`.
  path: string;
}

// What the cacheable poll answers: the head of the sequence and the latest
// events, the same for every caller, so a shared cache can collapse a crowd's
// polls into one request (ADR 020 §1.3).
export interface PublicEventWindow {
  epoch: string;
  head: number;
  events: PublicRealmEvent[];
}

// How many events the feed keeps for replay and for the poll's window.
export const PUBLIC_EVENT_WINDOW = 256;

// How often an idle stream sends a comment, so proxies keep it open.
export const PUBLIC_EVENT_HEARTBEAT_MS = 25_000;

// The changes a realm event announces, as card URLs and what happened to
// them. A full reindex can have changed anything, so it is a reset.
export function changesIn(
  event: RealmEventContent,
): { url: string; kind: PublicChangeKind }[] | 'reset' {
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

// One realm's feed, held in memory by the process that serves the realm.
// `mayRead` answers whether a visitor who isn't signed in may read a card, as
// the realm itself answers that visitor's read (ADR 020 §1.2). It is asked
// once per change, never per subscriber.
export class PublicRealmFeed {
  readonly epoch = randomEpoch();
  #seq = 0;
  #events: PublicRealmEvent[] = [];
  #subscribers = new Set<(event: PublicRealmEvent) => void>();
  // Cards this feed has announced as readable, so a removal is announced
  // only for a card a visitor could have seen.
  #public = new Set<string>();
  // The last kind announced per path, to drop a repeat of the same change
  // the realm reports through two events.
  #lastKind = new Map<string, { kind: PublicChangeKind; at: number }>();
  #queue: Promise<void> = Promise.resolve();

  readonly realmURL: string;
  private mayRead: (cardURL: string) => Promise<boolean>;

  constructor(
    realmURL: string,
    mayRead: (cardURL: string) => Promise<boolean>,
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
      this.#public.clear();
      this.#announce('reset', '');
      return;
    }
    for (let { url, kind } of changes) {
      let path = this.#pathOf(url);
      if (path === undefined) {
        continue;
      }
      if (kind === 'removed') {
        if (this.#public.delete(path)) {
          this.#announce('removed', path);
        }
        continue;
      }
      let readable = await this.mayRead(new URL(path, this.realmURL).href);
      if (!readable) {
        // A card that stops being readable is announced once more, so a
        // visitor holding it finds out it is gone.
        if (this.#public.delete(path)) {
          this.#announce('removed', path);
        }
        continue;
      }
      this.#public.add(path);
      this.#announce(kind, path);
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

  #announce(kind: PublicChangeKind, path: string) {
    let now = Date.now();
    let last = this.#lastKind.get(path);
    if (kind !== 'reset' && last?.kind === kind && now - last.at < 1000) {
      return;
    }
    this.#lastKind.set(path, { kind, at: now });
    if (this.#lastKind.size > PUBLIC_EVENT_WINDOW * 4) {
      this.#lastKind.clear();
    }
    let event: PublicRealmEvent = { seq: ++this.#seq, kind, path };
    this.#events.push(event);
    if (this.#events.length > PUBLIC_EVENT_WINDOW) {
      this.#events.splice(0, this.#events.length - PUBLIC_EVENT_WINDOW);
    }
    for (let subscriber of [...this.#subscribers]) {
      subscriber(event);
    }
  }

  window(): PublicEventWindow {
    return { epoch: this.epoch, head: this.#seq, events: [...this.#events] };
  }

  // The events after `lastEventId` (an id this feed sent), or a reset when
  // that id is from another epoch or older than the window holds.
  replay(lastEventId: string | null): PublicRealmEvent[] {
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

  subscribe(subscriber: (event: PublicRealmEvent) => void): () => void {
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
  serialize(event: PublicRealmEvent): string {
    return `id: ${this.epoch}:${event.seq}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`;
  }
}

function randomEpoch(): string {
  return Math.random().toString(36).slice(2, 10);
}
