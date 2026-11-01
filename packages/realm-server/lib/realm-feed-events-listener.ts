import type { Realm } from '@cardstack/runtime-common';
import { logger, REALM_FEED_EVENTS_CHANNEL } from '@cardstack/runtime-common';
import type { PgAdapter, NotificationSubscription } from '@cardstack/postgres';

const log = logger('realm-server:feed-events-listener');

// The event feed's cross-process delivery (ADR 020 §1.3). Every process
// serving a realm appends to the one stored sequence, and each append
// notifies `REALM_FEED_EVENTS_CHANNEL` with the realm's URL inside its
// transaction. A process that hears it reads what it hasn't seen from the
// store and passes it to its own subscribers, so a client connected here
// hears a change another process announced, at the same position.
//
// The listener runs no periodic work: a realm's feed reads by position, so
// a notification that coalesces several appends is caught up in one read.
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
    this.#subscription = undefined;
    await sub?.unsubscribe();
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
      this.#catchUp(realm);
    }
  }

  #handleNotification(payload: string | undefined): void {
    const realmURL = payload?.trim();
    if (!realmURL) {
      return;
    }
    const realm = this.#deps.lookupMountedRealm(realmURL);
    if (realm) {
      this.#catchUp(realm);
    }
  }

  #catchUp(realm: Realm): void {
    realm.catchUpEventFeed().catch((err: unknown) => {
      log.warn(`event feed catch-up failed for ${realm.url}: ${String(err)}`);
    });
  }
}
