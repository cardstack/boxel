// The main loop. A task waits for a shard lease, listens for journal wakeups,
// loads the realms of the shards it holds, and consumes their events on each
// wakeup or every second, handing each to its realm's recorder. It beats the
// heartbeat on every turn, between events, after each query of a realm load,
// and whenever a recorder reports progress, so the health endpoint reports it
// alive while it waits, while it catches up and while it records one large
// event, and reports it stalled only when no step finishes.
//
// After a turn that has read every event below the horizon, the loop ticks
// every recorder, so a recorder can close a group whose deadline has passed.
// A realm's tick must be a time by which every event of the realm with an
// earlier `occurred_at` is in hand. It is the database's time from before
// that read, less a grace period, or the `occurred_at` of the realm's
// earliest event that has committed but is still unread, when that is
// earlier: a transaction still in progress elsewhere holds the horizon below
// such an event. An event whose transaction hasn't committed is in hand by
// then unless the transaction stayed open past the grace period.
//
// The recorders share one semaphore, which caps how many do I/O at once, and
// a recorder with nothing uncommitted is dropped once it has been idle for a
// while.
//
// Background work, such as reconcile passes and maintenance, is scheduled
// per realm by `background.ts` over the realms the task loaded, and runs in
// each realm's recorder at its own, lower concurrency. After every turn the
// loop starts whatever work has come due; a realm with work due and no
// recorder gets one.
//
// The loop exits rather than run degraded: a lost lease or a query that fails
// ends `run()` with the error, and the process exits non-zero. A lost
// listening connection doesn't: the adapter reopens it with backoff, and
// until then the loop still polls every `pollMs`, so events are read late
// rather than missed. A database that stays unreachable ends `run()` through
// the lease, whose renewals fail. A stop request finishes the event in
// progress, releases the lease and ends `run()` without error.

import { mkdir } from 'node:fs/promises';
import {
  logger,
  REALM_CHANGE_EVENTS_CHANNEL,
  type ChangeEvent,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type { PgAdapter, NotificationSubscription } from '@cardstack/postgres';
import { LeaseManager, shardOf, type LeaseOptions } from './lease.ts';
import { Consumer, currentHorizon, positionOfCursors } from './consumer.ts';
import { cursorsOf, loadRecordedRealms, type RecordedRealm } from './realms.ts';
import type { Heartbeat } from './health.ts';
import {
  DEFAULT_IO_CONCURRENCY,
  Recorder,
  type ManagedRecorder,
} from './recorder.ts';
import { Semaphore } from './semaphore.ts';
import type { GroupingLimits } from './grouper.ts';
import { BackgroundScheduler, type BackgroundOptions } from './background.ts';

const log = logger('realm-historian');

export interface HistorianOptions {
  db: PgAdapter;
  historyRoot: string;
  realmsRoot: string;
  lease: LeaseOptions;
  heartbeat: Heartbeat;
  // How long the loop waits for a wakeup before polling anyway.
  pollMs?: number;
  recording?: RecordingOptions;
  // The kinds of background work and how many jobs run at once.
  background?: BackgroundOptions;
  // The recorder for a realm this task records, in place of the default
  // `Recorder`. `beat` beats the heartbeat: a recorder whose work can outlast
  // the health endpoint's stale threshold calls it as it makes progress,
  // such as after each object it writes, so the endpoint tells a large event
  // from a stall without a threshold long enough to hide a real one.
  // `onCommits` counts the revisions committed to the realm, for background
  // work that comes due by commits (`RecorderOptions.onCommits`).
  recorderFor?: (
    realm: RecordedRealm,
    beat: () => void,
    onCommits: (count: number) => void,
  ) => ManagedRecorder;
}

export interface RecordingOptions {
  // The grouping limits every recorder uses.
  limits?: GroupingLimits;
  // How many recorders do I/O at once.
  ioConcurrency?: number;
  // How far behind the database's clock a tick runs: the longest a write's
  // transaction is expected to stay open between taking its `occurred_at`
  // and committing its event.
  clockGraceMs?: number;
  // How long a recorder with nothing uncommitted is kept.
  idleAfterMs?: number;
  // Appended changes to files larger than this become size-only entries.
  sizeOnlyThresholdBytes?: number;
}

const DEFAULT_POLL_MS = 1000;
const DEFAULT_CLOCK_GRACE_MS = 1000;
const DEFAULT_IDLE_AFTER_MS = 5 * 60_000;

export class Historian {
  #options: HistorianOptions;
  #lease: LeaseManager;
  #realms = new Map<string, RecordedRealm>();
  #recorders = new Map<string, ManagedRecorder>();
  // The stops of recorders dropped while the task runs, which shutdown waits
  // for too.
  #stopping = new Set<Promise<void>>();
  #io: Semaphore;
  #background: BackgroundScheduler;
  // The shards whose realms the consumer's position accounts for.
  #loadedShards = new Set<number>();
  // The horizon taken before the realms were last loaded: every event below
  // it had committed when they were read.
  #loadedBelow = 0n;
  #realmsStale = true;
  #consumer: Consumer | undefined;
  #stopped = false;
  #failure: Error | undefined;
  #wake: (() => void) | undefined;
  // A wakeup that came while the loop was busy, so the next sleep is skipped.
  #wakePending = false;
  #done: Promise<void> | undefined;

  constructor(options: HistorianOptions) {
    this.#options = options;
    this.#lease = new LeaseManager(options.db, options.lease);
    this.#io = new Semaphore(
      options.recording?.ioConcurrency ?? DEFAULT_IO_CONCURRENCY,
    );
    this.#background = new BackgroundScheduler({
      ...options.background,
      recorderFor: (realm) => this.#recorderOf(realm),
    });
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
        this.#wakePending = false;
        if (this.#lease.held.length > 0) {
          if (this.#realmsStale || this.#shardsChanged()) {
            await this.#loadRealms();
          }
          let readFrom = await databaseTime(db);
          await this.#consumer!.poll(() => {
            this.#options.heartbeat.beat();
            return this.#running();
          });
          if (this.#running() && this.#recorders.size > 0) {
            this.#tickRecorders(
              readFrom,
              await this.#consumer!.earliestUnread(),
            );
          }
          if (this.#running()) {
            this.#background.dispatch();
          }
        }
        if (this.#running()) {
          await this.#sleep(pollMs);
        }
      }
      if (this.#failure) {
        throw this.#failure;
      }
    } finally {
      // Each recorder finishes the commit in progress while the task still
      // holds the lease its cursor update checks. Stopping a recorder aborts
      // its background job, which the scheduler waits for.
      let background = this.#background.stop();
      for (let [id, recorder] of this.#recorders) {
        this.#drop(id, recorder);
      }
      await Promise.all([background, ...this.#stopping]);
      // An unsubscribe that fails, as it can when the database is gone, is
      // logged rather than thrown: the lease is released either way, and the
      // failure that ended the loop stays the one `run()` reports.
      try {
        await subscription?.unsubscribe();
      } catch (error) {
        log.warn(
          `unsubscribing from ${REALM_CHANGE_EVENTS_CHANNEL} failed: ${String(error)}`,
        );
      }
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
    let { db, realmsRoot, lease, heartbeat } = this.#options;
    let held = new Set(this.#lease.held);
    let horizon = await currentHorizon(db);
    heartbeat.beat();
    this.#realms = await loadRecordedRealms({
      db,
      realmsRoot,
      shardCount: lease.shardCount,
      holds: (shard) => held.has(shard),
    });
    heartbeat.beat();
    this.#loadedBelow = BigInt(horizon);
    for (let [id, recorder] of this.#recorders) {
      if (!this.#realms.has(id)) {
        this.#drop(id, recorder);
      }
    }
    this.#background.setRealms(this.#realms);
    this.#realmsStale = false;
    if (!this.#consumer) {
      let cursors = cursorsOf(this.#realms.values());
      let position =
        cursors.length > 0
          ? positionOfCursors(cursors)
          : { xid: horizon, seq: 0 };
      this.#consumer = new Consumer(
        { db, recorderFor: (event) => this.#recorderFor(event) },
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
        this.#consumer.rewindTo(positionOfCursors(cursorsOf(gained)));
      }
      log.info(`recording ${this.#realms.size} realm(s)`);
    }
    this.#loadedShards = held;
  }

  // An event for a realm the task has not loaded, in a shard it holds, may
  // belong to a realm enabled since the last load, or to a shard gained since
  // then, whose load moves the consumer's position back. The realms are
  // loaded again before the event is given up on, unless the last load
  // covered its shard and came after the event committed: that load already
  // found the realm not recorded, as it does a realm disabled with events
  // still unread, so its backlog costs one load rather than one per event.
  async #recorderFor(event: ChangeEvent): Promise<ManagedRecorder | undefined> {
    let { realmId } = event;
    let realm = this.#realms.get(realmId);
    if (!realm && this.#mayBeUnloaded(event)) {
      await this.#loadRealms();
      realm = this.#realms.get(realmId);
    }
    if (!realm) {
      return undefined;
    }
    return this.#recorderOf(realm);
  }

  // The realm's recorder, started if it has none. Undefined once the task
  // is stopping, so nothing starts a recorder that shutdown would miss.
  #recorderOf(realm: RecordedRealm): ManagedRecorder | undefined {
    if (!this.#running()) {
      return undefined;
    }
    let recorder = this.#recorders.get(realm.id);
    if (!recorder) {
      let beat = () => this.#options.heartbeat.beat();
      let onCommits = (count: number) =>
        this.#background.commitsRecorded(realm.id, count);
      recorder = this.#options.recorderFor
        ? this.#options.recorderFor(realm, beat, onCommits)
        : this.#newRecorder(realm, beat, onCommits);
      this.#recorders.set(realm.id, recorder);
    }
    return recorder;
  }

  #newRecorder(
    realm: RecordedRealm,
    beat: () => void,
    onCommits: (count: number) => void,
  ): Recorder {
    let { db, historyRoot, lease, recording } = this.#options;
    return new Recorder({
      db,
      realm,
      historyRoot,
      holder: lease.holder,
      io: this.#io,
      onFatal: (error) => this.#fail(error),
      beat,
      onCommits,
      limits: recording?.limits,
      sizeOnlyThresholdBytes: recording?.sizeOnlyThresholdBytes,
    });
  }

  // Ticks every recorder with `readFrom` less the grace period, or with the
  // `occurred_at` of its realm's earliest unread event when that is earlier,
  // and drops the recorders that have been idle long enough. A dropped
  // recorder's realm gets a new one, loaded from Postgres and the repo, with
  // its next event.
  #tickRecorders(readFrom: number, earliestUnread: Map<string, number>): void {
    let { recording } = this.#options;
    let at = readFrom - (recording?.clockGraceMs ?? DEFAULT_CLOCK_GRACE_MS);
    let idleAfterMs = recording?.idleAfterMs ?? DEFAULT_IDLE_AFTER_MS;
    let now = Date.now();
    for (let [id, recorder] of this.#recorders) {
      recorder.tick?.(Math.min(at, earliestUnread.get(id) ?? Infinity));
      let idleSince = recorder.idleSince?.();
      if (idleSince !== undefined && now - idleSince >= idleAfterMs) {
        this.#drop(id, recorder);
      }
    }
  }

  // Stops the recorder and forgets it. A stop that fails is logged, so
  // shutdown still unsubscribes and releases the lease.
  #drop(id: string, recorder: ManagedRecorder): void {
    this.#recorders.delete(id);
    let stopping: Promise<void> = Promise.resolve()
      .then(() => recorder.stop?.())
      .catch((error) => {
        log.warn(
          `stopping the recorder of realm ${id} failed: ${String(error)}`,
        );
      })
      .finally(() => this.#stopping.delete(stopping));
    this.#stopping.add(stopping);
  }

  #mayBeUnloaded(event: ChangeEvent): boolean {
    let shard = shardOf(event.realmId, this.#options.lease.shardCount);
    if (!this.#lease.holds(shard)) {
      return false;
    }
    return (
      !this.#loadedShards.has(shard) || BigInt(event.xid) >= this.#loadedBelow
    );
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
    if (this.#wake) {
      this.#wake();
    } else {
      this.#wakePending = true;
    }
  }

  #sleep(ms: number): Promise<void> {
    if (this.#wakePending) {
      this.#wakePending = false;
      return Promise.resolve();
    }
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

// The database's clock, which `occurred_at` is read from, in milliseconds
// since the epoch. `clock_timestamp()` is the time the statement runs, not
// the time its transaction started.
async function databaseTime(db: DBAdapter): Promise<number> {
  let [{ now }] = await db.execute(
    `SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now`,
  );
  return Number(now);
}
