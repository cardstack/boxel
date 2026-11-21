// Measures how many database connections a stretch of work checks out, how
// long each is held, and where each checkout comes from, by watching one
// PgAdapter from outside: its pool's `connect`, each checked-out client's
// `query` and `release`, and the statements a read snapshot runs. Nothing the
// adapter decides changes; the recorder only reads.
//
// Built for search-connection-fanout-test.ts, and meant to be reused by a
// standing concurrency gate: `start()`, run the work, `stop()`, then read
// `summary()`.

import type { PgAdapter } from '@cardstack/postgres';

export interface Statement {
  source: string;
  frame: string | undefined;
  ms: number;
  sql: string;
}

export interface Checkout {
  id: number;
  // which adapter path checked it out: execute, withConnection, readSnapshot …
  via: string;
  // where in the engine or server the checkout was asked for
  source: string;
  frames: string[];
  grantedAt: number;
  releasedAt: number | undefined;
  inUseAtGrant: number;
  waitingAtGrant: number;
  // statements run on this connection while it was out, as the client saw them
  statements: { sql: string; ms: number }[];
  // the delay injected after each of its statements (`statementDelayMs`)
  delayMs: number;
}

export interface RecorderOptions {
  // Holds each statement's result back this long before the caller sees it,
  // on connections checked out while recording. A local database answers in
  // well under a millisecond, so a connection is released almost as soon as
  // it is taken, and holds that overlap in production (a read snapshot open
  // while a lookup inside it waits for a second connection) never overlap
  // here. A delay of the order of a production round trip makes them do so.
  statementDelayMs?: number;
}

export interface FanoutSummary {
  checkouts: number;
  peakInUse: number;
  peakHolds: number;
  peakWaiting: number;
  oldestWaitMs: number;
  snapshotRestarts: number;
  bySource: Record<
    string,
    { checkouts: number; holdMs: number; maxHoldMs: number; via: string[] }
  >;
  // statements read through a read snapshot, by the code that asked for them
  snapshotStatements: Record<
    string,
    { statements: number; ms: number; frames: string[] }
  >;
  // the first checkout of each source, its frames, for finding the call site
  examples: Record<string, string[]>;
  holds: { id: number; via: string; source: string; ms: number }[];
}

// Ordered most specific first; the innermost frame that matches names the
// source. A frame is `function file:line`, file relative to the repository.
const SOURCES: [string, RegExp][] = [
  [
    'definition lookup: definition read',
    /definition-lookup|lookupDefinition|definitions\.ts/,
  ],
  ['time zone', /time-zone/],
  ['policy / liveness', /polic|liveness|permission|realm-acl|\bacl\b/i],
  ['value store', /value-store/],
  ['let binding', /bindings\.ts|binding-reference/],
  ['near / vector read', /vector-|near-filter|nearSort|near\b/],
  ['blend scoring', /blend/],
  ['facets', /facet/],
  ['count / total', /union-totals|countOnly|\btotal/i],
  ['collapse', /collapse/],
  ['hydrate / included', /included|hydrat|loadLinks|search-entry|index-rows/],
  ['plain page', /plain-page|paging\.ts|search-pipeline/],
  ['queue / background', /queue|job|worker/i],
  ['engine (other)', /query-engine|index-query-engine/],
  ['realm (other)', /runtime-common\/realm\.ts|realm-server/],
];

function frameOf(line: string): string | undefined {
  let m = /at (?:async )?(?:(.*?) \()?(.*?):(\d+):\d+\)?$/.exec(line.trim());
  if (!m) return undefined;
  let [, fn, file, ln] = m;
  let at = file.indexOf('packages/');
  if (at < 0) return undefined;
  return `${fn ?? '<anonymous>'} ${file.slice(at)}:${ln}`;
}

function framesOf(stack: string | undefined): {
  own: string[];
  postgres: string[];
} {
  let own: string[] = [];
  let postgres: string[] = [];
  for (let line of (stack ?? '').split('\n').slice(1)) {
    let frame = frameOf(line);
    if (!frame) continue;
    if (frame.includes('/tests/helpers/connection-fanout')) continue;
    if (frame.includes('packages/postgres/')) postgres.push(frame);
    else own.push(frame);
  }
  return { own, postgres };
}

// Call sites that name a source wherever they sit on the stack, tested before
// the innermost-frame rules: the same permissions read serves a request's
// context and a definition lookup's.
const CALLERS: [string, RegExp][] = [
  [
    'definition lookup: permissions read',
    /ownerAndVisibility|buildLookupContext/,
  ],
  ['request context: permissions read', /createRequestContext/],
  ['request: realm archived check', /isRealmArchived|#isSealed/],
  ['request: realm info', /parseRealmInfo|getLastPublishedAt/],
];

function sourceOf(frames: string[]): string {
  let text = frames.join('\n');
  for (let [name, pattern] of CALLERS) {
    if (pattern.test(text)) return name;
  }
  for (let frame of frames) {
    for (let [name, pattern] of SOURCES) {
      if (pattern.test(frame)) return name;
    }
  }
  return frames.length ? 'unclassified' : 'no stack';
}

// The innermost adapter entry point on the stack. `withConnectionTenant` and
// `withConnectionOrdering` wrap whole requests, so they say nothing.
function viaOf(postgres: string[]): string {
  for (let frame of postgres) {
    let fn = frame.split(' ')[0];
    if (/readSnapshotAttempt|withReadSnapshot/.test(fn)) return 'readSnapshot';
    if (/withWriteLock|withFileWriteLocks|advisory/i.test(fn))
      return 'writeLock';
    if (/\bwithConnection$/.test(fn)) return 'withConnection';
    if (/\.execute$/.test(fn)) return 'execute';
  }
  return postgres[0]?.split(' ')[0] ?? 'unknown';
}

// A read snapshot's connection is checked out by its first statement, in a
// `then` of the statement before it, so its stack is empty; its first
// statement says what it is.
function sourceOfCheckout(c: Checkout): string {
  if (/^BEGIN ISOLATION LEVEL REPEATABLE READ/.test(c.statements[0]?.sql ?? ''))
    return 'read snapshot';
  return c.source;
}

function now() {
  return performance.now();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ConnectionFanoutRecorder {
  #adapter: PgAdapter;
  #recording = false;
  #checkouts: Checkout[] = [];
  #snapshotStatements: Statement[] = [];
  #peakInUse = 0;
  #peakHolds = 0;
  #peakWaiting = 0;
  #oldestWaitMs = 0;
  #restartsAtStart = 0;
  #sampler: ReturnType<typeof setInterval> | undefined;
  #nextId = 1;
  #restore: (() => void)[] = [];
  #statementDelayMs: number;

  constructor(adapter: PgAdapter, opts?: RecorderOptions) {
    this.#adapter = adapter;
    this.#statementDelayMs = opts?.statementDelayMs ?? 0;
    Error.stackTraceLimit = Math.max(Error.stackTraceLimit, 80);
    this.#patch();
  }

  #sample() {
    let s = this.#adapter.connectionStats;
    this.#peakInUse = Math.max(this.#peakInUse, s.inUse);
    this.#peakHolds = Math.max(this.#peakHolds, s.holds);
    this.#peakWaiting = Math.max(this.#peakWaiting, s.waiting);
    this.#oldestWaitMs = Math.max(this.#oldestWaitMs, s.oldestWaitMs);
  }

  #patch() {
    let adapter = this.#adapter as any;
    let pool = adapter.pool;
    let connect = pool.connect;
    pool.connect = async (...args: unknown[]) => {
      let stack = new Error().stack;
      let client = await connect.apply(pool, args);
      if (!this.#recording) return client;
      let { own, postgres } = framesOf(stack);
      let stats = this.#adapter.connectionStats;
      let record: Checkout = {
        id: this.#nextId++,
        via: viaOf(postgres),
        source: sourceOf(own),
        frames: own.slice(0, 12),
        grantedAt: now(),
        releasedAt: undefined,
        inUseAtGrant: stats.inUse,
        waitingAtGrant: stats.waiting,
        statements: [],
        delayMs: this.#statementDelayMs,
      };
      this.#checkouts.push(record);
      this.#sample();
      // Patched once per client, and read from the checkout it is serving at
      // the time, so a client a later recorder checks out answers to that one.
      if (!client.__fanoutQuery) {
        client.__fanoutQuery = client.query;
        client.query = function (...q: any[]) {
          let current: Checkout | undefined = client.__fanoutCurrent;
          let started = now();
          let result = client.__fanoutQuery.call(client, ...q);
          if (current && result && typeof result.then === 'function') {
            let delayMs = current.delayMs;
            if (delayMs > 0) {
              result = result.then(
                async (value: unknown) => {
                  await sleep(delayMs);
                  return value;
                },
                async (error: unknown) => {
                  await sleep(delayMs);
                  throw error;
                },
              );
            }
            let sql = String(typeof q[0] === 'string' ? q[0] : q[0]?.text);
            let done = () =>
              current!.statements.push({
                sql: sql.replace(/\s+/g, ' ').slice(0, 160),
                ms: now() - started,
              });
            result.then(done, done);
          }
          return result;
        };
      }
      client.__fanoutCurrent = record;
      let release = client.release;
      client.release = function (...r: unknown[]) {
        if (client.__fanoutCurrent === record) {
          record.releasedAt = now();
          client.__fanoutCurrent = undefined;
        }
        client.release = release;
        return release.apply(client, r);
      };
      return client;
    };
    this.#restore.push(() => (pool.connect = connect));

    // A read snapshot runs its statements in turn, each in a `then` of the
    // last, so a stack taken where the statement reaches its client has lost
    // the caller. The reader is wrapped so the stack is taken where the
    // engine calls it.
    // An adapter without read snapshots (an older engine) is left without
    // them: the engine tests for the method.
    let withReadSnapshot = adapter.withReadSnapshot;
    if (typeof withReadSnapshot !== 'function') return;
    adapter.withReadSnapshot = (fn: any, opts: any) => {
      return withReadSnapshot.call(
        adapter,
        (reader: any) => fn(this.#wrapReader(reader)),
        opts,
      );
    };
    this.#restore.push(() => delete adapter.withReadSnapshot);
  }

  #restarts(): number {
    return (this.#adapter as any).readSnapshotRestarts ?? 0;
  }

  #wrapReader(reader: any): any {
    let timed = async <T>(sql: string, run: () => Promise<T>): Promise<T> => {
      if (!this.#recording) return await run();
      let { own } = framesOf(new Error().stack);
      let started = now();
      try {
        return await run();
      } finally {
        this.#snapshotStatements.push({
          source: sourceOf(own),
          frame: own[0],
          ms: now() - started,
          sql: sql.replace(/\s+/g, ' ').slice(0, 160),
        });
      }
    };
    let wrapped: any = Object.create(reader);
    wrapped.execute = (sql: string, opts: unknown) =>
      timed(sql, () => reader.execute(sql, opts));
    wrapped.withTransaction = (body: unknown) =>
      timed('<savepoint block>', () => reader.withTransaction(body));
    wrapped.withReadSnapshot = (inner: (r: unknown) => unknown) =>
      inner(wrapped);
    return wrapped;
  }

  start() {
    this.#checkouts = [];
    this.#snapshotStatements = [];
    this.#peakInUse = 0;
    this.#peakHolds = 0;
    this.#peakWaiting = 0;
    this.#oldestWaitMs = 0;
    this.#restartsAtStart = this.#restarts();
    this.#recording = true;
    this.#sampler = setInterval(() => this.#sample(), 1);
  }

  stop() {
    this.#recording = false;
    if (this.#sampler) clearInterval(this.#sampler);
    this.#sampler = undefined;
    this.#sample();
  }

  dispose() {
    this.stop();
    for (let restore of this.#restore.reverse()) restore();
    this.#restore = [];
  }

  get checkouts(): readonly Checkout[] {
    return this.#checkouts;
  }

  summary(opts?: { exclude?: RegExp }): FanoutSummary {
    let at = now();
    for (let c of this.#checkouts) c.source = sourceOfCheckout(c);
    let kept = this.#checkouts.filter(
      (c) => !opts?.exclude || !opts.exclude.test(c.source),
    );
    let bySource: FanoutSummary['bySource'] = {};
    let examples: FanoutSummary['examples'] = {};
    let holds: FanoutSummary['holds'] = [];
    for (let c of kept) {
      let ms = (c.releasedAt ?? at) - c.grantedAt;
      let key = `${c.source} [${c.via}]`;
      let entry = (bySource[key] ??= {
        checkouts: 0,
        holdMs: 0,
        maxHoldMs: 0,
        via: [],
      });
      entry.checkouts++;
      entry.holdMs += ms;
      entry.maxHoldMs = Math.max(entry.maxHoldMs, ms);
      if (!entry.via.includes(c.via)) entry.via.push(c.via);
      examples[key] ??= c.frames.slice(0, 6);
      holds.push({ id: c.id, via: c.via, source: c.source, ms: round(ms) });
    }
    for (let entry of Object.values(bySource)) {
      entry.holdMs = round(entry.holdMs);
      entry.maxHoldMs = round(entry.maxHoldMs);
    }
    let snapshotStatements: FanoutSummary['snapshotStatements'] = {};
    for (let s of this.#snapshotStatements) {
      let entry = (snapshotStatements[s.source] ??= {
        statements: 0,
        ms: 0,
        frames: [],
      });
      entry.statements++;
      entry.ms += s.ms;
      if (s.frame && !entry.frames.includes(s.frame) && entry.frames.length < 4)
        entry.frames.push(s.frame);
    }
    for (let entry of Object.values(snapshotStatements)) {
      entry.ms = round(entry.ms);
    }
    return {
      checkouts: kept.length,
      peakInUse: this.#peakInUse,
      peakHolds: this.#peakHolds,
      peakWaiting: this.#peakWaiting,
      oldestWaitMs: round(this.#oldestWaitMs),
      snapshotRestarts: this.#restarts() - this.#restartsAtStart,
      bySource,
      snapshotStatements,
      examples,
      holds,
    };
  }
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

// Resolves once the adapter has had nothing checked out for `quietMs`, so a
// measurement does not count the tail of indexing or a queue poll.
export async function untilPoolQuiet(
  adapter: PgAdapter,
  { quietMs = 100, timeoutMs = 10_000 } = {},
): Promise<void> {
  let deadline = Date.now() + timeoutMs;
  let quietSince: number | undefined;
  while (Date.now() < deadline) {
    if (adapter.connectionStats.inUse === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= quietMs) return;
    } else {
      quietSince = undefined;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}
