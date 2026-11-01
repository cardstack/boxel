import Service, { service } from '@ember/service';

import {
  PUBLIC_EVENTS_PATH,
  type PublicEventWindow,
  type PublicRealmEvent,
} from '@cardstack/runtime-common';

import type MatrixService from './matrix-service';
import type MessageService from './message-service';
import type { RealmEventContent } from '@cardstack/base/matrix-event';

// Realm events for a session that has no Matrix to hear them through: a
// visitor of a published site who isn't signed in. Each realm the page starts
// watching gets the realm's public change feed (ADR 020), and each change is
// relayed through MessageService as the incremental index event Matrix would
// have delivered, so the store, live searches and resources stay current with
// no second mechanism (ADR 020 §1.6).
//
// The feed is a stream where the realm offers one, and the realm's cacheable
// poll where it doesn't or the stream won't connect.

const POLL_INTERVAL_MS = 3_000;

export default class PublicRealmEventsService extends Service {
  @service declare private messageService: MessageService;
  @service declare private matrixService: MatrixService;

  private started = false;
  private feeds = new Map<string, { stop: () => void }>();

  // Whether this host hears realm events through the public feeds.
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
      this.messageService.onFirstSubscription((realm) => this.open(realm));
      this.started = true;
    } catch (error) {
      console.warn('public realm events are unavailable', error);
    }
  }

  willDestroy() {
    for (let feed of this.feeds.values()) {
      feed.stop();
    }
    this.feeds.clear();
    super.willDestroy();
  }

  private open(realm: string) {
    if (this.matrixService.isLoggedIn || this.feeds.has(realm)) {
      return;
    }
    let base: URL;
    try {
      base = new URL(realm.endsWith('/') ? realm : `${realm}/`);
    } catch {
      return;
    }
    if (base.protocol !== 'http:' && base.protocol !== 'https:') {
      return;
    }
    let feedURL = new URL(PUBLIC_EVENTS_PATH, base).href;
    let relay = (event: PublicRealmEvent) => this.relay(realm, base, event);
    let feed =
      typeof EventSource === 'function'
        ? streamFeed(feedURL, relay, () => {
            // The stream is unavailable here: fall back to the poll.
            this.feeds.get(realm)?.stop();
            this.feeds.set(realm, pollFeed(feedURL, relay));
          })
        : pollFeed(feedURL, relay);
    this.feeds.set(realm, feed);
  }

  private relay(realm: string, base: URL, event: PublicRealmEvent) {
    let content: RealmEventContent =
      event.kind === 'reset'
        ? { eventName: 'index', indexType: 'full', realmURL: realm }
        : {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [new URL(event.path, base).href],
            realmURL: realm,
          };
    this.messageService.relayRealmEvent(content);
  }
}

function streamFeed(
  url: string,
  relay: (event: PublicRealmEvent) => void,
  unavailable: () => void,
): { stop: () => void } {
  let source = new EventSource(url);
  let opened = false;
  source.addEventListener('open', () => {
    opened = true;
  });
  source.addEventListener('change', (message) => {
    let event = parseEvent((message as MessageEvent).data);
    if (event) {
      relay(event);
    }
  });
  source.addEventListener('error', () => {
    // A stream that never opened, and that the browser gave up on, is one
    // the realm doesn't offer. One that dropped later reconnects by itself
    // and resumes from its last event id.
    if (!opened && source.readyState === EventSource.CLOSED) {
      unavailable();
    }
  });
  return { stop: () => source.close() };
}

function pollFeed(
  url: string,
  relay: (event: PublicRealmEvent) => void,
): { stop: () => void } {
  let epoch: string | undefined;
  let seen = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll = async () => {
    try {
      let response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        let answer = (await response.json()) as PublicEventWindow;
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
          relay({ seq: answer.head, kind: 'reset', path: '' });
        } else {
          for (let event of answer.events) {
            if (event.seq > seen) {
              seen = event.seq;
              relay(event);
            }
          }
        }
      }
    } catch {
      // offline for a moment: the next poll asks again
    }
    if (!stopped) {
      timer = setTimeout(poll, POLL_INTERVAL_MS);
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

function parseEvent(data: unknown): PublicRealmEvent | undefined {
  if (typeof data !== 'string') {
    return undefined;
  }
  try {
    let event = JSON.parse(data) as PublicRealmEvent;
    return typeof event.path === 'string' && typeof event.kind === 'string'
      ? event
      : undefined;
  } catch {
    return undefined;
  }
}

declare module '@ember/service' {
  interface Registry {
    'public-realm-events': PublicRealmEventsService;
  }
}
