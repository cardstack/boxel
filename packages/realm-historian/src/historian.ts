// The main loop. A task waits for a shard lease, listens for journal wakeups,
// loads the realms of the shards it holds, and consumes their events on each
// wakeup or every second, beating the heartbeat on every turn so the health
// endpoint reports it alive while it waits as well as while it records.
//
// The loop exits rather than run degraded: a lost lease, a query that fails
// or a loss of the listening connection the adapter can't re-establish ends
// `run()` with the error, and the process exits non-zero. A stop request
// finishes the turn in progress, releases the lease and ends `run()` without
// error.

import { mkdir } from 'node:fs/promises';
import { logger, REALM_CHANGE_EVENTS_CHANNEL } from '@cardstack/runtime-common';
import type { PgAdapter, NotificationSubscription } from '@cardstack/postgres';
import { LeaseManager, shardOf, type LeaseOptions } from './lease.ts';
import { Consumer, journalTail, type RealmRecorder } from './consumer.ts';
import {
  loadRecordedRealms,
  lowestCursor,
  type RecordedRealm,
} from './realms.ts';
import type { Heartbeat } from './health.ts';

const log = logger('realm-historian');

export interface HistorianOptions {
  db: PgAdapter;
  historyRoot: string;
  realmsRoot: string;
  lease: LeaseOptions;
  heartbeat: Heartbeat;
  // How long the loop waits for a wakeup before polling anyway.
  pollMs?: number;
  // The recorder for a realm this task records. The default records nothing
  // and logs each event.
  recorderFor?: (realm: RecordedRealm) => RealmRecorder;
}

const DEFAULT_POLL_MS = 1000;

export class Historian {
  #options: HistorianOptions;
  #lease: LeaseManager;
  #realms = new Map<string, RecordedRealm>();
  #recorders = new Map<string, RealmRecorder>();
  #realmsStale = true;
  #consumer: Consumer | undefined;
  #stopped = false;
  #failure: Error | undefined;
  #wake: (() => void) | undefined;
  #done: Promise<void> | undefined;

  constructor(options: HistorianOptions) {
    this.#options = options;
    this.#lease = new LeaseManager(options.db, options.lease);
  }

  // The shards the task holds.
  get held(): number[] {
    return this.#lease.held;
  }

  // The realms the task records, by registry id.
  get realms(): ReadonlyMap<string, RecordedRealm> {
    return this.#realms;
  }

  // Runs until `stop()` or a failure. Resolves after a stop has released the
  // lease; rejects with the failure otherwise.
  run(): Promise<void> {
    if (!this.#done) {
      this.#done = this.#run();
    }
    return this.#done;
  }

  // Asks the loop to finish its turn, release the lease and exit. Resolves
  // when `run()` has settled.
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#wakeUp();
    try {
      await this.#done;
    } catch {
      // The failure is reported through run().
    }
  }

  async #run(): Promise<void> {
    let { db, historyRoot, lease, pollMs = DEFAULT_POLL_MS } = this.#options;
    await mkdir(historyRoot, { recursive: true });
    let subscription: NotificationSubscription | undefined;
    try {
      await this.#lease.start((error) => this.#fail(error));
      subscription = await db.subscribe(
        REALM_CHANGE_EVENTS_CHANNEL,
        (notification) => this.#onNotification(notification.payload ?? ''),
        // Wakeups sent while the connection was down are lost; a poll
        // reads whatever they announced.
        { onReconnect: () => this.#wakeUp() },
      );
      log.info(
        `${lease.holder} running, ${lease.shardCount} shard(s) across ${lease.taskCount} task(s)`,
      );
      let heldBefore = '';
      while (!this.#stopped && !this.#failure) {
        this.#options.heartbeat.beat();
        let held = this.#lease.held.join(',');
        if (held !== heldBefore) {
          this.#realmsStale = true;
          heldBefore = held;
        }
        if (held !== '') {
          if (this.#realmsStale) {
            await this.#loadRealms();
          }
          await this.#consumer!.poll();
        }
        await this.#sleep(pollMs);
      }
      if (this.#failure) {
        throw this.#failure;
      }
    } finally {
      await subscription?.unsubscribe();
      await this.#lease.stop();
    }
  }

  async #loadRealms(): Promise<void> {
    let { db, realmsRoot, lease } = this.#options;
    this.#realms = await loadRecordedRealms({
      db,
      realmsRoot,
      shardCount: lease.shardCount,
      holds: (shard) => this.#lease.holds(shard),
    });
    for (let id of this.#recorders.keys()) {
      if (!this.#realms.has(id)) {
        this.#recorders.delete(id);
      }
    }
    this.#realmsStale = false;
    // The read position only advances: a realm enabled while the task runs
    // starts from the events after the position, and its earlier history is
    // the backfill's.
    if (!this.#consumer) {
      let readPosition =
        lowestCursor(this.#realms.values()) ?? (await journalTail(db));
      this.#consumer = new Consumer(
        { db, recorderFor: (realmId) => this.#recorderFor(realmId) },
        readPosition,
      );
      log.info(
        `recording ${this.#realms.size} realm(s) from seq ${readPosition}`,
      );
    } else {
      log.info(`recording ${this.#realms.size} realm(s)`);
    }
  }

  #recorderFor(realmId: string): RealmRecorder | undefined {
    let realm = this.#realms.get(realmId);
    if (!realm) {
      return undefined;
    }
    let recorder = this.#recorders.get(realmId);
    if (!recorder) {
      recorder = this.#options.recorderFor
        ? this.#options.recorderFor(realm)
        : loggingRecorder(realm);
      this.#recorders.set(realmId, recorder);
    }
    return recorder;
  }

  // An empty payload wakes the task. A payload naming a realm wakes it only
  // when the realm's shard is held; a realm the task has not loaded is a
  // realm enabled since the last load, so the realms are loaded again first.
  #onNotification(payload: string): void {
    if (payload !== '') {
      if (
        !this.#lease.holds(shardOf(payload, this.#options.lease.shardCount))
      ) {
        return;
      }
      if (!this.#realms.has(payload)) {
        this.#realmsStale = true;
      }
    }
    this.#wakeUp();
  }

  #fail(error: Error): void {
    this.#failure ??= error;
    this.#wakeUp();
  }

  #wakeUp(): void {
    this.#wake?.();
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let finish = () => {
        clearTimeout(timer);
        this.#wake = undefined;
        resolve();
      };
      let timer = setTimeout(finish, ms);
      this.#wake = finish;
    });
  }
}

// The recorder of a task that records nothing yet: it logs each event.
function loggingRecorder(realm: RecordedRealm): RealmRecorder {
  return {
    async record(event) {
      log.debug(
        `event ${event.seq} for ${realm.url}: ${event.changes.length} change(s) by ${event.author} on ${event.channel}`,
      );
    },
  };
}
