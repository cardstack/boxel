import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

// Which tenant a piece of database work is done for, and how the pool's
// connections are shared between tenants.
//
// # Why the pool decides this, and not an admission gate in front of it
//
// A realm's search fans out into the database far more than it fans out
// anywhere else. One search over a few hundred rows resolves every row's
// query-backed fields concurrently, and each of those is a search of its own
// with its own definition lookups and SQL, so a single request puts hundreds
// of queries in front of the pool at once. A cap on concurrent *requests* —
// per realm or per process — cannot bound that: one admitted request is
// enough to fill the pool's queue. The queue that forms is where a different
// realm's search waits, so the queue is where fairness has to be decided.
//
// And past a point, more concurrency buys the database nothing. Every
// connection the pool hands out runs its query on the database at once; once
// those outnumber what the database can execute in parallel, the excess
// queues inside Postgres, where every session shares the CPU and nothing
// separates one tenant's query from another's. A tenant holding most of the
// pool then slows every other tenant's queries by the ratio of sessions to
// cores, whatever order the pool granted them in. Keeping that queue here
// instead — where it can be ordered — is what lets one tenant's query run at
// close to its own speed while another tenant saturates the database.
//
// # The policy
//
// - Connections are granted lowest-held-first: when one frees, it goes to the
//   waiting tenant that currently holds the fewest, and arrival order breaks
//   ties. A tenant with one query waiting behind another tenant's hundreds is
//   served next, not last.
// - While the pool is oversubscribed — more acquisitions wanting a connection
//   than it has connections — and another tenant has work open, a tenant
//   holds at most `tenantShare` connections; its excess waits here even if
//   connections are free. Below that point nothing is held back: a pool
//   with room for everyone's work is not a pool anyone is being crowded out
//   of, and a search's own fan-out keeps all the parallelism it has. A tenant
//   with no one else active is not held to it either, so a tenant working
//   alone keeps the whole pool.
// - Untagged work — anything not run under `withConnectionTenant` or
//   `withConnectionOrdering` — is ordered with the tenants as one more of them
//   but never held to the share, and never counts as another tenant with work
//   open. Its connections do count toward whether the pool is oversubscribed.
//   Writes, locks and the indexer's own commits keep the reach they had.
// - Ordered work — run under `withConnectionOrdering`, for a request that
//   names a realm but is not a search — is ordered as that realm, and
//   otherwise treated as untagged: never held to the share, never counted
//   as another tenant with work open, and not counted toward the realm's
//   share either, so a realm's page loads, writes and indexing fetches leave
//   its searches the share they had. Its connections do count toward the
//   realm's place in the order. Untagged, a quiet realm's page load waits in
//   one arrival-order queue behind everything a busy realm has queued outside
//   its searches: the fetches its indexing makes, its writes. Ordered as its
//   realm, it holds the fewest and is served next. It stops short of a
//   tenant's open scope because a replica nearly always has some realm's
//   request in flight: counted as open, those requests would hold a
//   searching realm to its share on a pool the rest of the load leaves idle.
// - Shared work — run under `withSharedWork`, for a computation that callers
//   on behalf of several tenants may end up waiting on — is ordered as the
//   tenant whose context started it, but never held to the share. Held to the
//   starter's share, every tenant that joined it would wait at that share,
//   and the joiner's own open scope may be what holds the starter there.
//   Untagged, every tenant's shared work would wait in one arrival-order
//   queue, a quiet tenant's behind a heavy tenant's. Ordered as its starter,
//   a tenant's own shared work is served lowest-held-first like the rest of
//   its work, and shared work it joins is never capped, so it waits only on
//   the ordering.
// - Work that runs while its caller already holds a connection (inside
//   `withConnection`) is granted ahead of everything and outside the share.
//   It cannot finish, and so cannot give back the connection it is nested in,
//   until it gets one; holding it to a share its own tenant's outer holders
//   have used up would deadlock that tenant.
// - Nested work may also go past the limit, but only when the pool is
//   wedged: every connection granted belongs to a hold (an acquisition made
//   with a `ConnectionHold`, as `withConnection` makes), and every one of those
//   holds has nested work of its own queued here. No hold can finish until its
//   nested work is served, so no connection is ever released, and without
//   help nothing queued here is ever served again. Granting one nested
//   acquisition past the limit lets its hold make progress. While any
//   connection out is plain, or any hold has nothing queued (it is still
//   working: running a statement, awaiting something outside the pool),
//   a connection is coming back without help, and nested work waits for it.
//
//   A hold whose own connection is waiting in Postgres for a lock, inside
//   `waitingOnLock`, counts as blocked too. The lock's owner may be another
//   hold here, waiting on nested work, and the waiter cannot give its
//   connection back until that owner finishes. Counted as working, a single
//   lock waiter would keep the pool from ever counting as wedged. The
//   overflow still goes only to nested waiters, never to the lock waiter
//   itself. When the owner is on another replica, the pool may go past its
//   limit before a connection would have come back anyway; the ceiling still
//   bounds it, and `inUse` above the limit then means every hold was waiting,
//   not strictly that the pool could not have recovered alone.
//
//   Past the limit, the most deeply nested waiter goes first, one at a time.
//   A hold granted past the limit is not blocked until its own nested work
//   queues, and that work is nested deeper than anything else waiting, so it
//   is served next. The connections past the limit therefore run down one
//   chain of holds rather than across siblings — a hold running nested holds
//   side by side gets them one after another — and how many are out at once
//   is at most how deep that chain nests. The pool may run up to
//   `limit + overflow` connections for this.
//
//   What this cannot see is a hold waiting on work that is not nested in it:
//   a request it made to this same server, a job it waits on, or shared work
//   (see `withSharedWork`) another caller started outside any hold. Nor a
//   hold waiting on a lock outside `waitingOnLock`, such as a row lock taken
//   with `FOR UPDATE` through its own querier. Such a hold has nothing queued
//   here, so it does not count as blocked, and a pool full of them is not
//   unstuck by this.
//
// Oversubscription is judged on demand — connections granted plus
// acquisitions waiting — rather than on connections in use, because holding a
// tenant to its share is what empties the pool: judged on use, the share
// would lift the moment it took effect, the capped tenant would refill the
// pool, and the share would return, over and over. On demand, the capped
// tenant's own backlog keeps the condition true for as long as it lasts, and
// it lifts once that backlog would fit.
//
// "Has work open" is whether a `withConnectionTenant` scope for the tenant is
// running, not whether it happens to hold or want a connection at this
// instant. A search issues its queries in sequence as often as in parallel,
// and between two of them it holds nothing and asks for nothing; a tenant
// judged by that instant would drop out of contention at every gap, and the
// tenant it was meant to be protected from would refill the pool before its
// next query arrived.
export class ConnectionScheduler {
  #limit: number;
  #overflow: number;
  #tenantShare: number;
  #inUse = 0;
  // The connections granted to holds, by hold: each stays out until the work
  // holding it finishes, which may itself be waiting here. `queued` counts
  // the waiters nested in the hold, at any depth, and `onLock` is whether its
  // own connection is waiting for a lock; a hold with either is blocked.
  #holds = new Map<HoldMarker, HoldState>();
  #blockedHolds = 0;
  // Connections each key holds, for lowest-held-first ordering.
  #held = new Map<TenantKey, number>();
  // The part of `#held` a key's share is judged on: everything but ordered
  // work, which on its own would leave the key untagged (see the policy).
  #heldTowardShare = new Map<TenantKey, number>();
  #queues = new Map<TenantKey, TenantQueues>();
  #nested: Waiter[] = [];
  #waiting = 0;
  #arrivals = 0;
  #now: () => number;
  #unsubscribe: () => void;
  #unsubscribeLockWaits: () => void;

  // `overflow` is how far past `limit` nested work may go while the pool is
  // wedged (see the policy above). What a wedge needs past the limit is how
  // deep one chain of holds nests, so the default — a quarter of the limit,
  // and at least four — leaves room for any nesting the adapter's callers
  // make while keeping `limit + overflow` near the pool's own size. Zero turns
  // it off: a wedged pool then stays wedged.
  // `now` is a monotonic millisecond clock, replaceable so a test can age a
  // waiter without waiting.
  constructor(opts: {
    limit: number;
    tenantShare: number;
    overflow?: number;
    now?: () => number;
  }) {
    this.#limit = normalizeCount(opts.limit);
    this.#overflow =
      opts.overflow === undefined
        ? defaultOverflow(this.#limit)
        : normalizeOverflow(opts.overflow);
    this.#tenantShare = normalizeCount(opts.tenantShare);
    this.#now = opts.now ?? (() => performance.now());
    // A tenant whose last scope closes may leave another tenant's waiters
    // eligible; nothing else would wake them.
    this.#unsubscribe = onScopeClosed(() => this.#drain());
    // A hold starting to wait on a lock may be the last one the pool needed
    // blocked to count as wedged.
    this.#unsubscribeLockWaits = onLockWaitChanged((marker) =>
      this.#lockWaitChanged(marker),
    );
  }

  get limit(): number {
    return this.#limit;
  }

  get tenantShare(): number {
    return this.#tenantShare;
  }

  // The most connections ever granted at once: `limit`, plus the overflow
  // nested work may take while the pool is wedged. The pool beneath must allow
  // this many, or a grant past `limit` would queue inside the pool instead.
  get ceiling(): number {
    return this.#limit + this.#overflow;
  }

  // Connections currently granted. Above `limit` only once the pool wedged:
  // every connection a hold, every hold waiting on nested work.
  get inUse(): number {
    return this.#inUse;
  }

  // The part of `inUse` granted to holds.
  get holds(): number {
    return this.#holds.size;
  }

  // Acquisitions waiting for a connection, whether for want of a free one or
  // because their tenant is at its share.
  get waiting(): number {
    return this.#waiting;
  }

  // How long the acquisition that has waited longest has been waiting, in
  // milliseconds; 0 when none is waiting. Saturation that is only load keeps
  // this short however many acquisitions queue, because the queue keeps
  // moving. A pool whose connections are held by work that is not finishing
  // stops granting, and this climbs for as long as that lasts — so it, not the
  // number waiting, tells a stuck pool from a busy one.
  get oldestWaitMs(): number {
    let oldest: number | undefined;
    let consider = (waiters: Waiter[]) => {
      // Each queue is in arrival order, so its head is its oldest.
      let head = waiters[0];
      if (head && (oldest === undefined || head.since < oldest)) {
        oldest = head.since;
      }
    };
    consider(this.#nested);
    for (let queues of this.#queues.values()) {
      consider(queues.capped);
      consider(queues.shared);
    }
    return oldest === undefined ? 0 : Math.max(0, this.#now() - oldest);
  }

  // Acquisitions waiting only because their tenant is at its share — the ones
  // a free connection would not be handed to.
  get waitingAtShare(): number {
    let count = 0;
    for (let [key, queues] of this.#queues) {
      if (!this.#eligible(key)) {
        count += queues.capped.length;
      }
    }
    return count;
  }

  // Resolves with a release once this caller may check out a connection. The
  // tenant and nesting are read from the async context the call is made in.
  // `hold` says the caller keeps the connection while it does other work that
  // may need connections of its own, as `withConnection` does, rather than
  // giving it back once its statement returns; that work runs through the
  // hold's `run`.
  acquire(opts?: { hold?: ConnectionHold }): Promise<() => void> {
    let scope = scopeStorage.getStore();
    let key: TenantKey = scope?.tenant ?? UNTAGGED;
    let nested = holdsConnection(scope?.holding);
    let hold = opts?.hold ? holdMarkers.get(opts.hold) : undefined;
    // Shared and ordered work are both ordered as their tenant but never held
    // to its share, so both wait in the queue the share does not apply to.
    let ordered = scope?.ordered === true;
    let shared = scope?.shared === true || ordered;
    // This arrival counts toward the demand it is judged against.
    if (
      this.#inUse < this.#limit &&
      (nested || shared || this.#eligible(key, 1))
    ) {
      return Promise.resolve(this.#grant(key, ordered, hold));
    }
    return new Promise((resolve) => {
      let waiter: Waiter = {
        key,
        ordered,
        hold,
        arrival: this.#arrivals++,
        since: this.#now(),
        resolve,
      };
      this.#waiting++;
      if (nested) {
        waiter.nestedIn = scope!.holding;
        waiter.depth = chainLength(scope!.holding);
        this.#nested.push(waiter);
        this.#noteQueued(waiter.nestedIn, 1);
        // Queued, this waiter may be what blocks the last unblocked hold.
        this.#drain();
      } else {
        let queues = this.#queues.get(key);
        if (!queues) {
          queues = { capped: [], shared: [] };
          this.#queues.set(key, queues);
        }
        (shared ? queues.shared : queues.capped).push(waiter);
      }
    });
  }

  // Stop listening for scope changes. Waiters still queued stay queued; the
  // owner is expected to have stopped issuing work.
  dispose(): void {
    this.#unsubscribe();
    this.#unsubscribeLockWaits();
  }

  // Whether a free connection may go to `key`. `arriving` is demand not yet
  // queued — the acquisition asking, when it has not had to wait.
  #eligible(key: TenantKey, arriving = 0): boolean {
    if (key === UNTAGGED) {
      return true;
    }
    if ((this.#heldTowardShare.get(key) ?? 0) < this.#tenantShare) {
      return true;
    }
    if (this.#inUse + this.#waiting + arriving <= this.#limit) {
      return true;
    }
    return !anotherTenantOpen(key);
  }

  // Whether the pool is wedged and may grant nested work past the limit:
  // every connection out is a hold, every hold has nested work queued, and
  // there is overflow left (see the policy). A hold waiting on a lock counts
  // as having nested work queued.
  #wedged(): boolean {
    return (
      this.#inUse >= this.#limit &&
      this.#inUse < this.ceiling &&
      this.#inUse === this.#holds.size &&
      this.#blockedHolds === this.#holds.size
    );
  }

  // Count a nested waiter as queued in (`delta` 1) or no longer queued in
  // (`delta` -1) every hold of this scheduler it is nested in.
  #noteQueued(marker: HoldMarker | undefined, delta: 1 | -1): void {
    for (let m = marker; m; m = m.parent) {
      let state = this.#holds.get(m);
      if (state) {
        this.#updateHold(state, () => (state.queued += delta));
      }
    }
  }

  #lockWaitChanged(marker: HoldMarker): void {
    let state = this.#holds.get(marker);
    if (!state) {
      return;
    }
    this.#updateHold(state, () => (state.onLock = marker.lockWaits > 0));
    this.#drain();
  }

  // Apply `change` to a hold's state, keeping `#blockedHolds` in step.
  #updateHold(state: HoldState, change: () => void): void {
    let before = isBlocked(state);
    change();
    let after = isBlocked(state);
    if (!before && after) {
      this.#blockedHolds++;
    } else if (before && !after) {
      this.#blockedHolds--;
    }
  }

  // Remove and return the nested waiter that goes past the limit: the most
  // deeply nested, the earlier arrival winning a tie.
  #takeDeepestNestedWaiter(): Waiter | undefined {
    let index = -1;
    for (let i = 0; i < this.#nested.length; i++) {
      if (index === -1 || this.#nested[i].depth! > this.#nested[index].depth!) {
        index = i;
      }
    }
    return index === -1 ? undefined : this.#nested.splice(index, 1)[0];
  }

  #grant(
    key: TenantKey,
    ordered: boolean,
    hold: HoldMarker | undefined,
  ): () => void {
    this.#inUse++;
    if (hold) {
      let state: HoldState = { queued: 0, onLock: hold.lockWaits > 0 };
      this.#holds.set(hold, state);
      if (isBlocked(state)) {
        this.#blockedHolds++;
      }
    }
    increment(this.#held, key);
    if (!ordered) {
      increment(this.#heldTowardShare, key);
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.#inUse--;
      if (hold) {
        let state = this.#holds.get(hold);
        if (state && isBlocked(state)) {
          this.#blockedHolds--;
        }
        this.#holds.delete(hold);
      }
      decrement(this.#held, key);
      if (!ordered) {
        decrement(this.#heldTowardShare, key);
      }
      this.#drain();
    };
  }

  #drain(): void {
    for (;;) {
      let next: Waiter | undefined;
      if (this.#inUse < this.#limit) {
        next = this.#nested.shift() ?? this.#takeNextTenantWaiter();
      } else if (this.#wedged()) {
        next = this.#takeDeepestNestedWaiter();
      }
      if (!next) {
        return;
      }
      this.#waiting--;
      if (next.nestedIn) {
        this.#noteQueued(next.nestedIn, -1);
      }
      next.resolve(this.#grant(next.key, next.ordered, next.hold));
    }
  }

  // The next waiter of the tenant holding the fewest connections among those
  // with a waiter a free connection may go to, the earlier arrival winning a
  // tie. Within a tenant that is the earlier of its shared work, which is
  // always eligible, and its other work, which is eligible only while the
  // tenant is not held to its share.
  #takeNextTenantWaiter(): Waiter | undefined {
    let best:
      | { key: TenantKey; queues: TenantQueues; from: Waiter[]; held: number }
      | undefined;
    for (let [key, queues] of this.#queues) {
      let from: Waiter[] | undefined = queues.shared.length
        ? queues.shared
        : undefined;
      if (
        queues.capped.length &&
        (!from || queues.capped[0].arrival < from[0].arrival) &&
        this.#eligible(key)
      ) {
        from = queues.capped;
      }
      if (!from) {
        continue;
      }
      let held = this.#held.get(key) ?? 0;
      if (
        !best ||
        held < best.held ||
        (held === best.held && from[0].arrival < best.from[0].arrival)
      ) {
        best = { key, queues, from, held };
      }
    }
    if (!best) {
      return undefined;
    }
    let waiter = best.from.shift()!;
    if (best.queues.capped.length === 0 && best.queues.shared.length === 0) {
      this.#queues.delete(best.key);
    }
    return waiter;
  }
}

// Run `fn` with the database work it does charged to `tenant`, and with the
// tenant counted as having work open until `fn` settles. Nests: an inner
// scope's tenant is the one its work is charged to.
export async function withConnectionTenant<T>(
  tenant: string,
  fn: () => Promise<T>,
): Promise<T> {
  let parent = scopeStorage.getStore();
  openScopes.set(tenant, (openScopes.get(tenant) ?? 0) + 1);
  try {
    return await scopeStorage.run(
      { tenant, ...(parent?.holding ? { holding: parent.holding } : {}) },
      fn,
    );
  } finally {
    let count = (openScopes.get(tenant) ?? 1) - 1;
    if (count > 0) {
      openScopes.set(tenant, count);
    } else {
      openScopes.delete(tenant);
      for (let listener of [...scopeClosedListeners]) {
        listener();
      }
    }
  }
}

// Run `fn` as shared work: a computation that callers on behalf of several
// tenants may end up waiting on, such as one a coalescing cache hands to every
// caller that asks for the same thing while it runs. Its database work stays
// ordered as the tenant that started it but is never held to a share (see the
// policy above). A connection the caller holds stays held: nested work keeps
// its exemption.
export function withSharedWork<T>(fn: () => Promise<T>): Promise<T> {
  let parent = scopeStorage.getStore();
  return scopeStorage.run({ ...parent, shared: true }, fn);
}

// Whether the calling async context is running shared work.
export function isSharedWork(): boolean {
  return scopeStorage.getStore()?.shared === true;
}

// A checked-out connection kept across other work. The work run through
// `run` is marked as holding it, so the acquisitions it makes are granted as
// nested ones, until `end` is called. Passed to `ConnectionScheduler.acquire`
// as the acquisition's `hold`, it also lets the scheduler tell when that work
// is waiting on it (see the policy). For the adapter's own use around a
// callback it hands a pinned connection to.
//
// The mark is ended rather than scoped to `run`'s promise because a callback
// can go on working after it gives its connection back — a lock section that
// releases early continues its write with the locks gone — and that work no
// longer holds anything a waiter could be deadlocked behind.
export interface ConnectionHold {
  run<T>(fn: () => Promise<T>): Promise<T>;
  hold(): void;
  end(): void;
}

// Make the hold before acquiring its connection, in the context the
// acquisition is made from, so that it nests inside any hold that context is
// already running in.
//
// `{ held: false }` starts the mark off, for a callback that checks its
// connection out later (a read snapshot opened at its first statement):
// `hold` turns it on once the connection is checked out.
export function markConnectionHeld(opts?: { held?: boolean }): ConnectionHold {
  let parent = scopeStorage.getStore();
  let holding: HoldMarker = {
    held: opts?.held ?? true,
    lockWaits: 0,
    ...(parent?.holding ? { parent: parent.holding } : {}),
  };
  let scope: ConnectionScope = { ...parent, holding };
  let hold: ConnectionHold = {
    run: (fn) => scopeStorage.run(scope, fn),
    hold: () => {
      holding.held = true;
    },
    end: () => {
      holding.held = false;
    },
  };
  holdMarkers.set(hold, holding);
  return hold;
}

// Run `fn`, a statement on the calling hold's own connection that waits in
// Postgres for a lock (`pg_advisory_xact_lock` and the like), with the hold
// counted as blocked until it settles (see the policy). Outside any hold it
// just runs `fn`: a plain statement waiting on a lock holds no connection a
// hold here could be waiting for.
export async function waitingOnLock<T>(fn: () => Promise<T>): Promise<T> {
  let marker = scopeStorage.getStore()?.holding;
  if (!marker?.held) {
    return await fn();
  }
  marker.lockWaits++;
  notifyLockWaitChanged(marker);
  try {
    return await fn();
  } finally {
    marker.lockWaits--;
    notifyLockWaitChanged(marker);
  }
}

// Run `fn` with the database work it does ordered as `tenant`, but held to no
// share and without counting the tenant as having work open (see the policy
// above). A `withConnectionTenant` scope inside it takes over as usual, so a
// search reached through it is still held to its share.
export function withConnectionOrdering<T>(
  tenant: string,
  fn: () => Promise<T>,
): Promise<T> {
  let parent = scopeStorage.getStore();
  return scopeStorage.run(
    {
      tenant,
      ordered: true,
      ...(parent?.holding ? { holding: parent.holding } : {}),
    },
    fn,
  );
}

// The tenant the calling async context's database work is charged to, if any.
export function currentConnectionTenant(): string | undefined {
  return scopeStorage.getStore()?.tenant;
}

interface ConnectionScope {
  tenant?: string;
  holding?: HoldMarker;
  shared?: boolean;
  ordered?: boolean;
}

// One checked-out connection some enclosing frame holds. Chained, because a
// callback can check out a second connection inside the first: ending the
// inner mark leaves the outer one's work still nested.
interface HoldMarker {
  held: boolean;
  // Statements on this hold's own connection waiting for a lock.
  lockWaits: number;
  parent?: HoldMarker;
}

interface HoldState {
  queued: number;
  onLock: boolean;
}

function isBlocked(state: HoldState): boolean {
  return state.queued > 0 || state.onLock;
}

// How many holds a nested waiter's work runs inside.
function chainLength(marker: HoldMarker | undefined): number {
  let length = 0;
  for (let m = marker; m; m = m.parent) {
    length++;
  }
  return length;
}

function holdsConnection(marker: HoldMarker | undefined): boolean {
  for (let m = marker; m; m = m.parent) {
    if (m.held) {
      return true;
    }
  }
  return false;
}

interface Waiter {
  key: TenantKey;
  ordered: boolean;
  // The hold this acquisition is for, when it is one.
  hold?: HoldMarker;
  // For a nested waiter: the innermost hold its work runs inside, and how
  // many holds deep that is.
  nestedIn?: HoldMarker;
  depth?: number;
  arrival: number;
  // When it started waiting, on the scheduler's clock.
  since: number;
  resolve: (release: () => void) => void;
}

// A tenant's waiters, split by whether the share applies to them, so that
// shared and ordered work never wait behind the tenant's capped work to reach
// the front.
interface TenantQueues {
  capped: Waiter[];
  shared: Waiter[];
}

// Untagged work shares one key. A symbol, so no tenant string can collide
// with it.
const UNTAGGED = Symbol('untagged');
type TenantKey = string | typeof UNTAGGED;

// Module state rather than per scheduler: a scope is opened by request
// handling that knows nothing of which adapter its queries will reach, and a
// process normally has one.
const scopeStorage = new AsyncLocalStorage<ConnectionScope>();
const holdMarkers = new WeakMap<ConnectionHold, HoldMarker>();
const openScopes = new Map<string, number>();
const scopeClosedListeners = new Set<() => void>();
const lockWaitListeners = new Set<(marker: HoldMarker) => void>();

function onLockWaitChanged(listener: (marker: HoldMarker) => void): () => void {
  lockWaitListeners.add(listener);
  return () => lockWaitListeners.delete(listener);
}

function notifyLockWaitChanged(marker: HoldMarker): void {
  for (let listener of [...lockWaitListeners]) {
    listener(marker);
  }
}

function onScopeClosed(listener: () => void): () => void {
  scopeClosedListeners.add(listener);
  return () => scopeClosedListeners.delete(listener);
}

function anotherTenantOpen(key: string): boolean {
  for (let tenant of openScopes.keys()) {
    if (tenant !== key) {
      return true;
    }
  }
  return false;
}

function increment(counts: Map<TenantKey, number>, key: TenantKey): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function decrement(counts: Map<TenantKey, number>, key: TenantKey): void {
  let count = (counts.get(key) ?? 1) - 1;
  if (count > 0) {
    counts.set(key, count);
  } else {
    counts.delete(key);
  }
}

// The overflow when the caller names none (see the constructor).
function defaultOverflow(limit: number): number {
  return Math.max(4, Math.ceil(limit / 4));
}

// An overflow is a whole number of connections, and may be zero.
function normalizeOverflow(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

// A count is a positive integer; anything else would either grant nothing or
// compare against NaN and stall every acquisition.
function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  let floored = Math.floor(value);
  return floored < 1 ? 1 : floored;
}
