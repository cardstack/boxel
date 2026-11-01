import type { RealmEventContent } from '@cardstack/base/matrix-event';

import { logger } from './log.ts';

// A realm's event feed (ADR 020): one small invalidation per change to a
// card the feed's audience may read under the realm's permissions and policy,
// whether the realm is public or private. The audience it serves today is
// callers who aren't signed in, the hosts that have no Matrix session to hear
// realm events through. An event names the card by its path
// in the realm, never by its absolute URL, so a site that serves the realm
// under an alias (ADR 018) passes events through unchanged and a visitor never
// learns the realm's own address. It carries no card content: a client
// re-reads the card through the ordinary gated read.

export const EVENT_FEED_PATH = '_live';

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
// The wire version events and the poll carry (ADR 020 §1.9). A client
// ignores fields and kinds it doesn't know, so a later version can add them.
export const EVENT_FEED_VERSION = 1;

// `removed`: the card was deleted. `withdrawn`: it still exists but the
// feed's audience may no longer read it. Both tell a client to drop it.
export type FeedChangeKind =
  | 'written'
  | 'indexed'
  | 'removed'
  | 'withdrawn'
  | 'reset'
  | 'refresh';

// The operation that produced a change (ADR 020 §1.1): its name and the
// base it builds on, never who ran it or with what.
export interface FeedOperation {
  name: string;
  base: string;
}

export interface FeedEvent {
  v?: number;
  operation?: FeedOperation;
  // The changed cards' types (ADR 020 §1.1), so a client re-runs only the
  // searches they could affect: keys relative to the realm, or prefix-form
  // keys such as `@cardstack/base/card-api/CardDef`. Absent when the realm
  // couldn't say, and then a client re-runs every search.
  types?: string[];
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
  v?: number;
  epoch: string;
  head: number;
  events: FeedEvent[];
}

// How many events the feed keeps for replay and for the poll's window.
export const EVENT_FEED_WINDOW = 256;

// The least time between two refresh requests a realm accepts, so the
// request stays the rare thing it is meant to be (ADR 020 §1.7).
export const EVENT_FEED_REFRESH_COOLDOWN_MS = 60_000;

// The most changes one realm event is judged card by card. Past it, a read
// per card would hold back every later event (a module change can invalidate
// thousands of instances), so the feed resets instead and lets each client
// revalidate what it holds.
export const EVENT_FEED_MAX_CHECKS_PER_EVENT = 64;

// How often an idle stream sends a comment, so proxies keep it open.
export const EVENT_FEED_HEARTBEAT_MS = 25_000;

// The changes a realm event announces, as card URLs and what happened to
// them. A full reindex can have changed anything, so it is a reset.
// A write that ran no named operation is named by its base (ADR 020 §1.1).
const CREATED: FeedOperation = { name: 'create', base: 'create' };
const UPDATED: FeedOperation = { name: 'update', base: 'update' };
const DELETED: FeedOperation = { name: 'delete', base: 'delete' };

export function changesIn(
  event: RealmEventContent,
):
  | { url: string; kind: FeedChangeKind; operation?: FeedOperation }[]
  | 'reset' {
  switch (event.eventName) {
    case 'update': {
      // The write's own event names its files by their paths in the realm.
      let urlOf = (path: string) => new URL(path, event.realmURL).href;
      return [
        ...(event.added ?? []).map((path) => ({
          url: urlOf(path),
          kind: 'written' as const,
          operation: CREATED,
        })),
        ...(event.updated ?? []).map((path) => ({
          url: urlOf(path),
          kind: 'written' as const,
          operation: UPDATED,
        })),
        ...(event.removed ?? []).map((path) => ({
          url: urlOf(path),
          kind: 'removed' as const,
          operation: DELETED,
        })),
      ];
    }
    case 'index':
      if (event.indexType === 'full') {
        return 'reset';
      }
      if (event.indexType === 'incremental-index-initiation') {
        // The write's own \`update\` event announces it, naming what it was;
        // this signal of the same write would only repeat it without that.
        return [];
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
  // The operation that wrote each path, held from its write until its index
  // pass is announced, so the \`indexed\` event names it too.
  #wroteBy = new Map<string, { operation: FeedOperation; at: number }>();
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
  // \`operations\` names the operation that wrote each card, by card URL, for a
  // write that ran through \`_operations\`.
  ingest(
    event: RealmEventContent,
    operations?: Record<string, FeedOperation>,
  ): Promise<void> {
    this.#queue = this.#queue
      .then(() => this.#ingest(event, operations))
      .catch((error: unknown) => {
        // A check that fails can't say whether a change is readable, so the
        // feed fails closed: it names no card, and tells every client to
        // revalidate what it holds rather than missing the change.
        log.warn(`event feed for ${this.realmURL} reset after a failed check`, {
          error,
        });
        this.reset();
      });
    return this.#queue;
  }

  // Tells every client to revalidate everything it holds from this realm:
  // for a change the feed can't attribute to cards, such as the realm's
  // permissions or the policy it names.
  reset() {
    this.#visible.clear();
    this.#announce('reset', '');
  }

  async #ingest(
    event: RealmEventContent,
    operations?: Record<string, FeedOperation>,
  ) {
    let changes = changesIn(event);
    if (changes === 'reset') {
      this.reset();
      return;
    }
    // A change to the realm's own config can change which policy governs it,
    // and so what every visitor may read.
    if (
      changes.some(
        ({ url }) => url === new URL('realm.json', this.realmURL).href,
      )
    ) {
      this.reset();
      return;
    }
    if (changes.length > EVENT_FEED_MAX_CHECKS_PER_EVENT) {
      this.reset();
      return;
    }
    let types = feedTypes(event, this.realmURL);
    for (let change of changes) {
      let { url, kind } = change;
      let path = this.#pathOf(url);
      if (path === undefined) {
        continue;
      }
      let operation = this.#operationFor(
        path,
        kind,
        operations?.[url] ??
          operations?.[url.replace(/\.json$/, '')] ??
          change.operation,
      );
      if (kind === 'removed') {
        if (this.#visible.delete(path)) {
          this.#announce('removed', path, undefined, types, operation);
        }
        continue;
      }
      let readable = await this.mayRead(new URL(path, this.realmURL).href);
      if (!readable) {
        // A card that stops being readable is announced once more, so a
        // visitor holding it finds out it is gone.
        if (this.#visible.delete(path)) {
          this.#announce('withdrawn', path, undefined, types, operation);
        }
        continue;
      }
      this.#visible.add(path);
      this.#announce(
        kind,
        path,
        kind === 'indexed' ? readable.rev : undefined,
        types,
        operation,
      );
    }
  }

  // The operation to name for a change: the one that wrote it, remembered
  // from its write for its index pass, which follows within seconds.
  #operationFor(
    path: string,
    kind: FeedChangeKind,
    operation: FeedOperation | undefined,
  ): FeedOperation | undefined {
    let now = Date.now();
    if (kind === 'written' && operation) {
      this.#wroteBy.set(path, { operation, at: now });
      if (this.#wroteBy.size > EVENT_FEED_WINDOW * 4) {
        let oldest = this.#wroteBy.keys().next().value;
        if (oldest !== undefined) {
          this.#wroteBy.delete(oldest);
        }
      }
      return operation;
    }
    if (kind === 'indexed') {
      let wrote = this.#wroteBy.get(path);
      this.#wroteBy.delete(path);
      return wrote && now - wrote.at < 60_000 ? wrote.operation : undefined;
    }
    return operation;
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

  #announce(
    kind: FeedChangeKind,
    path: string,
    rev?: string,
    types?: string[],
    operation?: FeedOperation,
  ) {
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
      v: EVENT_FEED_VERSION,
      seq: ++this.#seq,
      kind,
      path,
      ...(rev ? { rev } : {}),
      ...(types ? { types } : {}),
      ...(operation ? { operation } : {}),
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
    return {
      v: EVENT_FEED_VERSION,
      epoch: this.epoch,
      head: this.#seq,
      events: [...this.#events],
    };
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
      return [
        { v: EVENT_FEED_VERSION, seq: this.#seq, kind: 'reset', path: '' },
      ];
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

const log = logger('realm:event-feed');

// The types an index event names, as the feed may pass them on (ADR 020
// §1.1). A key inside the realm becomes relative to it, so a site visitor
// never learns the realm's own address; a prefix-form key names no address
// and passes as it is. A key that is an absolute URL elsewhere would name
// another realm's address, so a set holding one is dropped whole, which leaves
// a client re-running every search, as it would with no types at all.
export function feedTypes(
  event: RealmEventContent,
  realmURL: string,
): string[] | undefined {
  if (
    event.eventName !== 'index' ||
    !('invalidatedTypes' in event) ||
    !Array.isArray(event.invalidatedTypes)
  ) {
    return undefined;
  }
  let types: string[] = [];
  for (let key of event.invalidatedTypes) {
    if (key.startsWith(realmURL)) {
      types.push(key.slice(realmURL.length));
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(key)) {
      return undefined;
    } else {
      types.push(key);
    }
  }
  return types;
}

// An epoch nobody can predict or collide with, so a client never mistakes a
// restarted feed's positions for the ones it held.
function randomEpoch(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}
