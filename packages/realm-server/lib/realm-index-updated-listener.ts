import type { Realm } from '@cardstack/runtime-common';
import { logger, REALM_INDEX_UPDATED_CHANNEL } from '@cardstack/runtime-common';
import type { PgAdapter, NotificationSubscription } from '@cardstack/postgres';

const log = logger('realm-server:index-updated-listener');

// CS-11119: cross-instance invalidation for
// RealmIndexQueryEngine.#inFlightSearch. When any realm-server commits a
// boxel_index update (worker's batch.done() lands on the shared table),
// it emits `NOTIFY realm_index_updated, '<realmURL>'` (see
// Realm.clearRealmIndexCachesAndBroadcast in runtime-common/realm.ts).
// Every listener on this channel looks up the realm URL in its lookup
// function; if mounted locally, calls `realm.clearRealmIndexCaches()` so a
// new caller arriving after the peer's update doesn't coalesce into a
// pre-update pending promise. If the realm isn't mounted on this
// instance, the notification is dropped — there's no #inFlightSearch
// state here to clear.
//
// Separate from REALM_FILE_CHANGES_CHANNEL because the two channels
// signal different lifecycle events:
//   - realm_file_changes fires at file-WRITE time (before indexing)
//     and drives byte-cache invalidation (#sourceCache / #moduleCache).
//   - realm_index_updated fires at INDEX-UPDATE time (after the worker's
//     batch.done() commits boxel_index) and drives in-flight-search
//     coalesce-map clearing.
// Mixing them would either fire too early (write-time clears against
// unchanged boxel_index do nothing useful) or conflate two layers with
// different correctness contracts.
//
// The LISTEN is backed by `PgAdapter.subscribe` (shared multiplexed
// notification client). No periodic work between notifications — the
// whole dispatch is in the payload — so we don't keep a WorkLoop here.
export interface RealmIndexUpdatedListenerDeps {
  dbAdapter: PgAdapter;
  lookupMountedRealm: (url: string) => Realm | undefined;
}

export class RealmIndexUpdatedListener {
  #deps: RealmIndexUpdatedListenerDeps;
  #subscription?: NotificationSubscription;
  #starting?: Promise<void>;

  constructor(deps: RealmIndexUpdatedListenerDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    if (this.#subscription || this.#starting) {
      await this.#starting;
      return;
    }
    this.#starting = (async () => {
      this.#subscription = await this.#deps.dbAdapter.subscribe(
        REALM_INDEX_UPDATED_CHANNEL,
        (notification) => {
          this.#handleNotification(notification.payload);
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
    // Mirrors RealmFileChangesListener.shutDown: wait for any in-flight
    // start() to finish wiring up #subscription before tearing down,
    // otherwise a racing start() can install a live subscription after
    // we thought we were shut down. Swallow start() errors — if startup
    // failed, there's nothing for us to unsubscribe.
    try {
      await this.#starting;
    } catch {
      // ignore
    }
    const sub = this.#subscription;
    this.#subscription = undefined;
    await sub?.unsubscribe();
  }

  // Exposed for tests; invoked internally by the LISTEN handler.
  handleNotification(payload: string | undefined): void {
    this.#handleNotification(payload);
  }

  #handleNotification(payload: string | undefined): void {
    if (!payload) {
      return;
    }
    const realmURL = payload.trim();
    if (!realmURL) {
      log.warn(`ignoring empty realm_index_updated payload`);
      return;
    }
    const realm = this.#deps.lookupMountedRealm(realmURL);
    if (!realm) {
      // Not mounted on this instance — nothing to clear.
      return;
    }
    try {
      realm.clearRealmIndexCaches();
    } catch (err: unknown) {
      log.warn(`clearRealmIndexCaches failed for ${realmURL}: ${String(err)}`);
    }
  }
}
