import type { Realm } from '@cardstack/runtime-common';
import {
  logger,
  parseFeedKey,
  REALM_FEED_EVENTS_CHANNEL,
  REALM_PRESENCE_CHANNEL,
  type PresenceNotice,
} from '@cardstack/runtime-common';
import type { PgAdapter, NotificationSubscription } from '@cardstack/postgres';

const log = logger('realm-server:feed-events-listener');

// The event feed's cross-process delivery (ADR 020 §1.3). Every process
// serving a realm appends to the one stored sequence, and each append
// notifies `REALM_FEED_EVENTS_CHANNEL` with the feed's key inside its
// transaction: the realm's URL, or the realm's URL and a card's path for that
// card's live channel. A process that hears it reads what it hasn't seen from the
// store and passes it to its own subscribers, so a client connected here
// hears a change another process announced, at the same position.
//
// The listener runs no periodic work: a realm's feed reads by position, so
// a notification that coalesces several appends is caught up in one read.
//
// Presence (ADR 020 §1.8) has no position to catch up from, so its
// notification carries the message itself on `REALM_PRESENCE_CHANNEL`, and
// a process that hears it passes it to that channel's followers here. One
// missed while the connection was down is not recovered: the next heartbeat
// supersedes it.
export interface RealmFeedEventsListenerDeps {
  dbAdapter: PgAdapter;
  lookupMountedRealm: (url: string) => Realm | undefined;
  // Every realm mounted here, for catching up after the notification
  // connection reconnects.
  listMountedRealms: () => readonly Realm[];
}

export class RealmFeedEventsListener {
  #deps: RealmFeedEventsListenerDeps;
  #subscription?: NotificationSubscription;
  #presenceSubscription?: NotificationSubscription;
  #starting?: Promise<void>;

  constructor(deps: RealmFeedEventsListenerDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    if (this.#subscription || this.#starting) {
      await this.#starting;
      return;
    }
    this.#starting = (async () => {
      this.#subscription = await this.#deps.dbAdapter.subscribe(
        REALM_FEED_EVENTS_CHANNEL,
        (notification) => {
          this.#handleNotification(notification.payload);
        },
        { onReconnect: () => this.#handleReconnect() },
      );
      this.#presenceSubscription = await this.#deps.dbAdapter.subscribe(
        REALM_PRESENCE_CHANNEL,
        (notification) => {
          this.#handlePresence(notification.payload);
        },
      );
    })();
    try {
      await this.#starting;
    } finally {
      this.#starting = undefined;
    }
  }

  async shutDown(): Promise<void> {
    try {
      await this.#starting;
    } catch {
      // a start that failed left nothing to unsubscribe
    }
    const sub = this.#subscription;
    const presence = this.#presenceSubscription;
    this.#subscription = undefined;
    this.#presenceSubscription = undefined;
    await Promise.all([sub?.unsubscribe(), presence?.unsubscribe()]);
  }

  // Exposed for tests; invoked internally by the presence LISTEN handler.
  handlePresence(payload: string | undefined): void {
    this.#handlePresence(payload);
  }

  #handlePresence(payload: string | undefined): void {
    let notice: PresenceNotice;
    try {
      notice = JSON.parse(payload ?? '') as PresenceNotice;
    } catch {
      return;
    }
    if (typeof notice?.key !== 'string') {
      return;
    }
    const realm = this.#deps.lookupMountedRealm(
      parseFeedKey(notice.key).realmURL,
    );
    realm?.deliverPresence(notice).catch((err: unknown) => {
      log.warn(`presence delivery failed for ${notice.key}: ${String(err)}`);
    });
  }

  // Exposed for tests; invoked internally by the LISTEN handler.
  handleNotification(payload: string | undefined): void {
    this.#handleNotification(payload);
  }

  // Exposed for tests; invoked internally after the notification connection
  // reconnects.
  handleReconnect(): void {
    this.#handleReconnect();
  }

  // Appends made while the connection was down notified nobody here. Each
  // mounted realm reads from the last position it holds, which finds them.
  #handleReconnect(): void {
    for (const realm of this.#deps.listMountedRealms()) {
      realm.catchUpAllEventFeeds().catch((err: unknown) => {
        log.warn(`event feed catch-up failed for ${realm.url}: ${String(err)}`);
      });
    }
  }

  #handleNotification(payload: string | undefined): void {
    const key = payload?.trim();
    if (!key) {
      return;
    }
    const realm = this.#deps.lookupMountedRealm(parseFeedKey(key).realmURL);
    realm?.catchUpEventFeed(key).catch((err: unknown) => {
      log.warn(`event feed catch-up failed for ${key}: ${String(err)}`);
    });
  }
}
