// The schedule of background work on the realms a task records, such as
// reconcile passes, sweeps and maintenance. Each kind of work says when it
// comes due on a realm: as soon as the realm is loaded, a fixed time after
// the kind last ran, once revisions have been committed since then, or when
// asked. Due work starts in the order it came due, at most `concurrency`
// jobs at once across the task and one at a time on each realm, so it runs
// at lower concurrency than recording.
//
// The schedule covers only the realms the task loaded, which are the
// realms of the shards it holds. Each job runs in its realm's recorder
// (`ManagedRecorder.runBackground`), which serializes it with the realm's
// commits. A realm with no recorder gets one, and the task drops that
// recorder again once it is idle.
//
// A job that is skipped, because the realm had events captured or queued,
// stays due and is tried again a moment later. A job that fails, or that
// its recorder can't run because the realm stalled or the recorder stopped,
// is logged and tried again after the kind's retry delay.

import { logger } from '@cardstack/runtime-common';
import type { RecordedRealm } from './realms.ts';
import type {
  BackgroundContext,
  BackgroundOutcome,
  ManagedRecorder,
} from './recorder.ts';

const log = logger('realm-historian:background');

export const DEFAULT_BACKGROUND_CONCURRENCY = 2;
const DEFAULT_RETRY_AFTER_MS = 60_000;
// How long a skipped job waits before it is tried again, so a realm that
// keeps receiving events isn't offered the job on every turn.
const SKIPPED_RETRY_AFTER_MS = 1000;

export interface BackgroundResult {
  // Makes the kind due on the realm again this long from now, whether or not
  // anything else would.
  againAfterMs?: number;
}

export interface BackgroundKind {
  // Names the kind in logs and in `request`.
  name: string;
  // Due as soon as the realm is loaded: when the task starts, when it gains
  // the realm's shard, or when it finds the realm newly enabled.
  atStart?: boolean;
  // Due this long after the kind last ran on the realm.
  everyMs?: number;
  // Due once this many revisions have been committed to the realm since the
  // kind last ran, counting every HEAD move the realm's recorder makes or
  // finds. With `quietMs`, due only once no revision has been committed for
  // that long.
  afterCommits?: number;
  quietMs?: number;
  // How long a job that failed, or that its recorder couldn't run, waits
  // before it is tried again.
  retryAfterMs?: number;
  // Whether a failure stalls the realm (`BackgroundJob.stallOnFailure`).
  stallOnFailure?: boolean;
  // A cheap check made before each job starts, and so before a recorder is
  // started for it. False means the realm needs nothing, which counts as a
  // run.
  isDue?(realm: RecordedRealm): Promise<boolean>;
  run(
    realm: RecordedRealm,
    context: BackgroundContext,
  ): Promise<BackgroundResult | void>;
}

export interface BackgroundOptions {
  kinds?: BackgroundKind[];
  // How many jobs run at once across the task.
  concurrency?: number;
}

export interface BackgroundSchedulerOptions extends BackgroundOptions {
  // The recorder that runs a job on the realm, started if the realm has
  // none; undefined when the task no longer records the realm.
  recorderFor: (realm: RecordedRealm) => ManagedRecorder | undefined;
  now?: () => number;
}

// One kind's schedule on one realm. Times are milliseconds since the epoch,
// and Infinity where nothing has set them.
interface Due {
  // When the kind's timer makes it due: at load, `everyMs` after the last
  // run, or as a run's `againAfterMs` asked.
  timerAt: number;
  // When the earliest request not yet met makes it due. A run takes the
  // request that had come due when it started, and gives it back unless it
  // ran, so a request made during a run, or one still in the future, waits
  // for a run of its own.
  requestedAt: number;
  // Revisions committed since the kind last ran, and when the last was.
  commits: number;
  lastCommitAt: number;
  // Not before this, after a skip or a failure.
  notBefore: number;
}

type Ending =
  | { outcome: BackgroundOutcome; result?: BackgroundResult | void }
  | { outcome: 'failed'; error: unknown };

export class BackgroundScheduler {
  #kinds: BackgroundKind[];
  #concurrency: number;
  #recorderFor: BackgroundSchedulerOptions['recorderFor'];
  #now: () => number;
  #realms = new Map<string, RecordedRealm>();
  // By realm id, then by kind name.
  #schedule = new Map<string, Map<string, Due>>();
  #busyRealms = new Set<string>();
  #jobs = new Set<Promise<void>>();
  #stopped = false;

  constructor(options: BackgroundSchedulerOptions) {
    this.#kinds = options.kinds ?? [];
    let names = new Set(this.#kinds.map((kind) => kind.name));
    if (names.size !== this.#kinds.length) {
      throw new Error('each background kind needs a name of its own');
    }
    for (let kind of this.#kinds) {
      checkKind(kind);
    }
    this.#concurrency = options.concurrency ?? DEFAULT_BACKGROUND_CONCURRENCY;
    if (!Number.isInteger(this.#concurrency) || this.#concurrency < 1) {
      throw new Error(
        `background concurrency must be at least 1, not ${this.#concurrency}`,
      );
    }
    this.#recorderFor = options.recorderFor;
    this.#now = options.now ?? Date.now;
  }

  // How many jobs are running.
  get running(): number {
    return this.#jobs.size;
  }

  // The realms the task records. A realm new to the schedule gets each
  // kind's starting schedule; a realm no longer recorded leaves it, though
  // a job already running on it finishes.
  setRealms(realms: ReadonlyMap<string, RecordedRealm>): void {
    let now = this.#now();
    for (let id of this.#schedule.keys()) {
      if (!realms.has(id)) {
        this.#schedule.delete(id);
      }
    }
    this.#realms = new Map(realms);
    for (let id of realms.keys()) {
      if (this.#schedule.has(id)) {
        continue;
      }
      let kinds = new Map<string, Due>();
      for (let kind of this.#kinds) {
        kinds.set(kind.name, {
          timerAt: kind.atStart
            ? now
            : kind.everyMs !== undefined
              ? now + kind.everyMs
              : Infinity,
          requestedAt: Infinity,
          commits: 0,
          lastCommitAt: -Infinity,
          notBefore: -Infinity,
        });
      }
      this.#schedule.set(id, kinds);
    }
  }

  // Counts revisions committed to the realm, for the kinds that come due by
  // commits.
  commitsRecorded(realmId: string, count: number): void {
    let kinds = this.#schedule.get(realmId);
    if (!kinds || count <= 0) {
      return;
    }
    let now = this.#now();
    for (let due of kinds.values()) {
      due.commits += count;
      due.lastCommitAt = now;
    }
  }

  // Makes a kind due on the realm, now or after `delayMs`. A request made
  // while the kind runs on the realm is met by a later run.
  request(
    realmId: string,
    kindName: string,
    { delayMs = 0 }: { delayMs?: number } = {},
  ): void {
    let due = this.#schedule.get(realmId)?.get(kindName);
    if (!due) {
      return;
    }
    due.requestedAt = Math.min(due.requestedAt, this.#now() + delayMs);
  }

  // Starts the due jobs that the concurrency allows, in the order they came
  // due, without waiting for them.
  dispatch(): void {
    if (this.#stopped) {
      return;
    }
    let now = this.#now();
    let ready: { realm: RecordedRealm; kind: BackgroundKind; due: Due }[] = [];
    let dueAt = new Map<Due, number>();
    for (let [realmId, kinds] of this.#schedule) {
      if (this.#busyRealms.has(realmId)) {
        continue;
      }
      let realm = this.#realms.get(realmId)!;
      for (let kind of this.#kinds) {
        let due = kinds.get(kind.name)!;
        let at = this.#dueAt(kind, due);
        if (at <= now) {
          ready.push({ realm, kind, due });
          dueAt.set(due, at);
        }
      }
    }
    ready.sort((a, b) => dueAt.get(a.due)! - dueAt.get(b.due)!);
    for (let { realm, kind, due } of ready) {
      if (this.#jobs.size >= this.#concurrency) {
        break;
      }
      if (!this.#busyRealms.has(realm.id)) {
        this.#start(realm, kind, due);
      }
    }
  }

  // Starts nothing more, and resolves once the running jobs have ended.
  // Stopping the recorders is what ends a long job early.
  async stop(): Promise<void> {
    this.#stopped = true;
    while (this.#jobs.size > 0) {
      await Promise.all(this.#jobs);
    }
  }

  #dueAt(kind: BackgroundKind, due: Due): number {
    let byCommits =
      kind.afterCommits !== undefined && due.commits >= kind.afterCommits
        ? due.lastCommitAt + (kind.quietMs ?? 0)
        : Infinity;
    let at = Math.min(due.timerAt, due.requestedAt, byCommits);
    return at === Infinity ? Infinity : Math.max(at, due.notBefore);
  }

  #start(realm: RecordedRealm, kind: BackgroundKind, due: Due): void {
    this.#busyRealms.add(realm.id);
    let started = {
      commits: due.commits,
      request: due.requestedAt <= this.#now() ? due.requestedAt : Infinity,
    };
    if (started.request !== Infinity) {
      due.requestedAt = Infinity;
    }
    let job: Promise<void> = this.#run(realm, kind)
      .then((ending) => this.#finish(realm, kind, due, ending, started))
      .finally(() => {
        this.#busyRealms.delete(realm.id);
        this.#jobs.delete(job);
        this.dispatch();
      });
    this.#jobs.add(job);
  }

  async #run(realm: RecordedRealm, kind: BackgroundKind): Promise<Ending> {
    try {
      if (kind.isDue && !(await kind.isDue(realm))) {
        return { outcome: 'ran' };
      }
      let recorder = this.#stopped ? undefined : this.#recorderFor(realm);
      if (!recorder?.runBackground) {
        return { outcome: 'unavailable' };
      }
      let ran: { result?: BackgroundResult | void } = {};
      let outcome = await recorder.runBackground({
        kind: kind.name,
        stallOnFailure: kind.stallOnFailure,
        run: async (context) => {
          ran.result = await kind.run(realm, context);
        },
      });
      return { outcome, result: ran.result };
    } catch (error) {
      return { outcome: 'failed', error };
    }
  }

  #finish(
    realm: RecordedRealm,
    kind: BackgroundKind,
    due: Due,
    ending: Ending,
    // The commits counted and the request taken when the job started.
    started: { commits: number; request: number },
  ): void {
    let now = this.#now();
    let retryAfterMs = kind.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
    if (ending.outcome !== 'ran') {
      due.requestedAt = Math.min(due.requestedAt, started.request);
    }
    switch (ending.outcome) {
      case 'ran': {
        due.timerAt =
          kind.everyMs !== undefined ? now + kind.everyMs : Infinity;
        let againAfterMs = ending.result?.againAfterMs;
        if (againAfterMs !== undefined) {
          due.timerAt = Math.min(due.timerAt, now + againAfterMs);
        }
        due.commits = Math.max(0, due.commits - started.commits);
        due.notBefore = -Infinity;
        log.debug(`${kind.name} ran on ${realm.url}`);
        return;
      }
      case 'skipped':
        due.notBefore = now + SKIPPED_RETRY_AFTER_MS;
        log.debug(
          `${kind.name} on ${realm.url} was skipped: the realm has events in hand`,
        );
        return;
      case 'unavailable':
        due.notBefore = now + retryAfterMs;
        log.debug(
          `${kind.name} on ${realm.url} didn't run: its recorder has stalled or stopped`,
        );
        return;
      case 'failed':
        due.notBefore = now + retryAfterMs;
        log.warn(
          `${kind.name} on ${realm.url} failed; trying again in ${Math.round(retryAfterMs / 1000)}s: ${String(ending.error)}`,
        );
        return;
    }
  }
}

// Refuses timings that would make a kind due on every turn: a kind due after
// no commits, or due again, or retried, after no time at all.
function checkKind(kind: BackgroundKind): void {
  let positive = (name: 'everyMs' | 'retryAfterMs') => {
    let value = kind[name];
    if (value !== undefined && !(value > 0)) {
      throw new Error(
        `background kind ${kind.name}: ${name} must be above 0, not ${value}`,
      );
    }
  };
  positive('everyMs');
  positive('retryAfterMs');
  let { afterCommits, quietMs } = kind;
  if (
    afterCommits !== undefined &&
    !(Number.isInteger(afterCommits) && afterCommits >= 1)
  ) {
    throw new Error(
      `background kind ${kind.name}: afterCommits must be a whole number of at least 1, not ${afterCommits}`,
    );
  }
  if (
    quietMs !== undefined &&
    (afterCommits === undefined || !(quietMs >= 0))
  ) {
    throw new Error(
      `background kind ${kind.name}: quietMs must be at least 0, and goes with afterCommits`,
    );
  }
}
