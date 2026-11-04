// The main loop. A task waits for a shard lease, listens for journal wakeups,
// loads the realms of the shards it holds, and consumes their events on each
// wakeup or every second, beating the heartbeat on every turn and between
// events so the health endpoint reports it alive while it waits as well as
// while it catches up.
//
// The loop exits rather than run degraded: a lost lease, a query that fails
// or a loss of the listening connection the adapter can't re-establish ends
// `run()` with the error, and the process exits non-zero. A stop request
// finishes the event in progress, releases the lease and ends `run()` without
// error.

import { mkdir } from 'node:fs/promises';
import { logger, REALM_CHANGE_EVENTS_CHANNEL } from '@cardstack/runtime-common';
import type { PgAdapter, NotificationSubscription } from '@cardstack/postgres';
import { LeaseManager, shardOf, type LeaseOptions } from './lease.ts';
import {
  Consumer,
  currentHorizon,
  positionOfCursors,
  type RealmRecorder,
} from './consumer.ts';
import { cursorsOf, loadRecordedRealms, type RecordedRealm } from './realms.ts';
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
  // The shards whose realms the consumer's position accounts for.
  #loadedShards = new Set<number>();
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

  // Asks the loop to finish the event in progress, release the lease and
  // exit. Resolves when `run()` has settled.
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
      await this.#lease.start(
        (error) => this.#fail(error),
        () => this.#wakeUp(),
      );
      subscription = await db.subscribe(
        REALM_CHANGE_EVENTS_CHANNEL,
        (notification) => this.#onNotification(notification.payload ?? ''),
        // Wakeups sent while the connection was down are lost, among them
        // the first wakeup of a realm enabled meanwhile: load the realms
        // again and poll.
        {
          onReconnect: () => {
            this.#realmsStale = true;
            this.#wakeUp();
          },
        },
      );
      log.info(
        `${lease.holder} running, ${lease.shardCount} shard(s) across ${lease.taskCount} task(s)`,
      );
      while (this.#running()) {
        this.#options.heartbeat.beat();
        if (this.#lease.held.length > 0) {
          if (this.#realmsStale || this.#shardsChanged()) {
            await this.#loadRealms();
          }
          await this.#consumer!.poll(() => {
            this.#options.heartbeat.beat();
            return this.#running();
          });
        }
        if (this.#running()) {
          await this.#sleep(pollMs);
        }
      }
      if (this.#failure) {
        throw this.#failure;
      }
    } finally {
      await subscription?.unsubscribe();
      await this.#lease.stop();
    }
  }

  #running(): boolean {
    return !this.#stopped && !this.#failure;
  }

  #shardsChanged(): boolean {
    let held = this.#lease.held;
    return (
      held.length !== this.#loadedShards.size ||
      held.some((shard) => !this.#loadedShards.has(shard))
    );
  }

  // Loads the realms of the held shards. The consumer's position only
  // advances, with one exception: a shard gained while the task runs brings
  // realms whose cursors may lie behind the position, so the position moves
  // back to the lowest of them, and their recorders ignore what they already
  // recorded. A realm enabled in a shard the task already held starts from
  // the events after the position; its earlier history is the backfill's.
  async #loadRealms(): Promise<void> {
    let { db, realmsRoot, lease } = this.#options;
    let held = this.#lease.held;
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
    if (!this.#consumer) {
      let cursors = cursorsOf(this.#realms.values());
      let position =
        cursors.length > 0
          ? await positionOfCursors(db, cursors)
          : { xid: await currentHorizon(db), seq: 0 };
      this.#consumer = new Consumer(
        { db, recorderFor: (realmId) => this.#recorderFor(realmId) },
        position,
      );
      log.info(
        `recording ${this.#realms.size} realm(s) from xid ${position.xid}, seq ${position.seq}`,
      );
    } else {
      let gained = [...this.#realms.values()].filter(
        (realm) => !this.#loadedShards.has(realm.shard),
      );
      if (gained.length > 0) {
        this.#consumer.rewindTo(await positionOfCursors(db, cursorsOf(gained)));
      }
      log.info(`recording ${this.#realms.size} realm(s)`);
    }
    this.#loadedShards = new Set(held);
  }

  // A realm the task has not loaded, in a shard it holds, is a realm enabled
  // since the last load: the realms are loaded again before its event is
  // given up on.
  async #recorderFor(realmId: string): Promise<RealmRecorder | undefined> {
    let realm = this.#realms.get(realmId);
    if (
      !realm &&
      this.#lease.holds(shardOf(realmId, this.#options.lease.shardCount))
    ) {
      await this.#loadRealms();
      realm = this.#realms.get(realmId);
    }
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
  // when the realm's shard is held.
  #onNotification(payload: string): void {
    if (
      payload !== '' &&
      !this.#lease.holds(shardOf(payload, this.#options.lease.shardCount))
    ) {
      return;
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
