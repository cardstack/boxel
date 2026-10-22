import { logger } from '@cardstack/runtime-common';
import type {
  RealmEventContent,
  UpdateRealmEventContent,
} from '@cardstack/base/matrix-event';

const log = logger('realm:events');

// Delivers realm events to their subscribers' session rooms through one
// per-process line, so a burst of events reaches synapse at a pace synapse can
// absorb rather than as fast as the realms produce them.
//
// Synapse serves every human user's sync, message sends and AI assistant
// stream from the same process the realm events land on. An event fans out to
// one send per session room, so a batch that writes many files turns into
// events × rooms sends; started all at once, they queue inside synapse and
// every user waits behind them. A proxy that times a slow send out does not
// cancel it either: synapse completes the send regardless, so timeouts shed no
// load. The only throttle that works is the sender's.
//
// The shape of the line:
//
// - At most `maxInFlight` sends are outstanding at once, and sends start no
//   faster than `sendsPerSecond`.
// - Realms take turns. Each send slot goes to the next realm in rotation that
//   has a send ready, so a realm with a large backlog takes an equal share of
//   the line rather than all of it, and an event from a quiet realm waits
//   behind at most one send per busy realm.
// - Within a realm, events go out in the order they were broadcast: a realm's
//   next event starts only once every room has the one before it. A
//   subscriber reads an `incremental-index-initiation` as "indexing started"
//   and the `incremental` after it as "indexing finished", so reordering them
//   would leave it believing a finished pass is still running.
// - A queued event that a newer one supersedes merges into it (see
//   `coalesce`). Only the realm's most recently queued event merges, so the
//   merge never moves an event past one of another kind.
// - A send that synapse answers with 429, 502, 503 or 504, or that cannot
//   reach synapse at all, is back-pressure: the whole line pauses, and the
//   send is retried with the same transaction id, so a retry of a send that
//   synapse did complete is not stored twice. The pause is at least as long
//   as synapse asked for in a rate-limit answer. It doubles for each pause in
//   a row that ends in back-pressure again, and resets on a success. Only a
//   send started after the latest pause counts toward either, so the sends
//   that were already in flight when synapse became overloaded add up to one
//   pause rather than doubling it once each.
// - The bytes queued are bounded. Past the bound, the realm with the longest
//   backlog loses its oldest queued event, so the realm causing the backlog
//   is the one that loses events. Events whose loss a subscriber recovers
//   from go first (see `isCompletion`).
//
// The queue is in memory. A process stopping on purpose waits a bounded time
// for it to empty (see `drain`); a process that exits any other way, or whose
// queue outlasts that wait, does not deliver what is still queued.

export interface RealmEventSend {
  roomId: string;
  // Called once per attempt, with the same transaction id each time.
  send(txnId: string): Promise<void>;
  // Called once, when the send fails with an error that is not
  // back-pressure, or when back-pressure outlasts `maxAttempts`.
  onFailure(error: unknown): Promise<void>;
}

export interface RealmEventBroadcast {
  realmURL: string;
  event: RealmEventContent;
  // Resolves the sends the event fans out to. Runs when the event reaches the
  // head of its realm's line, with the event as merged by then, so the rooms
  // are the ones subscribed at send time. When it rejects with back-pressure
  // the event goes back to the head of its line and is prepared again after
  // the pause, up to `maxAttempts` times; any other rejection skips the event.
  prepare(event: RealmEventContent): Promise<RealmEventSend[]>;
  newTxnId(): string;
}

export interface RealmEventDispatcherOptions {
  maxInFlight?: number;
  sendsPerSecond?: number;
  maxQueuedBytes?: number;
  maxAttempts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
}

export interface RealmEventDispatcherStats {
  // Gauges, read at the moment of the call.
  queuedEvents: number;
  queuedBytes: number;
  sendsInFlight: number;
  // How long the oldest event still waiting to start has waited.
  oldestQueuedMs: number;
  // Counters, since the previous call.
  sends: number;
  sendMsMean: number;
  sendMsMax: number;
  failedSends: number;
  backPressure: number;
  coalesced: number;
  dropped: number;
}

interface Entry {
  realmURL: string;
  event: RealmEventContent;
  bytes: number;
  enqueuedAt: number;
  prepare: RealmEventBroadcast['prepare'];
  newTxnId: RealmEventBroadcast['newTxnId'];
  waiters: (() => void)[];
  prepareAttempts: number;
}

interface PendingSend {
  send: RealmEventSend;
  txnId: string;
  attempts: number;
}

interface Active {
  entry: Entry;
  // Undefined while `prepare` runs.
  ready: PendingSend[] | undefined;
  outstanding: number;
}

interface Line {
  pending: Entry[];
  active: Active | undefined;
}

const BACK_PRESSURE_STATUSES = new Set([429, 502, 503, 504]);

export function isBackPressure(error: unknown): boolean {
  let status = (error as { status?: unknown } | undefined)?.status;
  if (typeof status === 'number') {
    return BACK_PRESSURE_STATUSES.has(status);
  }
  // A request given a deadline rejects with a TimeoutError (or an AbortError,
  // depending on the runtime) when the host does not answer in time.
  if (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return true;
  }
  // fetch rejects with a TypeError when it cannot reach the host at all
  // (connection refused or reset, DNS failure, socket closed mid-response).
  return error instanceof TypeError && /fetch failed/i.test(error.message);
}

export class RealmEventDispatcher {
  readonly #maxInFlight: number;
  readonly #sendsPerSecond: number;
  readonly #bucketSize: number;
  readonly #maxQueuedBytes: number;
  readonly #maxAttempts: number;
  readonly #initialBackoffMs: number;
  readonly #maxBackoffMs: number;
  readonly #now: () => number;

  // Insertion order is the rotation order; `#cursor` is the realm that gets
  // the next look.
  #lines = new Map<string, Line>();
  #cursor: string | undefined;
  #inFlight = 0;
  #queuedEvents = 0;
  #queuedBytes = 0;
  #tokens: number;
  #tokensAt: number;
  #pausedUntil = 0;
  // When the latest pause was set. A send started at or before it is part of
  // the episode that set it; no send starts during a pause, so any later one
  // started after the pause ended.
  #pausedAt = 0;
  #backoffMs = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #timerAt = 0;
  #idleWaiters: (() => void)[] = [];

  #sends = 0;
  #sendMsTotal = 0;
  #sendMsMax = 0;
  #failedSends = 0;
  #backPressure = 0;
  #coalesced = 0;
  #dropped = 0;
  #droppedSinceWarning = 0;
  #lastDropWarningAt = 0;

  constructor(opts: RealmEventDispatcherOptions = {}) {
    this.#maxInFlight = opts.maxInFlight ?? 8;
    this.#sendsPerSecond = opts.sendsPerSecond ?? 50;
    this.#maxQueuedBytes = opts.maxQueuedBytes ?? 64 * 1024 * 1024;
    this.#maxAttempts = opts.maxAttempts ?? 5;
    this.#initialBackoffMs = opts.initialBackoffMs ?? 1000;
    this.#maxBackoffMs = opts.maxBackoffMs ?? 30_000;
    this.#now = opts.now ?? (() => Date.now());
    // The bucket holds one second's worth of sends, so an idle line can start
    // a short burst at once and a long burst settles to the steady rate. It
    // holds at least one, or a rate under one a second would never fill it.
    this.#bucketSize = Math.max(1, this.#sendsPerSecond);
    this.#tokens = this.#bucketSize;
    this.#tokensAt = this.#now();
  }

  // Resolves once the event has gone to every room it fans out to, has merged
  // into an event that has, or has been dropped. It never rejects: delivery is
  // best-effort, and a failed send is reported through its `onFailure`.
  broadcast(broadcast: RealmEventBroadcast): Promise<void> {
    return new Promise<void>((resolve) => {
      let line = this.#lines.get(broadcast.realmURL);
      if (!line) {
        line = { pending: [], active: undefined };
        this.#lines.set(broadcast.realmURL, line);
      }
      let tail = line.pending[line.pending.length - 1];
      let merged = tail ? coalesce(tail.event, broadcast.event) : undefined;
      if (tail && merged) {
        let bytes = byteLength(merged);
        this.#queuedBytes += bytes - tail.bytes;
        tail.event = merged;
        tail.bytes = bytes;
        tail.prepare = broadcast.prepare;
        tail.newTxnId = broadcast.newTxnId;
        tail.waiters.push(resolve);
        this.#coalesced++;
      } else {
        let entry: Entry = {
          realmURL: broadcast.realmURL,
          event: broadcast.event,
          bytes: byteLength(broadcast.event),
          enqueuedAt: this.#now(),
          prepare: broadcast.prepare,
          newTxnId: broadcast.newTxnId,
          waiters: [resolve],
          prepareAttempts: 0,
        };
        line.pending.push(entry);
        this.#queuedEvents++;
        this.#queuedBytes += entry.bytes;
      }
      this.#enforceBound();
      this.#pump();
    });
  }

  // Resolves once nothing is queued or in flight.
  async idle(): Promise<void> {
    if (this.#isIdle()) {
      return;
    }
    await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }

  // Resolves true once nothing is queued or in flight, or false if that takes
  // longer than `timeoutMs`. A process stopping on purpose waits on this so the
  // events it has queued are not lost with it.
  async drain(timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      return await Promise.race([this.idle().then(() => true), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  takeStats(): RealmEventDispatcherStats {
    let now = this.#now();
    let oldest = now;
    for (let line of this.#lines.values()) {
      let head = line.pending[0];
      if (head && head.enqueuedAt < oldest) {
        oldest = head.enqueuedAt;
      }
    }
    let stats: RealmEventDispatcherStats = {
      queuedEvents: this.#queuedEvents,
      queuedBytes: this.#queuedBytes,
      sendsInFlight: this.#inFlight,
      oldestQueuedMs: now - oldest,
      sends: this.#sends,
      sendMsMean: this.#sends ? this.#sendMsTotal / this.#sends : 0,
      sendMsMax: this.#sendMsMax,
      failedSends: this.#failedSends,
      backPressure: this.#backPressure,
      coalesced: this.#coalesced,
      dropped: this.#dropped,
    };
    this.#sends = 0;
    this.#sendMsTotal = 0;
    this.#sendMsMax = 0;
    this.#failedSends = 0;
    this.#backPressure = 0;
    this.#coalesced = 0;
    this.#dropped = 0;
    return stats;
  }

  #isIdle() {
    return this.#queuedEvents === 0 && this.#lines.size === 0;
  }

  #enforceBound() {
    while (this.#queuedBytes > this.#maxQueuedBytes) {
      let longest: Line | undefined;
      for (let line of this.#lines.values()) {
        if (
          line.pending.length > 0 &&
          (!longest || line.pending.length > longest.pending.length)
        ) {
          longest = line;
        }
      }
      if (!longest) {
        return;
      }
      let index = longest.pending.findIndex(
        (entry) => !isCompletion(entry.event),
      );
      let [dropped] = longest.pending.splice(Math.max(0, index), 1);
      this.#queuedEvents--;
      this.#queuedBytes -= dropped.bytes;
      this.#dropped++;
      this.#droppedSinceWarning++;
      for (let resolve of dropped.waiters) {
        resolve();
      }
      this.#retireIfDone(dropped.realmURL);
    }
    // One line per window rather than one per event: under a backlog large
    // enough to drop, a line per event is its own flood.
    let now = this.#now();
    if (
      this.#droppedSinceWarning > 0 &&
      now - this.#lastDropWarningAt > 10_000
    ) {
      log.warn(
        `realm event queue is over ${this.#maxQueuedBytes} bytes; dropped ${this.#droppedSinceWarning} queued event(s) from the realms with the longest backlogs`,
      );
      this.#droppedSinceWarning = 0;
      this.#lastDropWarningAt = now;
    }
  }

  #pump() {
    while (this.#inFlight < this.#maxInFlight) {
      let now = this.#now();
      if (now < this.#pausedUntil) {
        this.#wakeAt(this.#pausedUntil);
        return;
      }
      this.#refill(now);
      // Checked before a send is chosen: choosing one moves the rotation on,
      // so choosing a send that then has to wait would cost its realm a turn.
      if (this.#tokens < 1) {
        this.#wakeAt(
          now + Math.ceil(((1 - this.#tokens) * 1000) / this.#sendsPerSecond),
        );
        return;
      }
      let next = this.#nextSend();
      if (!next) {
        return;
      }
      this.#tokens--;
      this.#run(next.active, next.pending);
    }
  }

  #refill(now: number) {
    let elapsed = now - this.#tokensAt;
    if (elapsed > 0) {
      this.#tokens = Math.min(
        this.#bucketSize,
        this.#tokens + (elapsed * this.#sendsPerSecond) / 1000,
      );
      this.#tokensAt = now;
    }
  }

  #wakeAt(at: number) {
    if (this.#timer && this.#timerAt <= at) {
      return;
    }
    if (this.#timer) {
      clearTimeout(this.#timer);
    }
    this.#timerAt = at;
    this.#timer = setTimeout(
      () => {
        this.#timer = undefined;
        this.#pump();
      },
      Math.max(0, at - this.#now()),
    );
    // A process with nothing else to do is not kept alive by a queued
    // realm event.
    this.#timer.unref?.();
  }

  // The next send in rotation, starting realms' next events along the way.
  #nextSend(): { active: Active; pending: PendingSend } | undefined {
    let realms = [...this.#lines.keys()];
    if (realms.length === 0) {
      return undefined;
    }
    let start = this.#cursor ? realms.indexOf(this.#cursor) : 0;
    if (start < 0) {
      start = 0;
    }
    for (let i = 0; i < realms.length; i++) {
      let realmURL = realms[(start + i) % realms.length];
      let line = this.#lines.get(realmURL)!;
      if (!line.active && line.pending.length > 0) {
        this.#start(line);
      }
      let active = line.active;
      if (active?.ready && active.ready.length > 0) {
        this.#cursor = realms[(start + i + 1) % realms.length];
        return { active, pending: active.ready.shift()! };
      }
    }
    return undefined;
  }

  #start(line: Line) {
    let entry = line.pending.shift()!;
    this.#queuedEvents--;
    this.#queuedBytes -= entry.bytes;
    let active: Active = { entry, ready: undefined, outstanding: 0 };
    line.active = active;
    entry.prepareAttempts++;
    let startedAt = this.#now();
    entry
      .prepare(entry.event)
      .catch((e: unknown) => {
        if (isBackPressure(e)) {
          this.#backPressure++;
          this.#pauseFor(e, startedAt);
          if (entry.prepareAttempts < this.#maxAttempts) {
            return undefined;
          }
        }
        log.error(
          `Unable to resolve the rooms for a realm event in ${entry.realmURL}; skipping it`,
          e,
        );
        return [];
      })
      .then((sends) => {
        if (!sends) {
          // Back to the head of the line, to be prepared again once the
          // pause is over.
          line.active = undefined;
          line.pending.unshift(entry);
          this.#queuedEvents++;
          this.#queuedBytes += entry.bytes;
          this.#pump();
          return;
        }
        active.ready = sends.map((send) => ({
          send,
          txnId: entry.newTxnId(),
          attempts: 0,
        }));
        this.#finishIfDone(line);
        this.#pump();
      });
  }

  #run(active: Active, pending: PendingSend) {
    this.#inFlight++;
    active.outstanding++;
    pending.attempts++;
    let startedAt = this.#now();
    let realmURL = active.entry.realmURL;
    void pending.send
      .send(pending.txnId)
      .then(
        () => {
          let ms = this.#now() - startedAt;
          this.#sends++;
          this.#sendMsTotal += ms;
          this.#sendMsMax = Math.max(this.#sendMsMax, ms);
          if (startedAt > this.#pausedAt) {
            this.#backoffMs = 0;
          }
        },
        async (error: unknown) => {
          if (isBackPressure(error)) {
            this.#backPressure++;
            this.#pauseFor(error, startedAt);
            if (pending.attempts < this.#maxAttempts) {
              active.ready!.push(pending);
              return;
            }
          }
          this.#failedSends++;
          try {
            await pending.send.onFailure(error);
          } catch (e) {
            log.error(
              `Failure handler threw for a realm event send to room ${pending.send.roomId}`,
              e,
            );
          }
        },
      )
      .finally(() => {
        this.#inFlight--;
        active.outstanding--;
        let line = this.#lines.get(realmURL);
        if (line) {
          this.#finishIfDone(line);
        }
        this.#pump();
      });
  }

  #pauseFor(error: unknown, startedAt: number) {
    let now = this.#now();
    if (startedAt > this.#pausedAt) {
      this.#backoffMs = Math.min(
        this.#maxBackoffMs,
        this.#backoffMs ? this.#backoffMs * 2 : this.#initialBackoffMs,
      );
      this.#pausedAt = now;
    }
    let retryAfterMs = (error as { retryAfterMs?: unknown }).retryAfterMs;
    let pauseMs = Math.max(
      this.#backoffMs,
      typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)
        ? retryAfterMs
        : 0,
    );
    this.#pausedUntil = Math.max(this.#pausedUntil, now + pauseMs);
  }

  #finishIfDone(line: Line) {
    let active = line.active;
    if (
      !active ||
      !active.ready ||
      active.ready.length > 0 ||
      active.outstanding > 0
    ) {
      return;
    }
    line.active = undefined;
    for (let resolve of active.entry.waiters) {
      resolve();
    }
    this.#retireIfDone(active.entry.realmURL);
  }

  #retireIfDone(realmURL: string) {
    let line = this.#lines.get(realmURL);
    if (line && !line.active && line.pending.length === 0) {
      if (this.#cursor === realmURL) {
        let realms = [...this.#lines.keys()];
        let next = realms[(realms.indexOf(realmURL) + 1) % realms.length];
        this.#cursor = next === realmURL ? undefined : next;
      }
      this.#lines.delete(realmURL);
    }
    if (this.#isIdle()) {
      let waiters = this.#idleWaiters;
      this.#idleWaiters = [];
      for (let resolve of waiters) {
        resolve();
      }
    }
  }
}

// The event a queued `queued` and a newly broadcast `next` from the same realm
// merge into, or undefined when the two have to go out separately.
//
// - Two `incremental-index-initiation`s merge into the newer one. A subscriber
//   reads the event as "this realm is indexing"; a second one before any
//   completion tells it nothing the first did not, and the newer `updatedFile`
//   names the most recent write.
// - Two `update`s merge into one listing every path either listed. A
//   subscriber reads the lists as "these paths changed" and refreshes what
//   contains them, so the union says everything the two said.
//
// Completion events (`incremental`, `full`) and `prerender_html` carry what a
// subscriber reconciles per event — request ids, versions, generations — and
// always go out as broadcast.
export function coalesce(
  queued: RealmEventContent,
  next: RealmEventContent,
): RealmEventContent | undefined {
  if (
    queued.eventName === 'index' &&
    next.eventName === 'index' &&
    queued.indexType === 'incremental-index-initiation' &&
    next.indexType === 'incremental-index-initiation'
  ) {
    return next;
  }
  if (queued.eventName === 'update' && next.eventName === 'update') {
    let merged: UpdateRealmEventContent = {
      eventName: 'update',
      realmURL: next.realmURL,
    };
    for (let key of ['added', 'updated', 'removed'] as const) {
      let paths = union(queued[key], next[key]);
      if (paths) {
        merged[key] = paths;
      }
    }
    return merged;
  }
  return undefined;
}

// A completion is the event that ends an indexing pass. A subscriber that
// misses one keeps showing the realm as indexing and keeps the cards the pass
// changed as they were, until a later completion arrives. Losing any other
// event costs less: an initiation is followed by its completion, an `update`'s
// paths are re-read on the next directory listing, and `prerender_html` is
// followed by the next pass's completion.
function isCompletion(event: RealmEventContent): boolean {
  return (
    event.eventName === 'index' &&
    (event.indexType === 'incremental' || event.indexType === 'full')
  );
}

function union(
  a: string[] | undefined,
  b: string[] | undefined,
): string[] | undefined {
  if (!a && !b) {
    return undefined;
  }
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}

function byteLength(event: RealmEventContent): number {
  return Buffer.byteLength(JSON.stringify(event));
}

function positiveNumberFromEnv(name: string): number | undefined {
  let raw = process.env[name];
  if (raw === undefined || raw === '') {
    return undefined;
  }
  let value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    log.warn(`ignoring ${name}=${raw}: expected a positive number`);
    return undefined;
  }
  return value;
}

let processDispatcher: RealmEventDispatcher | undefined;

// The one line every realm in this process broadcasts through. Tuned by
// REALM_EVENT_MAX_SENDS_IN_FLIGHT, REALM_EVENT_SENDS_PER_SECOND and
// REALM_EVENT_MAX_QUEUED_BYTES.
export function realmEventDispatcher(): RealmEventDispatcher {
  if (!processDispatcher) {
    processDispatcher = new RealmEventDispatcher({
      maxInFlight: positiveNumberFromEnv('REALM_EVENT_MAX_SENDS_IN_FLIGHT'),
      sendsPerSecond: positiveNumberFromEnv('REALM_EVENT_SENDS_PER_SECOND'),
      maxQueuedBytes: positiveNumberFromEnv('REALM_EVENT_MAX_QUEUED_BYTES'),
    });
  }
  return processDispatcher;
}
