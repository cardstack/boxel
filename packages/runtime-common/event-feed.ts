import type { RealmEventContent } from '@cardstack/base/matrix-event';

import { logger } from './log.ts';
import {
  MemoryFeedStore,
  supersededMessages,
  trimWindow,
  type FeedStore,
} from './event-feed-store.ts';

// A realm's event feed (ADR 023): one small invalidation per change to a
// card the feed's audience may read under the realm's permissions and policy,
// whether the realm is public or private. The audience it serves today is
// callers who aren't signed in, the hosts that have no Matrix session to hear
// realm events through. An event names the card by its path
// in the realm, never by its absolute URL, so a site that serves the realm
// under an alias (ADR 022 §1.2) passes events through unchanged and a
// visitor never learns the realm's own address. It carries no card content: a client
// re-reads the card through the ordinary gated read.

export const EVENT_FEED_PATH = '_live';

// The query parameter that addresses a card read by revision (ADR 023 §1.4).
// A client re-reading a card after an event asks for `{card}?rev=<rev>`, with
// the event's `rev`, so every reader of that revision asks for the same URL
// and a shared cache answers all but the first. The realm answers that URL
// with a long cache lifetime only while `rev` is the card's current one.
export const CARD_REVISION_PARAM = 'rev';

// The header naming the feed's position on a read, and the range a write's
// changes took on a write: `<epoch>:<seq>` or `<epoch>:<first>-<last>`
// (ADR 023 §1.1).
export const FEED_POSITION_HEADER = 'Boxel-Feed-Position';

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
// (ADR 023 §1.8). It names no card.
// The wire version events and the poll carry (ADR 023 §1.3). A client
// ignores fields and kinds it doesn't know, so a later version can add them.
export const EVENT_FEED_VERSION = 1;

// `removed`: the card was deleted. `withdrawn`: it still exists but the
// feed's audience may no longer read it. Both tell a client to drop it.
// `message`: something emitted on a card's live channel (ADR 023 §1.6),
// carried whole, since it is stored nowhere else.
export type FeedChangeKind =
  | 'written'
  | 'indexed'
  | 'removed'
  | 'withdrawn'
  | 'reset'
  | 'refresh'
  | 'message';

// The operation that produced a change (ADR 023 §1.1): its name and the
// base it builds on, never who ran it or with what.
export interface FeedOperation {
  name: string;
  base: string;
}

export interface FeedEvent {
  v?: number;
  operation?: FeedOperation;
  // The changed cards' types (ADR 023 §1.1), so a client re-runs only the
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
  // For a `reset`: the milliseconds a client spreads its revalidation over,
  // sized by the realm to the audience it serves (ADR 023 §1.3), so a crowd
  // revalidating everything doesn't arrive at once.
  spread?: number;
  // For a `message`: the key a later message with the same key replaces it
  // under, when its operation names one, and what was emitted.
  key?: string;
  body?: unknown;
  // For a `message` an unordered emit sent, such as presence (§1.8): it has
  // no position, so `seq` is 0 and a client never resumes from it.
  unordered?: true;
}

// A message emitted on a card's live channel (ADR 023 §1.6), as a page
// hears it.
export interface ChannelMessage {
  // Its position on the channel: a later message has a higher one.
  seq: number;
  // The key a later message with the same key replaces it under, if any.
  key?: string;
  // The name of the operation that emitted it.
  operation?: string;
  body: unknown;
}

// What a card that takes a page's refresh requests is handed (ADR 023 §1.8).
export interface RefreshNotice {
  // Reloads the page, when it suits the card's visitors.
  reload(): void;
}

// What the cacheable poll answers: the head of the sequence and the latest
// events, the same for every caller, so a shared cache can collapse a crowd's
// polls into one request (ADR 023 §1.3).
export interface FeedEventWindow {
  v?: number;
  epoch: string;
  head: number;
  // The position the events are complete after. A client that last saw an
  // earlier one may have missed something, and resets. Messages a later one
  // with the same key replaced are left out, so the events can skip
  // positions.
  from: number;
  events: FeedEvent[];
  // The spread a reset gets now, for a client that finds it fell behind the
  // window and resets itself.
  spread?: number;
}

// How many events the feed keeps for replay and for the poll's window.
export const EVENT_FEED_WINDOW = 256;

// The least time between two refresh requests a realm accepts, so the
// request stays the rare thing it is meant to be (ADR 023 §1.8).
export const EVENT_FEED_REFRESH_COOLDOWN_MS = 60_000;

// The most changes one realm event is judged card by card. Past it, a read
// per card would hold back every later event (a module change can invalidate
// thousands of instances), so the feed resets instead and lets each client
// revalidate what it holds.
export const EVENT_FEED_MAX_CHECKS_PER_EVENT = 64;

// How often an idle stream sends a comment, so proxies keep it open.
export const EVENT_FEED_HEARTBEAT_MS = 25_000;

// The most streams one process holds open for one realm, its channels
// included (ADR 023 §1.3). A stream asked for past it is answered 503 with a
// `Retry-After`, and the client polls instead, which a shared cache absorbs.
export const EVENT_FEED_MAX_STREAMS = 2_000;
// How long a client turned away at the cap is asked to wait before it asks
// for a stream again.
export const EVENT_FEED_STREAM_RETRY_AFTER_SECONDS = 30;

// The changes a realm event announces, as card URLs and what happened to
// them. A full reindex can have changed anything, so it is a reset.
// A write that ran no named operation is named by its base (ADR 023 §1.1).
const CREATED: FeedOperation = { name: 'create', base: 'create' };
const UPDATED: FeedOperation = { name: 'update', base: 'update' };
const DELETED: FeedOperation = { name: 'delete', base: 'delete' };

interface FeedChange {
  url: string;
  kind: FeedChangeKind;
  operation?: FeedOperation;
}

export function changesIn(event: RealmEventContent): FeedChange[] | 'reset' {
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
        // The write's own `update` event announces it, naming what it was;
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

// One realm's feed. `mayRead` answers whether a visitor who isn't signed in
// may read a card, as the realm itself answers that visitor's read (ADR 023
// §1.2); it is asked once per change, never per subscriber. Positions come
// from the store, which every process serving the realm shares (ADR 023
// §1.1); this process keeps the recent window in memory for reads, and hears
// what other processes append through `catchUp`.
// How long a feed whose store failed waits before announcing the reset that
// covers what it lost.
const EVENT_FEED_STORE_RETRY_MS = 1000;

// A reset's spread: a floor, a share per member of the audience, and a cap. A
// poll reaches the realm about once every 3 s per client, and less behind a
// shared cache, so polls in the last minute over 20 is a floor on how many
// clients poll.
const RESET_SPREAD_MIN_MS = 250;
const RESET_SPREAD_PER_CLIENT_MS = 10;
const RESET_SPREAD_MAX_MS = 30_000;
const POLLS_PER_CLIENT_PER_MINUTE = 20;

export class RealmEventFeed {
  #epoch = '';
  #seq = 0;
  #floor = 0;
  #events: FeedEvent[] = [];
  #loaded: Promise<void> | undefined;
  // Announcements waiting for the store to give them positions, and the
  // chain that hands them over in order.
  #outbox: Omit<FeedEvent, 'seq'>[] = [];
  #appending: Promise<void> = Promise.resolve();
  #retryingReset = false;
  // While an event is being judged its announcements wait, so they reach the
  // store together and take one contiguous range of positions.
  #holding = false;
  // Poll reads this minute and last, for sizing a reset's spread.
  #polls = { minute: 0, count: 0, previous: 0 };
  #subscribers = new Set<(event: FeedEvent) => void>();
  // The last kind and revision announced per path, to drop a repeat of the
  // same change the realm reports through two events.
  #lastKind = new Map<
    string,
    { kind: FeedChangeKind; rev?: string; at: number }
  >();
  #queue: Promise<void> = Promise.resolve();
  // The operation that wrote each path, held from its write until its index
  // pass is announced, so the `indexed` event names it too.
  #wroteBy = new Map<string, { operation: FeedOperation; at: number }>();

  readonly realmURL: string;
  // The store's name for this feed: the realm's URL, or a card's channel key.
  readonly key: string;
  private mayRead: (cardURL: string) => Promise<FeedReadability>;
  private store: FeedStore;
  // Told of each change to a card this feed announces, so the realm can mirror
  // it onto that card's live channel.
  private onAnnounced?: (event: Omit<FeedEvent, 'seq'>) => void;

  constructor(
    realmURL: string,
    mayRead: (cardURL: string) => Promise<FeedReadability>,
    store: FeedStore = new MemoryFeedStore(),
    options: {
      key?: string;
      onAnnounced?: (event: Omit<FeedEvent, 'seq'>) => void;
    } = {},
  ) {
    this.realmURL = realmURL;
    this.key = options.key ?? realmURL;
    this.mayRead = mayRead;
    this.store = store;
    this.onAnnounced = options.onAnnounced;
  }

  get epoch(): string {
    return this.#epoch;
  }

  get head(): number {
    return this.#seq;
  }

  // Loads the feed from its store, once. A feed found stored continues where
  // it stood: its positions and the cards it announced as readable are the
  // store's, shared by every process, so a process that starts later, or
  // again, has nothing to reset (ADR 023 §1.2). A load that fails is tried
  // again by the next caller rather than leaving the feed unusable.
  ready(): Promise<void> {
    this.#loaded ??= (async () => {
      let loaded = await this.store.load(this.key, EVENT_FEED_WINDOW);
      this.#epoch = loaded.epoch;
      this.#seq = loaded.head;
      this.#events = loaded.events;
      this.#floor = loaded.floor;
    })().catch((error: unknown) => {
      this.#loaded = undefined;
      throw error;
    });
    return this.#loaded;
  }

  // Takes a realm event in. Events are judged and announced in the order
  // they arrive. `operations` names the operation that wrote each card, by
  // card URL, for a write that ran through `_operations`.
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
    this.#announce(
      'reset',
      '',
      undefined,
      undefined,
      undefined,
      this.#spread(),
    );
  }

  // How long clients should spread a reset's revalidation over: longer the
  // more clients this process serves.
  #spread(): number {
    let audience =
      this.#subscribers.size +
      Math.ceil(this.#pollsLastMinute() / POLLS_PER_CLIENT_PER_MINUTE);
    return Math.min(
      RESET_SPREAD_MAX_MS,
      RESET_SPREAD_MIN_MS + audience * RESET_SPREAD_PER_CLIENT_MS,
    );
  }

  #countPoll() {
    let minute = Math.floor(Date.now() / 60_000);
    if (minute !== this.#polls.minute) {
      this.#polls = {
        minute,
        count: 0,
        previous: minute === this.#polls.minute + 1 ? this.#polls.count : 0,
      };
    }
    this.#polls.count++;
  }

  #pollsLastMinute(): number {
    let minute = Math.floor(Date.now() / 60_000);
    if (minute === this.#polls.minute) {
      return this.#polls.count + this.#polls.previous;
    }
    return minute === this.#polls.minute + 1 ? this.#polls.count : 0;
  }

  // Reads what other processes appended since this one last looked, and
  // passes it to this process's subscribers.
  async catchUp(): Promise<void> {
    await this.ready();
    await this.#appending;
    this.#deliverFromStore(await this.store.after(this.key, this.#seq));
  }

  // The messages a transform collecting from this channel reads (ADR 023
  // §1.6): the latest per key however old, from the store, after every emit
  // this process has under way has landed.
  async latestMessages(withinMs?: number): Promise<FeedEvent[]> {
    await this.ready();
    await this.#appending;
    return await this.store.latestMessages(
      this.key,
      EVENT_FEED_WINDOW,
      withinMs,
    );
  }

  // Emits a message on this feed, a card's live channel (ADR 023 §1.6):
  // what an `emit` operation the policy admitted produced. Resolves to the
  // message as the feed recorded it.
  //
  // `guard`, when given, runs first, in turn with the feed's other appends,
  // and a guard that throws emits nothing.
  async emit(
    message: {
      path: string;
      operation: FeedOperation;
      key?: string;
      body: unknown;
    },
    guard?: () => Promise<void>,
  ): Promise<FeedEvent> {
    let event: Omit<FeedEvent, 'seq'> = {
      v: EVENT_FEED_VERSION,
      kind: 'message',
      path: message.path,
      operation: message.operation,
      ...(message.key !== undefined ? { key: message.key } : {}),
      body: message.body,
    };
    // Recorded on its own, in turn with the feed's other appends, so the
    // caller learns its position, and a failure is the caller's to see.
    let step = this.#appending.then(async () => {
      await this.ready();
      await guard?.();
      let [recorded] = await this.store.append(
        this.key,
        [event],
        EVENT_FEED_WINDOW,
      );
      if (recorded!.seq === this.#seq + 1) {
        this.#deliver([recorded!]);
      } else {
        this.#deliverFromStore(await this.store.after(this.key, this.#seq));
      }
      return recorded!;
    });
    this.#appending = step.then(
      () => undefined,
      () => undefined,
    );
    return await step;
  }

  // Records an unordered message on this channel (ADR 023 §1.6), such as a
  // visitor's presence, and passes it to this process's subscribers. It
  // waits on nothing the channel is appending: it takes no position, and it
  // replaces the last one for its operation and key until it expires.
  async presence(
    message: {
      path: string;
      operation: FeedOperation;
      key: string;
      body: unknown;
    },
    expiresInMs: number,
  ): Promise<FeedEvent> {
    let event: FeedEvent = {
      v: EVENT_FEED_VERSION,
      seq: 0,
      kind: 'message',
      unordered: true,
      path: message.path,
      operation: message.operation,
      key: message.key,
      body: message.body,
    };
    await this.store.putPresence(this.key, event, expiresInMs);
    this.deliverPresence(event);
    return event;
  }

  // An unordered message, from this process or as another process's notice
  // brought it, passed straight to this process's subscribers.
  deliverPresence(event: FeedEvent) {
    for (let subscriber of [...this.#subscribers]) {
      subscriber(event);
    }
  }

  // The unexpired unordered messages on this channel, of one operation or
  // all: what a page starting to follow hears first, and what a `collect`
  // of an unordered emit reads.
  async livePresence(operation?: string): Promise<FeedEvent[]> {
    return await this.store.presence(this.key, operation);
  }

  // Carries a change the realm's feed announced for this channel's card, so
  // a page following the channel hears the card change on the same
  // connection as its messages.
  mirror(event: Omit<FeedEvent, 'seq'>) {
    this.#outbox.push(event);
    this.#appending = this.#appending.then(() => this.#flush());
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
    this.#holding = true;
    try {
      await this.#judge(changes, types, operations);
    } finally {
      this.#holding = false;
      this.#appending = this.#appending.then(() => this.#flush());
    }
    await this.#appending;
  }

  async #judge(
    changes: FeedChange[],
    types: string[] | undefined,
    operations: Record<string, FeedOperation> | undefined,
  ) {
    // What this event has decided so far, ahead of the store recording it.
    let decided = new Map<string, boolean>();
    let wasVisible = async (path: string) =>
      decided.get(path) ?? (await this.store.wasVisible(this.key, path));
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
      // Whether a visitor could hold the card is what the feed announced,
      // as the store records it for every process, so a removal is
      // announced whichever process announced the card and however long ago.
      if (kind === 'removed') {
        if (await wasVisible(path)) {
          decided.set(path, false);
          this.#announce('removed', path, undefined, types, operation);
        }
        continue;
      }
      let readable = await this.mayRead(new URL(path, this.realmURL).href);
      if (!readable) {
        // A card that stops being readable is announced once more, so a
        // visitor holding it finds out it is gone.
        if (await wasVisible(path)) {
          decided.set(path, false);
          this.#announce('withdrawn', path, undefined, types, operation);
        }
        continue;
      }
      decided.set(path, true);
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
    spread?: number,
  ) {
    let now = Date.now();
    let last = this.#lastKind.get(path);
    if (
      kind !== 'reset' &&
      kind !== 'refresh' &&
      kind !== 'message' &&
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
    let event: Omit<FeedEvent, 'seq'> = {
      v: EVENT_FEED_VERSION,
      kind,
      path,
      ...(rev ? { rev } : {}),
      ...(types ? { types } : {}),
      ...(operation ? { operation } : {}),
      ...(spread ? { spread } : {}),
    };
    this.#outbox.push(event);
    if (path || kind === 'reset') {
      this.onAnnounced?.(event);
    }
    if (!this.#holding) {
      this.#appending = this.#appending.then(() => this.#flush());
    }
  }

  // Resolves once every event taken in so far is judged and recorded.
  async settled(): Promise<void> {
    await this.#queue;
    await this.#appending;
  }

  // The position a response is stamped with: the feed's epoch and head.
  async position(): Promise<string> {
    await this.ready();
    return `${this.#epoch}:${this.#seq}`;
  }

  // The range of positions announcing changes to `paths` after `after`, as
  // an operation response names them: `<epoch>:<first>-<last>`, or the head
  // when none of them was announced, since nothing the audience may read
  // changed.
  async positionOfChanges(paths: string[], after: number): Promise<string> {
    await this.settled();
    let wanted = new Set(paths.map((path) => path.replace(/\.json$/, '')));
    let seqs = this.#events
      .filter(
        (event) =>
          event.seq > after &&
          event.kind !== 'indexed' &&
          wanted.has(event.path),
      )
      .map((event) => event.seq);
    if (seqs.length === 0) {
      return `${this.#epoch}:${this.#seq}`;
    }
    let first = Math.min(...seqs);
    let last = Math.max(...seqs);
    return first === last
      ? `${this.#epoch}:${first}`
      : `${this.#epoch}:${first}-${last}`;
  }

  // Hands the waiting announcements to the store, which gives them their
  // positions, and passes them on. A store that fails loses them: the feed
  // logs it and, a moment later, announces a reset, so clients revalidate
  // rather than miss them.
  async #flush() {
    if (this.#outbox.length === 0) {
      return;
    }
    let batch = this.#outbox;
    this.#outbox = [];
    try {
      await this.ready();
      let appended = await this.store.append(
        this.key,
        batch,
        EVENT_FEED_WINDOW,
      );
      // Another process appended between this one's last position and these:
      // read the gap with them, so this process's subscribers miss nothing.
      if (appended.length > 0 && appended[0]!.seq !== this.#seq + 1) {
        this.#deliverFromStore(await this.store.after(this.key, this.#seq));
      } else {
        this.#deliver(appended);
      }
    } catch (error: unknown) {
      log.warn(`event feed ${this.key} could not record events`, {
        error,
      });
      if (!this.#retryingReset) {
        this.#retryingReset = true;
        setTimeout(() => {
          this.#retryingReset = false;
          this.reset();
        }, EVENT_FEED_STORE_RETRY_MS);
      }
    }
  }

  // Takes in what the store holds after this process's position. The store
  // keeps every position for a few windows, so one missing from the run is
  // one it trimmed before this process read it: what was there is lost to
  // this process's subscribers, who are told to reset, and the window is
  // complete only after it (ADR 023 §1.3).
  #deliverFromStore(events: FeedEvent[]) {
    let sorted = [...events]
      .filter((event) => event.seq > this.#seq)
      .sort((a, b) => a.seq - b.seq);
    // The last place the run skips a position. Before it, at most the latest
    // messages per key the store keeps however old.
    let gap = -1;
    for (let i = 0; i < sorted.length; i++) {
      let previous = i === 0 ? this.#seq : sorted[i - 1]!.seq;
      if (sorted[i]!.seq !== previous + 1) {
        gap = i;
      }
    }
    if (gap === -1) {
      this.#deliver(sorted);
      return;
    }
    this.#deliver(sorted.slice(0, gap));
    let lost = sorted[gap]!.seq - 1;
    log.warn(
      `event feed ${this.key} missed positions up to ${lost}; its clients reset`,
    );
    this.#floor = Math.max(this.#floor, lost);
    this.#seq = Math.max(this.#seq, lost);
    let reset: FeedEvent = {
      v: EVENT_FEED_VERSION,
      seq: lost,
      kind: 'reset',
      path: '',
      spread: this.#spread(),
    };
    for (let subscriber of [...this.#subscribers]) {
      subscriber(reset);
    }
    this.#deliver(sorted.slice(gap));
  }

  // Takes positioned events in, in order, skipping any already held, and
  // passes them to this process's subscribers.
  #deliver(events: FeedEvent[]) {
    for (let event of [...events].sort((a, b) => a.seq - b.seq)) {
      if (event.seq <= this.#seq) {
        continue;
      }
      this.#seq = event.seq;
      this.#events.push(event);
      for (let subscriber of [...this.#subscribers]) {
        subscriber(event);
      }
    }
    let kept = trimWindow(this.#events, EVENT_FEED_WINDOW);
    this.#events = kept.events;
    this.#floor = Math.max(this.#floor, kept.floor);
  }

  // A writer's request that every page following the feed reload (ADR 023
  // §1.8). Refused within the cooldown of the last accepted one, across every
  // process serving the realm, with how long until another is accepted.
  async requestRefresh(): Promise<
    { accepted: true } | { accepted: false; retryAfterMs: number }
  > {
    await this.ready();
    let claim = await this.store.claimRefresh(
      this.key,
      EVENT_FEED_REFRESH_COOLDOWN_MS,
    );
    if (claim.accepted) {
      this.#announce('refresh', '');
      await this.#appending;
    }
    return claim;
  }

  // What the poll answers. Each call counts as one poll, for sizing resets.
  async window(): Promise<FeedEventWindow> {
    this.#countPoll();
    await this.ready();
    await this.#appending;
    let superseded = supersededMessages(this.#events);
    return {
      v: EVENT_FEED_VERSION,
      epoch: this.#epoch,
      head: this.#seq,
      from: this.#floor,
      events: this.#events.filter((event) => !superseded.has(event.seq)),
      spread: this.#spread(),
    };
  }

  // The events after `lastEventId` (an id this feed sent), or a reset when
  // that id is from another epoch, older than the window is complete after,
  // or past the head.
  async replay(lastEventId: string | null): Promise<FeedEvent[]> {
    await this.ready();
    await this.#appending;
    if (!lastEventId) {
      return [];
    }
    let [epoch, seqText] = lastEventId.split(':');
    let seq = Number(seqText);
    if (
      epoch !== this.#epoch ||
      !Number.isInteger(seq) ||
      seq < this.#floor ||
      seq > this.#seq
    ) {
      return [
        {
          v: EVENT_FEED_VERSION,
          seq: this.#seq,
          kind: 'reset',
          path: '',
          spread: this.#spread(),
        },
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
  // An unordered message has no position, so it goes without an id: a
  // client's last id, and so where it resumes from, stays the last ordered
  // event it heard.
  serialize(event: FeedEvent): string {
    if (event.unordered) {
      let framed = presenceFrames.get(event);
      if (framed === undefined) {
        framed = `event: change\ndata: ${JSON.stringify(event)}\n\n`;
        presenceFrames.set(event, framed);
      }
      return framed;
    }
    return `id: ${this.epoch}:${event.seq}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`;
  }
}

// Each presence message framed once, however many streams send it.
const presenceFrames = new WeakMap<FeedEvent, string>();

const log = logger('realm:event-feed');

// The types an index event names, as the feed may pass them on (ADR 023
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
