import { AsyncLocalStorage } from 'node:async_hooks';

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
// - Untagged work — anything not run under `withConnectionTenant`, which is
//   everything but search — is ordered with the tenants as one more of them
//   but never held to the share, and never counts as another tenant with work
//   open. Its connections do count toward whether the pool is oversubscribed.
//   Writes, locks and the indexer's own commits keep the reach they had.
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
  #tenantShare: number;
  #inUse = 0;
  #held = new Map<TenantKey, number>();
  #queues = new Map<TenantKey, TenantQueues>();
  #nested: Waiter[] = [];
  #waiting = 0;
  #arrivals = 0;
  #unsubscribe: () => void;

  constructor(opts: { limit: number; tenantShare: number }) {
    this.#limit = normalizeCount(opts.limit);
    this.#tenantShare = normalizeCount(opts.tenantShare);
    // A tenant whose last scope closes may leave another tenant's waiters
    // eligible; nothing else would wake them.
    this.#unsubscribe = onScopeClosed(() => this.#drain());
  }

  get limit(): number {
    return this.#limit;
  }

  get tenantShare(): number {
    return this.#tenantShare;
  }

  // Connections currently granted.
  get inUse(): number {
    return this.#inUse;
  }

  // Acquisitions waiting for a connection, whether for want of a free one or
  // because their tenant is at its share.
  get waiting(): number {
    return this.#waiting;
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
  acquire(): Promise<() => void> {
    let scope = scopeStorage.getStore();
    let key: TenantKey = scope?.tenant ?? UNTAGGED;
    let nested = holdsConnection(scope?.holding);
    let shared = scope?.shared === true;
    // This arrival counts toward the demand it is judged against.
    if (
      this.#inUse < this.#limit &&
      (nested || shared || this.#eligible(key, 1))
    ) {
      return Promise.resolve(this.#grant(key));
    }
    return new Promise((resolve) => {
      let waiter: Waiter = { key, arrival: this.#arrivals++, resolve };
      this.#waiting++;
      if (nested) {
        this.#nested.push(waiter);
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
  }

  // Whether a free connection may go to `key`. `arriving` is demand not yet
  // queued — the acquisition asking, when it has not had to wait.
  #eligible(key: TenantKey, arriving = 0): boolean {
    if (key === UNTAGGED) {
      return true;
    }
    if ((this.#held.get(key) ?? 0) < this.#tenantShare) {
      return true;
    }
    if (this.#inUse + this.#waiting + arriving <= this.#limit) {
      return true;
    }
    return !anotherTenantOpen(key);
  }

  #grant(key: TenantKey): () => void {
    this.#inUse++;
    this.#held.set(key, (this.#held.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.#inUse--;
      let held = (this.#held.get(key) ?? 1) - 1;
      if (held > 0) {
        this.#held.set(key, held);
      } else {
        this.#held.delete(key);
      }
      this.#drain();
    };
  }

  #drain(): void {
    while (this.#inUse < this.#limit) {
      let next = this.#nested.shift() ?? this.#takeNextTenantWaiter();
      if (!next) {
        return;
      }
      this.#waiting--;
      next.resolve(this.#grant(next.key));
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

// Mark the work run through the returned `run` as holding a checked-out
// connection, so the acquisitions it makes are granted as nested ones, until
// `end` is called. For the adapter's own use around a callback it hands a
// pinned connection to.
//
// The mark is ended rather than scoped to `run`'s promise because a callback
// can go on working after it gives its connection back — a lock section that
// releases early continues its write with the locks gone — and that work no
// longer holds anything a waiter could be deadlocked behind.
export function markConnectionHeld(): {
  run<T>(fn: () => Promise<T>): Promise<T>;
  end(): void;
} {
  let parent = scopeStorage.getStore();
  let holding: HoldMarker = {
    held: true,
    ...(parent?.holding ? { parent: parent.holding } : {}),
  };
  let scope: ConnectionScope = { ...parent, holding };
  return {
    run: (fn) => scopeStorage.run(scope, fn),
    end: () => {
      holding.held = false;
    },
  };
}

// The tenant the calling async context's database work is charged to, if any.
export function currentConnectionTenant(): string | undefined {
  return scopeStorage.getStore()?.tenant;
}

interface ConnectionScope {
  tenant?: string;
  holding?: HoldMarker;
  shared?: boolean;
}

// One checked-out connection some enclosing frame holds. Chained, because a
// callback can check out a second connection inside the first: ending the
// inner mark leaves the outer one's work still nested.
interface HoldMarker {
  held: boolean;
  parent?: HoldMarker;
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
  arrival: number;
  resolve: (release: () => void) => void;
}

// A tenant's waiters, split by whether the share applies to them, so that
// shared work never waits behind the tenant's capped work to reach the front.
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
const openScopes = new Map<string, number>();
const scopeClosedListeners = new Set<() => void>();

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

// A count is a positive integer; anything else would either grant nothing or
// compare against NaN and stall every acquisition.
function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  let floored = Math.floor(value);
  return floored < 1 ? 1 : floored;
}
