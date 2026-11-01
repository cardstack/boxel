import { later } from '@ember/runloop';
import Service, { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import {
  EVENT_FEED_PATH,
  type FeedEventWindow,
  type FeedEvent,
} from '@cardstack/runtime-common';

import type MatrixService from './matrix-service';
import type MessageService from './message-service';
import type { RealmEventContent } from '@cardstack/base/matrix-event';

// Realm events for a session that has no Matrix to hear them through: a
// visitor of a published site who isn't signed in. Each realm the page starts
// watching gets the realm's event feed (ADR 020), and each change is
// relayed through MessageService as the incremental index event Matrix would
// have delivered, so the store, live searches and resources stay current with
// no second mechanism (ADR 020 §1.6).
//
// The feed is a stream where the realm offers one, and the realm's cacheable
// poll where it doesn't or the stream won't connect.
//
// A refresh request (ADR 020 §1.7) is not relayed: the page is offered it as
// a cancelable `boxel-refresh-requested` event, and reloads when nothing on
// it takes the event.
//
// A browser holds one connection per feed however many of its tabs show the
// site (ADR 020 §1.6). The tabs elect a leader with a Web Lock: the tab that
// holds the lock opens the feeds, for the realms every tab watches, and passes
// each event to the other tabs over a BroadcastChannel. The lock is released
// when its tab closes, the next tab waiting on it becomes the leader, and it
// resumes each feed from the last event id the tabs saw, so a handover misses
// nothing the feed still holds and is told to reset when it does. A browser
// without Web Locks or BroadcastChannel gives each tab its own feeds.

const POLL_INTERVAL_MS = 3_000;

// How a feed client waits after a failure: from the first retry delay,
// doubling, to at most a minute, each wait jittered so a crowd that lost the
// realm at once (a deploy) doesn't come back at once.
const RETRY_FIRST_MS = 1_000;
const RETRY_MOST_MS = 60_000;

interface FeedTiming {
  pollMs: number;
  retryFirstMs: number;
}

function backoff(attempt: number, timing: FeedTiming): number {
  let ceiling = Math.min(
    RETRY_MOST_MS,
    timing.retryFirstMs * 2 ** Math.max(0, attempt - 1),
  );
  return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
}

// The wait a `Retry-After` header asks for, when it names seconds.
function retryAfterMs(response: Response): number | undefined {
  let seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

// The longest a tab waits before relaying an event, so the re-reads a change
// starts across a crowd of visitors are spread out rather than arriving at
// once (ADR 020 §1.5).
const RELAY_SPREAD_MS = 250;

// The longest a page waits before it reloads on a refresh request nothing on
// it took, so a room of screens doesn't reload at once (ADR 020 §1.7).
const REFRESH_SPREAD_MS = 5_000;

// The notice a page gets when its realm asks pages to reload (ADR 020 §1.7).
// Cancelable: an app that calls `preventDefault()` keeps the page as it is,
// can tell its visitors an update is ready, and calls `detail.reload()` when it
// suits them. A page whose app doesn't take it reloads.
export const REFRESH_REQUESTED_EVENT = 'boxel-refresh-requested';
export interface RefreshRequestedDetail {
  realm: string;
  reload: () => void;
}

// Per origin, which is all the Web Locks and BroadcastChannel APIs can see.
const COORDINATION_NAME = 'boxel-event-feed';

// What the tabs say to each other on the channel.
type TabMessage =
  // The leader passing on an event, with the id the feed gave it.
  | { type: 'event'; realm: string; event: FeedEvent; id?: string }
  // A tab naming the realms it watches, for the leader to open, and the last
  // event id it saw for each.
  | { type: 'watch'; realms: string[]; cursors: Record<string, string> }
  // A tab that has just become the leader, asking the others which realms
  // they watch.
  | { type: 'leader' };

// The parts of the browser APIs this service uses, so a test can stand in for
// them.
export interface TabChannel {
  postMessage(message: unknown): void;
  addEventListener(
    type: 'message',
    listener: (message: MessageEvent) => void,
  ): void;
  close(): void;
}
export interface TabLocks {
  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<unknown>;
}
export interface TabCoordination {
  locks: TabLocks;
  channel: (name: string) => TabChannel;
}

function browserCoordination(): TabCoordination | undefined {
  let locks = (globalThis.navigator as { locks?: TabLocks } | undefined)?.locks;
  if (!locks || typeof globalThis.BroadcastChannel !== 'function') {
    return undefined;
  }
  return {
    locks,
    channel: (name) => new BroadcastChannel(name) as unknown as TabChannel,
  };
}

export default class EventFeedService extends Service {
  @service declare private messageService: MessageService;
  @service declare private matrixService: MatrixService;

  // How tabs coordinate, read when the service starts. Off under test, where
  // one test page runs app after app and each should lead its own feeds at
  // once; the unit test stands in for the browser APIs to cover it.
  coordination: TabCoordination | undefined = isTesting()
    ? undefined
    : browserCoordination();
  // The longest wait before an event is relayed. Tests relay at once, since
  // a test waits on the reload an event starts, not on a timer before it.
  relaySpreadMs = isTesting() ? 0 : RELAY_SPREAD_MS;
  // The longest wait before a refresh request nothing took reloads the page.
  refreshSpreadMs = isTesting() ? 0 : REFRESH_SPREAD_MS;
  // How often the poll asks, and the first wait after a failure.
  timing: FeedTiming = {
    pollMs: POLL_INTERVAL_MS,
    retryFirstMs: RETRY_FIRST_MS,
  };
  // Reloads the page. A test stands in for it.
  reloadPage: () => void = () => window.location.reload();
  private refreshPending = false;

  private started = false;
  // Whether this tab opens the feeds: it holds the lock, or it has no other
  // tabs to share them with.
  private leading = false;
  private channel: TabChannel | undefined;
  private releaseLock: (() => void) | undefined;
  private abortLockRequest: AbortController | undefined;
  // The realms this tab's page watches.
  private watched = new Set<string>();
  // The last event id seen per realm, from this tab's feeds or the leader's,
  // so a tab that takes over resumes where the last leader stopped.
  private cursors = new Map<string, string>();
  private feeds = new Map<string, { stop: () => void }>();

  // Whether this host hears realm events through the event feeds.
  get listening(): boolean {
    return this.started;
  }

  // Starts listening for the realms the page watches. Idempotent. A page is
  // served whether or not it can be kept live, so a failure here leaves the
  // page as it is rather than failing the route that asked.
  start() {
    if (this.started || typeof window === 'undefined') {
      return;
    }
    try {
      this.joinTabs();
      this.messageService.onFirstSubscription((realm) => this.watch(realm));
      this.started = true;
    } catch (error) {
      console.warn('realm event feeds are unavailable', error);
    }
  }

  willDestroy() {
    for (let feed of this.feeds.values()) {
      feed.stop();
    }
    this.feeds.clear();
    this.abortLockRequest?.abort();
    this.releaseLock?.();
    this.channel?.close();
    this.channel = undefined;
    super.willDestroy();
  }

  private joinTabs() {
    let coordination = this.coordination;
    if (!coordination) {
      this.leading = true;
      return;
    }
    let channel = coordination.channel(COORDINATION_NAME);
    this.channel = channel;
    channel.addEventListener('message', (message) =>
      this.hear(message.data as TabMessage),
    );
    let abort = new AbortController();
    this.abortLockRequest = abort;
    coordination.locks
      .request(COORDINATION_NAME, { signal: abort.signal }, () => {
        if (this.isDestroying || this.isDestroyed) {
          return Promise.resolve();
        }
        this.abortLockRequest = undefined;
        this.lead();
        // Held until this tab goes away.
        return new Promise<void>((resolve) => {
          this.releaseLock = resolve;
        });
      })
      .catch(() => {
        // Aborted: this tab went away before it led.
      });
  }

  private lead() {
    this.leading = true;
    for (let realm of this.watched) {
      this.open(realm);
    }
    this.post({ type: 'leader' });
  }

  private hear(message: TabMessage) {
    if (this.isDestroying || this.isDestroyed || !message) {
      return;
    }
    switch (message.type) {
      case 'event':
        this.receive(message.realm, message.event, message.id);
        return;
      case 'watch':
        for (let [realm, id] of Object.entries(message.cursors ?? {})) {
          if (!this.cursors.has(realm)) {
            this.cursors.set(realm, id);
          }
        }
        if (this.leading) {
          for (let realm of message.realms) {
            this.open(realm);
          }
        }
        return;
      case 'leader':
        this.announceWatches();
        return;
    }
  }

  private watch(realm: string) {
    if (this.matrixService.isLoggedIn) {
      return;
    }
    this.watched.add(realm);
    if (this.leading) {
      this.open(realm);
    } else {
      this.announceWatches();
    }
  }

  private announceWatches() {
    if (this.watched.size === 0) {
      return;
    }
    this.post({
      type: 'watch',
      realms: [...this.watched],
      cursors: Object.fromEntries(this.cursors),
    });
  }

  private post(message: TabMessage) {
    try {
      this.channel?.postMessage(message);
    } catch {
      // A closed channel: this tab is going away.
    }
  }

  // Opens a realm's feed in this tab, which leads. A realm only another tab
  // watches stays open until this tab closes, since a tab that stops
  // watching says nothing.
  private open(realm: string) {
    if (this.feeds.has(realm)) {
      return;
    }
    let base = realmBase(realm);
    if (!base) {
      return;
    }
    let feedURL = new URL(EVENT_FEED_PATH, base).href;
    let deliver = (event: FeedEvent, id?: string) => {
      this.post({ type: 'event', realm, event, id });
      this.receive(realm, event, id);
    };
    let resumeFrom = this.cursors.get(realm);
    let feed =
      typeof EventSource === 'function'
        ? streamFeed(feedURL, resumeFrom, deliver, this.timing, () => {
            // The stream is unavailable here: fall back to the poll.
            this.feeds.get(realm)?.stop();
            this.feeds.set(
              realm,
              pollFeed(feedURL, this.cursors.get(realm), deliver, this.timing),
            );
          })
        : pollFeed(feedURL, resumeFrom, deliver, this.timing);
    this.feeds.set(realm, feed);
  }

  // An event, from this tab's feed or the leader's.
  private receive(realm: string, event: FeedEvent, id?: string) {
    if (id) {
      this.cursors.set(realm, id);
    }
    let base = this.watched.has(realm) ? realmBase(realm) : undefined;
    if (!base) {
      return;
    }
    if (event.kind === 'refresh') {
      this.refreshRequested(realm);
      return;
    }
    let relay = () => {
      if (!this.isDestroying && !this.isDestroyed) {
        this.relay(realm, base, event);
      }
    };
    let delay = Math.floor(Math.random() * this.relaySpreadMs);
    if (delay <= 0) {
      relay();
    } else {
      later(relay, delay);
    }
  }

  // Offers the page the refresh request, and reloads it when nothing took it.
  private refreshRequested(realm: string) {
    if (this.refreshPending) {
      return;
    }
    let reload = () => {
      if (!this.isDestroying && !this.isDestroyed) {
        this.reloadPage();
      }
    };
    let notice = new CustomEvent<RefreshRequestedDetail>(
      REFRESH_REQUESTED_EVENT,
      { cancelable: true, detail: { realm, reload } },
    );
    if (!window.dispatchEvent(notice)) {
      return;
    }
    this.refreshPending = true;
    let delay = Math.floor(Math.random() * this.refreshSpreadMs);
    if (delay <= 0) {
      reload();
    } else {
      later(reload, delay);
    }
  }

  private relay(realm: string, base: URL, event: FeedEvent) {
    if (event.kind === 'written') {
      // Announced when the write lands, before indexing: a read now would
      // find the revision before it, and the `indexed` event that follows
      // names the one to read.
      return;
    }
    let content: RealmEventContent;
    if (event.kind === 'reset') {
      content = { eventName: 'index', indexType: 'full', realmURL: realm };
    } else {
      let card = new URL(event.path, base).href;
      content = {
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [card],
        // The re-read asks for the card at this revision (ADR 020 §1.5).
        ...(event.rev ? { revisions: { [card]: event.rev } } : {}),
        realmURL: realm,
      };
    }
    this.messageService.relayRealmEvent(content);
  }
}

function realmBase(realm: string): URL | undefined {
  let base: URL;
  try {
    base = new URL(realm.endsWith('/') ? realm : `${realm}/`);
  } catch {
    return undefined;
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    return undefined;
  }
  return base;
}

// An event id is `<epoch>:<seq>`, as the realm sends it.
function parseEventId(
  id: string | undefined,
): { epoch: string; seq: number } | undefined {
  let [epoch, seqText] = (id ?? '').split(':');
  let seq = Number(seqText);
  return epoch && Number.isInteger(seq) ? { epoch, seq } : undefined;
}

function streamFeed(
  url: string,
  resumeFrom: string | undefined,
  deliver: (event: FeedEvent, id?: string) => void,
  timing: FeedTiming,
  unavailable: () => void,
): { stop: () => void } {
  // A tab taking over from another resumes from the last id the tabs saw.
  // The browser sends `Last-Event-ID` only on its own reconnects, so a
  // request this client opens names it in the query, which the realm also
  // reads.
  let lastId = resumeFrom;
  let everOpened = false;
  let failures = 0;
  let stopped = false;
  let source: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let open = () => {
    if (stopped) {
      return;
    }
    let current = new EventSource(
      lastId ? `${url}?lastEventId=${encodeURIComponent(lastId)}` : url,
    );
    source = current;
    current.addEventListener('open', () => {
      everOpened = true;
      failures = 0;
    });
    current.addEventListener('change', (message) => {
      let { data, lastEventId } = message as MessageEvent;
      let event = parseEvent(data);
      if (event) {
        lastId = lastEventId || lastId;
        deliver(event, lastEventId || undefined);
      }
    });
    current.addEventListener('error', () => {
      // A dropped connection the browser is retrying stays CONNECTING. One it
      // gave up on is CLOSED: an HTTP error on a reconnect (a deploy's 502, a
      // 429), or a realm that never offered a stream.
      if (current.readyState !== EventSource.CLOSED || stopped) {
        return;
      }
      if (!everOpened) {
        // Never connected: the realm doesn't stream here, so poll instead.
        unavailable();
        return;
      }
      // It streamed before, so it should again: reopen from the last id,
      // waiting longer after each failure.
      failures++;
      timer = setTimeout(open, backoff(failures, timing));
    });
  };
  open();
  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
    },
  };
}

function pollFeed(
  url: string,
  resumeFrom: string | undefined,
  deliver: (event: FeedEvent, id?: string) => void,
  timing: FeedTiming,
): { stop: () => void } {
  // Resuming from another tab's last id compares the first answer against it
  // rather than adopting it as where this page starts.
  let cursor = parseEventId(resumeFrom);
  let epoch = cursor?.epoch;
  let seen = cursor?.seq ?? 0;
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll = async () => {
    let wait = timing.pollMs;
    try {
      let response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (stopped) {
        return;
      }
      if ([401, 403, 404].includes(response.status)) {
        // The realm refuses this page its feed, or has none: asking again
        // changes nothing, and each ask spends the visitor's budget.
        stopped = true;
        return;
      }
      if (!response.ok) {
        failures++;
        wait = retryAfterMs(response) ?? backoff(failures, timing);
      } else {
        failures = 0;
        let answer = (await response.json()) as FeedEventWindow;
        let idOf = (seq: number) => `${answer.epoch}:${seq}`;
        if (epoch === undefined) {
          // The first answer sets where this page starts from.
          epoch = answer.epoch;
          seen = answer.head;
        } else if (
          answer.epoch !== epoch ||
          (answer.events[0] && answer.events[0].seq > seen + 1)
        ) {
          // The realm restarted, or more changed than the window holds.
          epoch = answer.epoch;
          seen = answer.head;
          deliver({ seq: answer.head, kind: 'reset', path: '' }, idOf(seen));
        } else {
          for (let event of answer.events) {
            if (event.seq > seen) {
              seen = event.seq;
              deliver(event, idOf(event.seq));
            }
          }
        }
      }
    } catch {
      // Offline for a moment: wait longer each time it keeps failing.
      failures++;
      wait = backoff(failures, timing);
    }
    if (!stopped) {
      timer = setTimeout(poll, wait);
    }
  };
  void poll();
  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

function parseEvent(data: unknown): FeedEvent | undefined {
  if (typeof data !== 'string') {
    return undefined;
  }
  try {
    let event = JSON.parse(data) as FeedEvent;
    return typeof event.path === 'string' && typeof event.kind === 'string'
      ? event
      : undefined;
  } catch {
    return undefined;
  }
}

declare module '@ember/service' {
  interface Registry {
    'event-feed': EventFeedService;
  }
}
