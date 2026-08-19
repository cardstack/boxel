import type { DBAdapter, TypeCoercion } from './db.ts';
import {
  addExplicitParens,
  any,
  dbExpression,
  every,
  param,
  query,
  separatedByCommas,
  type Expression,
  type Querier,
} from './expression.ts';
import { clampSerializedError, type SerializedError } from './error.ts';
import { logger } from './log.ts';

// Debug instrumentation for diagnosing pre-warm vs visit-phase cache-key
// mismatches: every cache read logs its exact key + HIT/MISS, every write
// logs its key, and each definition load is tagged pre-warm vs on-demand.
// Off unless `LOG_LEVELS` enables it, e.g. `*=info,definition-cache-key=debug`.
const log = logger('definition-lookup');
const keyLog = logger('definition-cache-key');
function fmtKey(
  moduleUrl: string,
  cacheScope: string,
  authUserId: string,
  resolvedRealmURL: string,
): string {
  return `module=${moduleUrl} scope=${cacheScope} user=${authUserId || '(empty)'} realm=${resolvedRealmURL}`;
}
import {
  fetchUserPermissions,
  flattenPrerenderMeta,
  internalKeyFor,
  type Definition,
  type ErrorEntry,
  type ModuleDefinitionResult,
  type ModuleRenderResponse,
  type Prerenderer,
  type Realm,
  type RealmPermissions,
  type ResolvedCodeRef,
  type Diagnostics,
  executableExtensions,
  hasExecutableExtension,
  trimExecutableExtension,
} from './index.ts';
import { rri, type RealmResourceIdentifier } from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';

const MODULES_TABLE = 'modules';
const PREFERRED_EXECUTABLE_EXTENSIONS = ['.gts', '.ts', '.gjs', '.js'];
// Postgres NOTIFY channel for cross-instance module-cache invalidation
// (CS-10952). Each invalidation path emits one or more notifications so
// peer realm-server processes can bump their in-memory generation counters
// in lockstep with the DB. Payload is JSON; one of:
//   {"k":"module","r":<resolvedRealmURL>,"m":[<moduleURL>,...]} — invalidate fan-out
//   {"k":"realm","r":<resolvedRealmURL>}                        — clearRealmDefinitions
//   {"k":"global"}                                              — clearAllDefinitions
// Self-notify is idempotent: the emitting process already bumped its
// counter synchronously before the DB delete, and a second bump on
// listener receive is observationally equivalent (counters are monotonic
// and only used for snapshot equality).
export const MODULE_CACHE_INVALIDATED_CHANNEL = 'module_cache_invalidated';
// Postgres caps NOTIFY payloads at 8000 bytes; stay well under so JSON
// encoding overhead and pathological URL lengths don't blow the limit.
const NOTIFY_PAYLOAD_BUDGET = 7000;
// Postgres NOTIFY channel for cross-instance prerender-coalesce wakeups
// (CS-10953). The winner of a `pg_try_advisory_xact_lock` for a given
// inFlightKey emits this notify (with the inFlightKey as payload) inside
// the same transaction as its persistDefinitionCacheEntry, so peer waiters
// see the signal only on commit (the cache row is visible to their
// re-read by the time their wait resolves). Loser path on
// missed-NOTIFY falls back to a bounded-timeout re-read.
export const MODULE_CACHE_POPULATED_CHANNEL = 'module_cache_populated';
// Cached module errors expire after this interval. When a stale error entry
// is encountered, the prerenderer is called again to get a fresh result.
// This prevents transient prerender failures from being permanently cached.
const ERROR_CACHE_TTL_MS = 30_000; // 30 seconds
// CS-10953 cross-process populate-coalesce loser-path wait timeout. The
// loser blocks on a peer's NOTIFY; on timeout (peer crashed mid-prerender,
// missed wakeup, etc.), the loop re-reads the cache and may take another
// shot at the lock. Set well above realistic prerender wall time
// (single-module prerenders are sub-second to a few seconds; the absolute
// upper bound is the prerender request timeout, currently 150s in
// production) so a healthy peer's prerender always wakes the loser
// before this fires.
const COALESCE_NOTIFY_WAIT_MS = 180_000; // 180 seconds
// Bounded retry loop in the coordinated path. Each iteration re-reads
// the cache, contends for the lock, and (if losing) waits on NOTIFY. A
// pathological peer crash-loop or NOTIFY drop sequence could in
// principle cycle the loser indefinitely; capping at a small number and
// throwing surfaces it instead of silently hanging.
const COALESCE_MAX_ITERATIONS = 4;
const modulesTableCoerceTypes: TypeCoercion = Object.freeze({
  definitions: 'JSON',
  deps: 'JSON',
  error_doc: 'JSON',
});

function canonicalURL(
  url: string,
  relativeTo: string | undefined,
  virtualNetwork: VirtualNetwork,
): string {
  // Resolve registered prefix identifiers (e.g. @cardstack/catalog/foo)
  // to real URLs so that realm-membership checks and DB lookups work.
  if (virtualNetwork.isRegisteredPrefix(url)) {
    try {
      return toFetchableForm(virtualNetwork.toURL(url), virtualNetwork);
    } catch (_e) {
      // fall through to normal URL handling
    }
  }
  try {
    let parsed = new URL(url, relativeTo);
    parsed.search = '';
    parsed.hash = '';
    return toFetchableForm(parsed, virtualNetwork);
  } catch (_e) {
    let stripped = url.split('#')[0] ?? url;
    return stripped.split('?')[0] ?? stripped;
  }
}

// A base-realm module resolves to a real URL (e.g.
// `http://localhost:4201/base/X`), but that realm is reachable in-process
// only under its virtual-alias URL (`https://cardstack.com/base/X`) — the
// alias is what the loader's mounted handler / origin-matched auth
// interceptor recognizes. A direct fetch of the bare real URL bypasses
// that and fails at the transport, poisoning the module's definition
// entry. When a real→virtual URL mapping is registered (only base today),
// return the alias form so the definition-load target is fetchable.
// Realms with no alias map (user realms, catalog, …) are served at their
// real URL and are returned unchanged.
function toFetchableForm(real: URL, virtualNetwork: VirtualNetwork): string {
  let virtual = virtualNetwork.mapURL(real, 'real-to-virtual');
  return (virtual ?? real).href;
}

function normalizeExecutableURL(url: string): string {
  return trimExecutableExtension(rri(url));
}

// Application-level dedup key. Coalesces two concurrent lookups only when
// they would hit the same (resolvedRealmURL, cache_scope, auth_user_id,
// moduleURL) lookup context. This does NOT mirror the modules-table primary
// key exactly: file_alias variants are intentionally not coalesced, because
// a caller asking for an extensionless path walks a different
// populationCandidates loop than a caller asking for `foo.gts` directly —
// coalescing them could strand one behind the other's narrower search.
function inFlightKey(args: {
  resolvedRealmURL: string;
  moduleURL: string;
  cacheScope: CacheScope;
  cacheUserId: string;
}): string {
  return `${args.resolvedRealmURL}|${args.moduleURL}|${args.cacheScope}|${args.cacheUserId}`;
}

// Module-generation key. Intentionally keyed on (realm, moduleURL) — not
// (realm, moduleURL, scope, user) — because the invalidation paths that
// bump it don't discriminate by cache scope or auth user (they delete all
// rows for the URL), so every scope/user combo for the same URL shares
// one counter.
function moduleGenerationKey(
  resolvedRealmURL: string,
  moduleURL: string,
): string {
  return `${resolvedRealmURL}|${moduleURL}`;
}

function parseJsonValue<T>(value: T | string | null): T | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch (_err) {
      return null;
    }
  }
  return value as T;
}

export type CacheScope = 'public' | 'realm-auth';
type LocalRealm = Pick<Realm, 'url' | 'getRealmOwnerUserId' | 'visibility'>;

export interface DefinitionCacheEntry {
  definitions: Record<string, ModuleDefinitionResult | ErrorEntry>;
  deps: string[];
  error?: ErrorEntry;
  cacheScope: CacheScope;
  authUserId?: string;
  resolvedRealmURL: string;
  createdAt?: number;
}

export interface DefinitionCacheEntryQuery {
  moduleUrls: string[];
  cacheScope: CacheScope;
  authUserId: string;
  resolvedRealmURL: string;
}

export type DefinitionCacheEntries = Record<string, DefinitionCacheEntry>;

interface WriteToDatabaseCacheParams {
  moduleUrl: string;
  moduleAlias: string;
  definitions: Record<string, ModuleDefinitionResult | ErrorEntry>;
  deps: string[];
  errorDoc: ErrorEntry | undefined;
  resolvedRealmURL: string;
  cacheScope: CacheScope;
  authUserId: string;
  // Server-observed render timings + host-side breadcrumbs flattened from
  // the prerender response's `meta` block (same shape as
  // `boxel_index.diagnostics`). Lets operators query slow / hung
  // module renders the same way they query slow / hung card renders.
  diagnostics?: Diagnostics;
}

export class FilterRefersToNonexistentTypeError extends Error {
  codeRef: ResolvedCodeRef;

  constructor(codeRef: ResolvedCodeRef, opts?: { cause?: unknown }) {
    super(
      `Your filter refers to a nonexistent type: import { ${codeRef.name} } from "${codeRef.module}". If this type exists, it may be caused by a stale modules cache. Clearing the "modules" table in the database can fix this.`,
    );
    this.name = 'FilterRefersToNonexistentTypeError';
    this.codeRef = codeRef;
    if (opts?.cause !== undefined) {
      (this as any).cause = opts.cause;
    }
    // make sure instances of this Error subclass behave like instances of the subclass should
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
export function isFilterRefersToNonexistentTypeError(
  error: unknown,
): error is FilterRefersToNonexistentTypeError {
  return error instanceof FilterRefersToNonexistentTypeError;
}

// CS-10953 cross-process prerender-coalesce dependency. When provided,
// CachingDefinitionLookup routes its uncached load through the coordinator
// so at most one realm-server process per coalesce key reaches the
// prerenderer; peer processes block on NOTIFY and re-read the populated
// row instead of redundant prerender round-trips.
//
// Two methods rather than one because the winner's transaction (lock +
// fn + NOTIFY + commit) and the loser's NOTIFY-or-timeout wait are
// fundamentally different shapes: the winner runs a critical section
// pinned to one connection; the loser is a passive subscriber that the
// winner's NOTIFY (or a timeout) wakes.
//
// `tryAcquireAndRun` returns a discriminated union rather than throwing
// on contention because contention is the expected loser path, not an
// error condition.
//
// `waitForKey` resolves on either the NOTIFY or the timeout — both are
// acceptable handoffs back to the caller's loop. The loop's next
// iteration re-reads the cache; on healthy peer the row is now there
// and the loop exits.
//
// Sqlite/in-memory deployments don't construct a coordinator —
// CachingDefinitionLookup runs its uncoordinated path when this is
// undefined.
export interface PopulateCoordinator {
  // Try to acquire the cross-process coalesce lock for `coalesceKey`. If
  // acquired, run `fn` inside the same transaction as the lock + emit
  // pg_notify on the populate channel + commit. If contended, return
  // `{ acquired: false }` immediately so the caller can transition to
  // the loser path.
  //
  // `fn` receives the pinned querier that holds the advisory lock. DB
  // work it does through that querier shares the lock's single pinned
  // connection rather than checking out additional pool clients — which
  // matters because each distinct coalesce key wins its own lock, so a
  // burst of N distinct-key winners would otherwise pin N connections
  // AND each need another for its own queries, deadlocking the pool when
  // N approaches the pool ceiling. Callers that don't need the querier
  // (their inner work is a prerender or otherwise not DB-bound) may
  // ignore it and continue using the shared dbAdapter.
  tryAcquireAndRun<T>(
    coalesceKey: string,
    fn: (querier: Querier) => Promise<T>,
  ): Promise<{ acquired: true; result: T } | { acquired: false }>;
  // Wait until a NOTIFY for `coalesceKey` arrives on the populate
  // channel, or `timeoutMs` elapses — whichever comes first. Resolves in
  // both cases. The caller's loop re-reads the cache regardless of
  // which path resolved.
  waitForKey(coalesceKey: string, timeoutMs: number): Promise<void>;
}

// Public option shape for definition lookup calls. `priority` is forwarded to
// the prerender server when a cache miss requires a sub-prerender — same
// numeric scale as worker-job priority (`systemInitiatedPriority` for
// background work, `userInitiatedPriority` for user-driven work). Callers in
// the indexer thread their job
// priority through here so user-initiated reindex work doesn't silently
// downgrade to background priority for its module sub-renders.
export interface DefinitionLookupOptions {
  priority?: number;
}

// Explicit cache context for a read-through populate. Callers that
// already know the realm context (the worker's module pre-warm, which runs
// against a bare lookup that has no registered realm and thus cannot
// self-resolve a context) supply it directly instead of relying on
// `buildLookupContext`'s `#realms` / remote-probe resolution.
export interface PopulateDefinitionCacheEntryArgs {
  moduleURL: string;
  realmURL: string;
  resolvedRealmURL: string;
  cacheScope: CacheScope;
  cacheUserId: string;
  prerenderUserId: string;
  priority?: number;
}

export interface DefinitionLookup {
  lookupDefinition(
    codeRef: ResolvedCodeRef,
    opts?: DefinitionLookupOptions,
  ): Promise<Definition>;
  // Like lookupDefinition but does not trigger a prerenderer call or
  // populate missing definitions. It may still perform lookup-context
  // resolution (including remote visibility probing) before reading from the
  // database cache. Returns undefined when the definition is not yet cached.
  lookupCachedDefinition(
    codeRef: ResolvedCodeRef,
  ): Promise<Definition | undefined>;
  invalidate(moduleURL: string): Promise<string[]>;
  clearRealmDefinitions(resolvedRealmURL: string): Promise<void>;
  clearAllDefinitions(): Promise<void>;
  registerRealm(realm: LocalRealm): void;
  forRealm(realm: LocalRealm): DefinitionLookup;
  getCachedDefinitions(
    moduleUrl: string,
    opts?: DefinitionLookupOptions,
  ): Promise<DefinitionCacheEntry | undefined>;
  // Like getCachedDefinitions, but the caller supplies the cache context
  // explicitly rather than letting `buildLookupContext` self-resolve it.
  // Required by callers running against a lookup with no registered realm
  // (the worker's module pre-warm), where self-resolution returns
  // null and the populate silently no-ops.
  populateDefinitionCacheEntry(
    args: PopulateDefinitionCacheEntryArgs,
  ): Promise<DefinitionCacheEntry | undefined>;
  getCachedDefinitionsBatch(
    query: DefinitionCacheEntryQuery,
  ): Promise<DefinitionCacheEntries>;
}

interface LookupContext {
  requestingRealm?: LocalRealm;
  // Worker-job priority forwarded into sub-`prerenderModule` calls for
  // definition cache misses. Origin is the `x-boxel-job-priority`
  // header on `_federated-search` calls during a prerendered card
  // render — `handle-search` sanitizes the header and passes it into
  // `RealmIndexQueryEngine`'s search opts; the search engine threads
  // it here when it calls `lookupDefinition`.
  priority?: number;
}

export class CachingDefinitionLookup implements DefinitionLookup {
  #dbAdapter: DBAdapter;
  #prerenderer: Prerenderer;
  #fetch: typeof fetch;
  #virtualNetwork: VirtualNetwork;
  #realms: LocalRealm[] = [];
  #createPrerenderAuth: (
    userId: string,
    permissions: RealmPermissions,
  ) => string;
  // Dedupes concurrent loadDefinitionCacheEntry calls that would hit the same
  // cache row so a single prerenderer round-trip is shared by all waiters
  // instead of each caller racing to the prerenderer independently.
  #inFlight = new Map<string, Promise<DefinitionCacheEntry | undefined>>();
  // Invalidation generations. Bumped synchronously by invalidate /
  // clearRealmDefinitions / clearAllDefinitions before the DB delete.
  // loadDefinitionCacheEntryUncached snapshots all three values at entry and
  // re-checks them just before persist; if any changed, the in-flight
  // prerender's result is discarded rather than re-inserted, so the cache
  // wipe isn't undone by a prerender that started against pre-invalidation
  // state. Three scopes, matching the three invalidation paths exactly:
  //   - #moduleGenerations: keyed by `${resolvedRealmURL}|${moduleURL}`;
  //     bumped by invalidate() for each URL in its fan-out. Scoping to the
  //     specific URLs avoids spuriously discarding an in-flight prerender
  //     for an unrelated module in the same realm.
  //   - #realmGenerations: keyed by `resolvedRealmURL`; bumped by
  //     clearRealmDefinitions() so every in-flight prerender for that realm is
  //     invalidated, including modules not yet in #moduleGenerations.
  //   - #globalGeneration: bumped by clearAllDefinitions() so every in-flight
  //     prerender is invalidated regardless of realm or module URL.
  #moduleGenerations = new Map<string, number>();
  #realmGenerations = new Map<string, number>();
  #globalGeneration = 0;
  // CS-10953 cross-process prerender coalescer. Optional — when undefined,
  // loadDefinitionCacheEntryUncached runs the original uncoordinated path.
  // Constructed only by the realm-server main when
  // PRERENDER_COALESCE_ACROSS_PROCESSES is enabled and the dbAdapter is pg.
  #populateCoordinator?: PopulateCoordinator;

  constructor(
    dbAdapter: DBAdapter,
    prerenderer: Prerenderer,
    virtualNetwork: VirtualNetwork,
    createPrerenderAuth: (
      userId: string,
      permissions: RealmPermissions,
    ) => string,
    populateCoordinator?: PopulateCoordinator,
  ) {
    this.#dbAdapter = dbAdapter;
    this.#prerenderer = prerenderer;
    this.#fetch = virtualNetwork.fetch;
    this.#virtualNetwork = virtualNetwork;
    this.#createPrerenderAuth = createPrerenderAuth;
    this.#populateCoordinator = populateCoordinator;
  }

  async lookupDefinition(
    codeRef: ResolvedCodeRef,
    opts?: DefinitionLookupOptions,
  ): Promise<Definition> {
    return await this.lookupDefinitionWithContext(codeRef, {
      ...(opts?.priority !== undefined ? { priority: opts.priority } : {}),
    });
  }

  async lookupCachedDefinition(
    codeRef: ResolvedCodeRef,
    contextOpts?: LookupContext,
  ): Promise<Definition | undefined> {
    let canonicalModuleURL = canonicalURL(
      codeRef.module,
      undefined,
      this.#virtualNetwork,
    );
    let context = await this.buildLookupContext(
      canonicalModuleURL,
      contextOpts,
    );
    if (!context) {
      return undefined;
    }
    let { cacheUserId, cacheScope, resolvedRealmURL } = context;

    for (let candidateURL of this.populationCandidates(canonicalModuleURL)) {
      let cached = await this.readFromDatabaseCache(
        candidateURL,
        cacheScope,
        cacheUserId,
        resolvedRealmURL,
      );
      if (cached) {
        let entry = this.definitionEntryFor(
          cached.definitions,
          codeRef,
          canonicalModuleURL,
        );
        if (entry && 'definition' in entry) {
          return entry.definition;
        }
        return undefined;
      }
    }
    return undefined;
  }

  async getCachedDefinitions(
    moduleUrl: string,
    opts?: DefinitionLookupOptions,
  ): Promise<DefinitionCacheEntry | undefined> {
    let canonicalModuleURL = canonicalURL(
      moduleUrl,
      undefined,
      this.#virtualNetwork,
    );
    let context = await this.buildLookupContext(canonicalModuleURL);
    if (!context) {
      return undefined;
    }
    let {
      realmURL,
      cacheUserId,
      prerenderUserId,
      cacheScope,
      resolvedRealmURL,
    } = context;
    return await this.loadDefinitionCacheEntry({
      moduleURL: canonicalModuleURL,
      realmURL,
      resolvedRealmURL,
      cacheScope,
      cacheUserId,
      prerenderUserId,
      priority: opts?.priority,
    });
  }

  async populateDefinitionCacheEntry(
    args: PopulateDefinitionCacheEntryArgs,
  ): Promise<DefinitionCacheEntry | undefined> {
    return await this.loadDefinitionCacheEntry({
      ...args,
      moduleURL: canonicalURL(args.moduleURL, undefined, this.#virtualNetwork),
      // Pre-warm is speculative and best-effort: the module pre-warm sweeps
      // every realm `.gts`/`.gjs` to prime sibling card modules, so it
      // also touches modules that aren't cards and fail to prerender
      // (e.g. a non-card `realm.gts`). Persisting those errors would
      // pollute the modules cache with rows no reader asked for. Skip
      // error persistence here; if a module is genuinely needed and
      // genuinely errors, the on-demand lookup during the visit phase
      // re-derives and caches the error.
      skipErrorPersist: true,
    });
  }

  private async query(expression: Expression, coerceTypes?: TypeCoercion) {
    return await query(this.#dbAdapter, expression, coerceTypes);
  }

  private async loadDefinitionCacheEntry(args: {
    moduleURL: string;
    realmURL: string;
    resolvedRealmURL: string;
    cacheScope: CacheScope;
    cacheUserId: string;
    prerenderUserId: string;
    priority?: number;
    skipErrorPersist?: boolean;
  }): Promise<DefinitionCacheEntry | undefined> {
    let key = inFlightKey(args);
    let existing = this.#inFlight.get(key);
    if (existing) {
      return await existing;
    }
    let pending: Promise<DefinitionCacheEntry | undefined>;
    // Two paths inside #inFlight:
    //   - With a populate coordinator (CS-10953): coordinated path adds
    //     a pg_try_advisory_xact_lock around the prerender so at most
    //     one realm-server process per coalesceKey reaches the
    //     prerenderer; peer processes block on NOTIFY and re-read the
    //     populated row. Inert at N=1.
    //   - Without a coordinator (default): original uncoordinated path
    //     runs the prerender and persist directly. This is the path
    //     used by every test that doesn't construct a coordinator and
    //     by sqlite/in-memory deployments.
    let core: Promise<DefinitionCacheEntry | undefined> = this
      .#populateCoordinator
      ? this.loadDefinitionCacheEntryCoordinated(
          args,
          this.#populateCoordinator,
        )
      : this.loadDefinitionCacheEntryUncached(args);
    pending = core.finally(() => {
      // Identity-check before deletion: an invalidation path may have
      // dropped our entry mid-flight, after which a newer caller can
      // install their own pending under the same key. Deleting
      // unconditionally would remove that newer entry and break coalescing
      // for its subsequent waiters. We only clean up if the map still
      // points at *this* pending promise.
      if (this.#inFlight.get(key) === pending) {
        this.#inFlight.delete(key);
      }
    });
    this.#inFlight.set(key, pending);
    return await pending;
  }

  // CS-10953 cross-process prerender coalescer. Wraps the uncoordinated
  // body in a pg_try_advisory_xact_lock + NOTIFY-wait loop so at most
  // one process per coalesceKey reaches the prerenderer.
  //
  // Iteration shape:
  //   1. Read the cache (cheap; avoids contending the lock on hits).
  //   2. Try the advisory lock via the coordinator.
  //   3. Winner: run the uncoordinated body inside the lock — re-reads
  //      cache (double-check), prerenders, persists. Coordinator emits
  //      NOTIFY on commit. Return the result.
  //   4. Loser: wait for peer's NOTIFY (or timeout). Loop back.
  //
  // The outer `for` is bounded by COALESCE_MAX_ITERATIONS so a
  // pathological peer crash-loop or NOTIFY-drop sequence surfaces as
  // an error instead of silently hanging.
  //
  // Error semantics:
  //   - If the uncoordinated body throws, the coordinator rolls back
  //     (releasing the advisory lock) and rethrows. CS-10948-era error
  //     caching means transient errors are persisted as error rows with
  //     a TTL, so subsequent callers read the cached error rather than
  //     re-running the prerender — the retry loop terminates naturally.
  //   - Generation-changed (invalidate ran during prerender): the body
  //     returns the post-invalidate cache state (undefined or fresher
  //     row); coordinator notifies regardless so peer waiters wake
  //     promptly. Same observable behavior as N=1 generation-mismatch.
  private async loadDefinitionCacheEntryCoordinated(
    args: {
      moduleURL: string;
      realmURL: string;
      resolvedRealmURL: string;
      cacheScope: CacheScope;
      cacheUserId: string;
      prerenderUserId: string;
      priority?: number;
      skipErrorPersist?: boolean;
    },
    coordinator: PopulateCoordinator,
  ): Promise<DefinitionCacheEntry | undefined> {
    let coalesceKey = inFlightKey(args);
    for (let iteration = 0; iteration < COALESCE_MAX_ITERATIONS; iteration++) {
      // Optimistic pre-lock cache read. On a hit we skip the lock
      // contention entirely; on a miss we proceed to the try-lock.
      // Mirrors the uncoordinated body's first read — when we win the
      // lock, the body re-reads inside the lock and short-circuits if a
      // peer committed in between (the double-check).
      let cached = await this.readFromDatabaseCache(
        args.moduleURL,
        args.cacheScope,
        args.cacheUserId,
        args.resolvedRealmURL,
      );
      if (cached && !this.isExpiredErrorEntry(cached)) {
        return cached;
      }

      let outcome = await coordinator.tryAcquireAndRun(coalesceKey, async () =>
        this.loadDefinitionCacheEntryUncached(args),
      );
      if (outcome.acquired) {
        // Winner. Result might be undefined if all populationCandidates
        // produced missing-module errors — that's a legitimate "module
        // does not exist" answer and we surface it as undefined, same as
        // the uncoordinated path.
        return outcome.result;
      }

      // Loser. Block on peer's NOTIFY (or bounded timeout). On wake,
      // the next iteration's optimistic cache read picks up the peer's
      // populated row.
      await coordinator.waitForKey(coalesceKey, COALESCE_NOTIFY_WAIT_MS);
    }
    throw new Error(
      `loadDefinitionCacheEntryCoordinated exceeded ${COALESCE_MAX_ITERATIONS} iterations for ${coalesceKey}; peer prerender appears stuck or NOTIFY broadcast is broken`,
    );
  }

  private async loadDefinitionCacheEntryUncached({
    moduleURL,
    realmURL,
    resolvedRealmURL,
    cacheScope,
    cacheUserId,
    prerenderUserId,
    priority,
    skipErrorPersist,
  }: {
    moduleURL: string;
    realmURL: string;
    resolvedRealmURL: string;
    cacheScope: CacheScope;
    cacheUserId: string;
    prerenderUserId: string;
    priority?: number;
    skipErrorPersist?: boolean;
  }): Promise<DefinitionCacheEntry | undefined> {
    // Real cache-effectiveness signal: a MISS is logged exactly once below,
    // only when the lookup exhausts the cache (primary + every alias/extension
    // candidate) and commits to a prerender. Per-probe DB reads are NOT logged
    // as misses — those alias probes inflate the count with non-real misses.
    // HITs are logged at the DB read itself (the choke point for all callers).
    let prerenderMissLogged = false;
    // Snapshot invalidation generations BEFORE the first await.
    // clearRealmDefinitions (and any future synchronous bump) runs entirely before
    // its first await, so a snapshot taken after an await above would already
    // include the bump and silently match at persist time. Invalidate happens
    // to await before bumping, so this point of failure is asymmetric — but
    // we want both paths to be caught uniformly, so the safe place is entry.
    // If the cache-hit short-circuits below, we never use this snapshot,
    // which is fine — capturing it is a few Map.get calls + struct alloc.
    let startSnapshot = this.snapshotGeneration(resolvedRealmURL, moduleURL);

    let cached = await this.readFromDatabaseCache(
      moduleURL,
      cacheScope,
      cacheUserId,
      resolvedRealmURL,
    );
    if (cached && !this.isExpiredErrorEntry(cached)) {
      return cached;
    }

    for (let candidateURL of this.populationCandidates(moduleURL)) {
      if (candidateURL !== moduleURL) {
        let candidateCached = await this.readFromDatabaseCache(
          candidateURL,
          cacheScope,
          cacheUserId,
          resolvedRealmURL,
        );
        if (candidateCached && !this.isExpiredErrorEntry(candidateCached)) {
          return candidateCached;
        }
      }
      if (!prerenderMissLogged) {
        keyLog.debug(
          `MISS source=${skipErrorPersist ? 'pre-warm' : 'on-demand'} ${fmtKey(moduleURL, cacheScope, cacheUserId, resolvedRealmURL)}`,
        );
        prerenderMissLogged = true;
      }
      let response = await this.getModuleDefinitionsViaPrerenderer(
        candidateURL,
        realmURL,
        prerenderUserId,
        priority,
      );
      if (
        response.status === 'error' &&
        this.isMissingModuleError(response, candidateURL)
      ) {
        continue;
      }
      if (skipErrorPersist && response.status === 'error') {
        // Speculative pre-warm: don't leave error state behind for a
        // module that failed to prerender. Returning here without
        // persisting reverts to the same outcome as a pre-warm miss —
        // the visit phase re-derives and caches the error if the module
        // is genuinely needed.
        return undefined;
      }
      if (this.generationChanged(resolvedRealmURL, moduleURL, startSnapshot)) {
        // Invalidate (or a wider cache wipe) ran while we were prerendering.
        // Discard our now-stale result rather than re-inserting it. Fall
        // back to whatever the DB currently has — undefined if the wipe
        // just deleted, or a fresher row if a peer has already
        // re-prerendered post-invalidation.
        return await this.readFromDatabaseCache(
          candidateURL,
          cacheScope,
          cacheUserId,
          resolvedRealmURL,
        );
      }
      return await this.persistDefinitionCacheEntry(
        candidateURL,
        response,
        resolvedRealmURL,
        cacheScope,
        prerenderUserId,
      );
    }
    return undefined;
  }

  private snapshotGeneration(
    resolvedRealmURL: string,
    moduleURL: string,
  ): { module: number; realm: number; global: number } {
    return {
      module:
        this.#moduleGenerations.get(
          moduleGenerationKey(resolvedRealmURL, moduleURL),
        ) ?? 0,
      realm: this.#realmGenerations.get(resolvedRealmURL) ?? 0,
      global: this.#globalGeneration,
    };
  }

  private generationChanged(
    resolvedRealmURL: string,
    moduleURL: string,
    snapshot: { module: number; realm: number; global: number },
  ): boolean {
    return (
      (this.#moduleGenerations.get(
        moduleGenerationKey(resolvedRealmURL, moduleURL),
      ) ?? 0) !== snapshot.module ||
      (this.#realmGenerations.get(resolvedRealmURL) ?? 0) !== snapshot.realm ||
      this.#globalGeneration !== snapshot.global
    );
  }

  // Public so the cross-instance ModuleCacheInvalidationListener (CS-10952)
  // can replay an invalidation broadcast from a peer realm-server into this
  // process's counters. Internal callers in invalidate() / clearRealmDefinitions()
  // use the same methods. Bumping is idempotent w.r.t. correctness — a
  // double-bump from the self-notify echo is observationally indistinguishable
  // from a single bump because in-flight prerenders only test for snapshot
  // equality, not absolute value.
  bumpModuleGeneration(resolvedRealmURL: string, moduleURL: string): void {
    let key = moduleGenerationKey(resolvedRealmURL, moduleURL);
    this.#moduleGenerations.set(
      key,
      (this.#moduleGenerations.get(key) ?? 0) + 1,
    );
  }

  bumpRealmGeneration(resolvedRealmURL: string): void {
    this.#realmGenerations.set(
      resolvedRealmURL,
      (this.#realmGenerations.get(resolvedRealmURL) ?? 0) + 1,
    );
  }

  bumpGlobalGeneration(): void {
    this.#globalGeneration += 1;
  }

  // Returns true if the cached entry has a top-level error and has exceeded
  // the error TTL. This causes the entry to be treated as a cache miss so
  // the prerenderer is called again to get a fresh result. This prevents
  // transient prerender failures from being permanently cached.
  private isExpiredErrorEntry(entry: DefinitionCacheEntry): boolean {
    if (!entry.error) {
      return false;
    }
    if (entry.createdAt == null) {
      // No timestamp — treat as expired so we re-validate
      return true;
    }
    return Date.now() - entry.createdAt > ERROR_CACHE_TTL_MS;
  }

  private populationCandidates(moduleURL: string): string[] {
    if (hasExecutableExtension(moduleURL)) {
      return [moduleURL];
    }
    return [
      ...PREFERRED_EXECUTABLE_EXTENSIONS.map(
        (extension) => `${moduleURL}${extension}`,
      ),
      moduleURL,
    ];
  }

  private isMissingModuleError(
    response: ModuleRenderResponse,
    moduleURL: string,
  ): boolean {
    if (
      response.error?.type !== 'module-error' ||
      response.error.error.status !== 404
    ) {
      return false;
    }
    let deps = response.error.error.deps ?? [];
    if (deps.length === 0) {
      return true;
    }
    let moduleVariants = new Set(this.moduleURLVariants(moduleURL));
    let moduleBaseURL: URL;
    try {
      moduleBaseURL = new URL(moduleURL);
    } catch (_err) {
      return false;
    }
    return deps.every((dep) => {
      let normalizedDep = this.normalizeDependencyForLookup(dep, moduleBaseURL);
      return moduleVariants.has(normalizedDep);
    });
  }

  // The definition store keys entries by internalKeyFor. Across virtual
  // networks the registered-prefix form and the canonical fetchable (alias)
  // form do not always unresolve to the same key, and a given module may be
  // stored under either. Try the prefix form (from the original codeRef)
  // first, then the canonical form.
  private definitionEntryFor(
    definitions: Record<string, ModuleDefinitionResult | ErrorEntry>,
    codeRef: ResolvedCodeRef,
    canonicalModuleURL: string,
  ): ModuleDefinitionResult | ErrorEntry | undefined {
    let entry =
      definitions[internalKeyFor(codeRef, undefined, this.#virtualNetwork)];
    if (!entry && canonicalModuleURL !== codeRef.module) {
      let canonicalModuleId = internalKeyFor(
        { ...codeRef, module: canonicalModuleURL as RealmResourceIdentifier },
        undefined,
        this.#virtualNetwork,
      );
      entry = definitions[canonicalModuleId];
    }
    return entry;
  }

  private async lookupDefinitionWithContext(
    codeRef: ResolvedCodeRef,
    contextOpts?: LookupContext,
  ): Promise<Definition> {
    let canonicalModuleURL = canonicalURL(
      codeRef.module,
      undefined,
      this.#virtualNetwork,
    );
    let context = await this.buildLookupContext(
      canonicalModuleURL,
      contextOpts,
    );
    if (!context) {
      throw new FilterRefersToNonexistentTypeError(codeRef, {
        cause: `Could not determine realm owner for module URL: ${codeRef.module}`,
      });
    }
    let {
      realmURL,
      cacheUserId,
      prerenderUserId,
      cacheScope,
      resolvedRealmURL,
    } = context;

    let moduleEntry = await this.loadDefinitionCacheEntry({
      moduleURL: canonicalModuleURL,
      realmURL,
      resolvedRealmURL,
      cacheScope,
      cacheUserId,
      prerenderUserId,
      priority: contextOpts?.priority,
    });

    if (!moduleEntry) {
      throw new FilterRefersToNonexistentTypeError(codeRef, {
        cause: `Module entry not found for URL: ${codeRef.module}`,
      });
    }

    if (moduleEntry.error) {
      throw new FilterRefersToNonexistentTypeError(codeRef, {
        cause: moduleEntry.error,
      });
    }

    let defOrError = this.definitionEntryFor(
      moduleEntry.definitions,
      codeRef,
      canonicalModuleURL,
    );
    if (!defOrError) {
      throw new FilterRefersToNonexistentTypeError(codeRef, {
        cause: `Definition for ${codeRef.name} in module ${codeRef.module} not found`,
      });
    }

    if (defOrError.type === 'definition') {
      return defOrError.definition;
    }

    throw new FilterRefersToNonexistentTypeError(codeRef, {
      cause: `Definition for ${codeRef.name} in module ${codeRef.module} had an error: ${defOrError.error.message ?? 'unknown error'}`,
    });
  }

  async invalidate(moduleURL: string): Promise<string[]> {
    let canonicalModuleURL = canonicalURL(
      moduleURL,
      undefined,
      this.#virtualNetwork,
    );
    let resolvedRealmURL = this.resolveLocalRealmURL(canonicalModuleURL);
    if (!resolvedRealmURL) {
      return [];
    }
    let visited = new Set<string>();
    let moduleVariants = this.moduleURLVariants(canonicalModuleURL);
    let invalidations = [...moduleVariants];
    for (let moduleVariant of moduleVariants) {
      invalidations.push(
        ...(await this.calculateInvalidations(
          moduleVariant,
          resolvedRealmURL,
          visited,
        )),
      );
    }
    let uniqueInvalidations = [...new Set(invalidations)];
    // Order matters: bump the affected modules' generations + drop in-flight
    // synchronously BEFORE awaiting the DB delete. Any in-flight prerender
    // for one of these URLs that completes between this point and the
    // DELETE commit will see the new generation at persist time and discard
    // its result instead of re-inserting a row that this invalidation just
    // removed. Scoping to uniqueInvalidations (rather than the whole realm)
    // leaves unrelated in-flight prerenders in the same realm untouched —
    // their generations are unchanged, their persists proceed normally.
    for (let invalidatedURL of uniqueInvalidations) {
      this.bumpModuleGeneration(resolvedRealmURL, invalidatedURL);
    }
    this.dropInFlightForRealm(resolvedRealmURL, uniqueInvalidations);
    await this.deleteModuleAliases(resolvedRealmURL, uniqueInvalidations);
    await this.notifyDefinitionCacheInvalidations(
      resolvedRealmURL,
      uniqueInvalidations,
    );
    return uniqueInvalidations;
  }

  async clearRealmDefinitions(resolvedRealmURL: string): Promise<void> {
    // Realm-scope bump: every in-flight prerender for this realm (any
    // module URL, any scope/user) sees the mismatch at persist time.
    this.bumpRealmGeneration(resolvedRealmURL);
    this.dropInFlightForRealm(resolvedRealmURL);
    await this.query([
      'DELETE FROM',
      MODULES_TABLE,
      'WHERE',
      ...(every([
        ['resolved_realm_url =', param(resolvedRealmURL)],
      ]) as Expression),
    ]);
    await this.notifyRealmDefinitionCacheInvalidation(resolvedRealmURL);
  }

  async clearAllDefinitions(): Promise<void> {
    this.bumpGlobalGeneration();
    this.#inFlight.clear();
    await this.query(['DELETE FROM', MODULES_TABLE]);
    await this.notifyGlobalDefinitionCacheInvalidation();
  }

  // pg_notify emission helpers. Mirror Realm.#notifyFileChange's best-effort
  // pattern: the local instance's counters and DB row are already updated
  // synchronously before this runs, so a notify failure is a bounded
  // cross-instance staleness window — peers self-heal on their next
  // prerender of the same key. Sequenced after the DELETE rather than
  // wrapped in BEGIN/COMMIT because each invalidation path is a single
  // autocommit DELETE; sequential pg_notify after the DELETE has the same
  // observable effect (peer sees notify only after delete commits).
  // Suppressed for sqlite/in-memory DBAdapters where NOTIFY isn't
  // available; the cross-instance scenario only applies to pg.
  //
  // Payloads are JSON-encoded so a single invalidate() fan-out (which can
  // include the source URL plus its extension variants plus transitive
  // consumers from calculateInvalidations()) emits one pg_notify carrying
  // the full URL list instead of one per URL. With M peer processes that
  // turns M*N listener wakeups into M; the listener does the same N bumps
  // either way. Postgres caps NOTIFY payloads at 8000 bytes, so the module
  // emitter chunks the URL list to stay under a 7000-byte budget — common
  // case is one notify; pathological fan-out becomes a handful.
  private async notifyDefinitionCacheInvalidations(
    resolvedRealmURL: string,
    moduleURLs: string[],
  ): Promise<void> {
    if (this.#dbAdapter.kind !== 'pg' || moduleURLs.length === 0) {
      return;
    }
    const wrapperBytes = JSON.stringify({
      k: 'module',
      r: resolvedRealmURL,
      m: [],
    }).length;
    const budget = NOTIFY_PAYLOAD_BUDGET - wrapperBytes;
    let chunk: string[] = [];
    let chunkBytes = 0;
    const flush = async () => {
      if (chunk.length === 0) return;
      await this.bestEffortNotify(
        JSON.stringify({ k: 'module', r: resolvedRealmURL, m: chunk }),
      );
      chunk = [];
      chunkBytes = 0;
    };
    for (let moduleURL of moduleURLs) {
      const encodedLen = JSON.stringify(moduleURL).length;
      const addedCost = encodedLen + (chunk.length === 0 ? 0 : 1);
      if (chunkBytes + addedCost > budget && chunk.length > 0) {
        await flush();
      }
      chunk.push(moduleURL);
      chunkBytes += chunk.length === 1 ? encodedLen : addedCost;
    }
    await flush();
  }

  private async notifyRealmDefinitionCacheInvalidation(
    resolvedRealmURL: string,
  ): Promise<void> {
    if (this.#dbAdapter.kind !== 'pg') {
      return;
    }
    await this.bestEffortNotify(
      JSON.stringify({ k: 'realm', r: resolvedRealmURL }),
    );
  }

  private async notifyGlobalDefinitionCacheInvalidation(): Promise<void> {
    if (this.#dbAdapter.kind !== 'pg') {
      return;
    }
    await this.bestEffortNotify(JSON.stringify({ k: 'global' }));
  }

  private async bestEffortNotify(payload: string): Promise<void> {
    try {
      await this.query([
        'SELECT pg_notify(',
        param(MODULE_CACHE_INVALIDATED_CHANNEL),
        ',',
        param(payload),
        ')',
      ]);
    } catch (err: unknown) {
      // Local state is already consistent; cross-instance staleness is
      // bounded and self-healing. Don't fail the invalidation.
      log.warn(
        `pg_notify ${MODULE_CACHE_INVALIDATED_CHANNEL} failed for "${payload}": ${String(err)}`,
      );
    }
  }

  // Drops in-flight entries whose pending prerender result would no longer
  // be valid after a cache wipe, so post-invalidation callers don't join a
  // pre-invalidation promise. If `moduleURLs` is provided, only entries
  // under that realm matching one of those URLs are dropped; otherwise every
  // in-flight entry for the realm is dropped. The already-running prerender
  // round-trip cannot be cancelled and still completes, but because the
  // invalidation path also bumps the module / realm / global generation
  // synchronously before awaiting the DB delete, the in-flight's generation
  // check in loadDefinitionCacheEntryUncached observes the bump before
  // persistDefinitionCacheEntry runs and discards the result via
  // readFromDatabaseCache instead of repopulating the cleared row. This
  // drop step is the in-flight-map half of the same fix: it ensures new
  // callers arriving after the invalidation don't attach to the now-
  // soon-to-be-discarded promise.
  private dropInFlightForRealm(
    resolvedRealmURL: string,
    moduleURLs?: string[],
  ): void {
    if (this.#inFlight.size === 0) {
      return;
    }
    if (!moduleURLs) {
      let prefix = `${resolvedRealmURL}|`;
      for (let key of [...this.#inFlight.keys()]) {
        if (key.startsWith(prefix)) {
          this.#inFlight.delete(key);
        }
      }
      return;
    }
    let prefixes = moduleURLs.map(
      (moduleURL) => `${resolvedRealmURL}|${moduleURL}|`,
    );
    for (let key of [...this.#inFlight.keys()]) {
      if (prefixes.some((prefix) => key.startsWith(prefix))) {
        this.#inFlight.delete(key);
      }
    }
  }

  registerRealm(realm: LocalRealm): void {
    this.#realms.push(realm);
  }

  forRealm(realm: LocalRealm): DefinitionLookup {
    this.registerRealm(realm);
    return new RealmScopedDefinitionLookup(this, realm);
  }

  async lookupDefinitionForRealm(
    codeRef: ResolvedCodeRef,
    realm: LocalRealm,
    opts?: DefinitionLookupOptions,
  ): Promise<Definition> {
    return await this.lookupDefinitionWithContext(codeRef, {
      requestingRealm: realm,
      ...(opts?.priority !== undefined ? { priority: opts.priority } : {}),
    });
  }

  private async buildLookupContext(
    moduleURL: string,
    contextOpts?: LookupContext,
  ): Promise<{
    realmURL: string;
    resolvedRealmURL: string;
    cacheScope: CacheScope;
    cacheUserId: string;
    prerenderUserId: string;
  } | null> {
    // `canonicalURL` of an RRI-prefix input resolves to the realm's
    // RESOLVED real URL via `vn.toURL` (e.g. `@cardstack/base/foo` →
    // `https://localhost:4201/base/foo`), while `#realms` is keyed by
    // the user-facing realm URL — typically the virtual alias like
    // `https://cardstack.com/base/`. The direct startsWith check
    // therefore misses local realms whenever the input was RRI form
    // (or whenever realm.url is the virtual alias and the input
    // canonicalised to the resolved URL).
    //
    // Normalize both sides to RRI form via `unresolveURL` (which
    // chases through any registered virtual → real URL mapping and
    // matches against realm-prefix targets) so the comparison is
    // form-agnostic. After normalization, `https://localhost:4201/base/foo`,
    // `https://cardstack.com/base/foo`, and `@cardstack/base/foo` all
    // become `@cardstack/base/foo`.
    let vn = this.#virtualNetwork;
    let normalizedModuleURL = vn.unresolveURL(moduleURL);
    let localRealm = this.#realms.find((realm) => {
      if (moduleURL.startsWith(realm.url)) {
        return true;
      }
      let normalizedRealmURL = vn.unresolveURL(realm.url);
      return normalizedModuleURL.startsWith(normalizedRealmURL);
    });

    if (localRealm) {
      let prerenderUserId = await localRealm.getRealmOwnerUserId();
      let isPublic = (await localRealm.visibility()) === 'public';
      let cacheScope: CacheScope = isPublic ? 'public' : 'realm-auth';

      return {
        realmURL: localRealm.url,
        resolvedRealmURL: localRealm.url,
        cacheScope,
        cacheUserId: isPublic ? '' : prerenderUserId,
        prerenderUserId,
      };
    } else {
      if (!contextOpts?.requestingRealm) {
        return null;
      }
      let requestingOwnerId =
        (await contextOpts.requestingRealm.getRealmOwnerUserId()) ?? '';
      let authHeaders = { 'X-Boxel-Assume-User': requestingOwnerId };
      let probeResult = await this.probeRemoteRealm(moduleURL, authHeaders);
      let isPublic = probeResult?.isPublic ?? false;
      let resolvedRealmURL = probeResult?.resolvedRealmURL;
      if (!resolvedRealmURL) {
        return null;
      }
      let cacheScope: CacheScope = isPublic ? 'public' : 'realm-auth';

      return {
        realmURL: resolvedRealmURL,
        resolvedRealmURL,
        cacheScope,
        cacheUserId: isPublic ? '' : requestingOwnerId,
        prerenderUserId: requestingOwnerId,
      };
    }
  }

  private async probeRemoteRealm(
    moduleURL: string,
    headers?: HeadersInit,
  ): Promise<{
    isPublic: boolean;
    resolvedRealmURL?: string;
  } | null> {
    try {
      let response = await this.#fetch(moduleURL, {
        method: 'HEAD',
        headers,
      });
      if (!response.ok) {
        return null;
      }
      let publicReadable = response.headers.get(
        'x-boxel-realm-public-readable',
      );
      let resolvedRealmURL =
        response.headers.get('x-boxel-realm-url') ?? undefined;
      return {
        isPublic: Boolean(
          publicReadable &&
          ['true', '1', 'yes'].includes(publicReadable.toLowerCase()),
        ),
        resolvedRealmURL,
      };
    } catch (err) {
      log.warn(`Failed to probe remote realm visibility for ${moduleURL}`, err);
      return null;
    }
  }

  private async getModuleDefinitionsViaPrerenderer(
    moduleUrl: string,
    realmURL: string,
    userId: string,
    priority?: number,
  ): Promise<ModuleRenderResponse> {
    let permissions = await fetchUserPermissions(this.#dbAdapter, { userId });
    let auth = this.#createPrerenderAuth(userId, permissions);
    return await this.#prerenderer.prerenderModule({
      affinityType: 'realm',
      affinityValue: realmURL,
      realm: realmURL,
      url: moduleUrl,
      auth,
      priority,
    });
  }

  private async readFromDatabaseCache(
    moduleUrl: string,
    cacheScope: CacheScope,
    authUserId: string,
    resolvedRealmURL: string,
  ): Promise<DefinitionCacheEntry | undefined> {
    let moduleAlias = normalizeExecutableURL(moduleUrl);
    let rows = (await this.query(
      [
        'SELECT definitions, deps, error_doc, cache_scope, auth_user_id, resolved_realm_url, created_at',
        'FROM',
        MODULES_TABLE,
        'WHERE',
        ...(every([
          ['resolved_realm_url =', param(resolvedRealmURL)],
          ['cache_scope =', param(cacheScope)],
          ['auth_user_id =', param(authUserId)],
          any([
            ['url =', param(moduleUrl)],
            ['file_alias =', param(moduleAlias)],
          ]) as Expression,
        ]) as Expression),
      ],
      modulesTableCoerceTypes,
    )) as {
      definitions: Record<string, ModuleDefinitionResult | ErrorEntry> | null;
      deps: string[] | null;
      error_doc: ErrorEntry | null;
      cache_scope: CacheScope;
      auth_user_id: string | null;
      resolved_realm_url: string | null;
      created_at: string | null;
    }[];

    // Only HITs are logged here — a HIT (row found) is unambiguous. A "no
    // rows" result is just one probe (primary URL or an alias/extension
    // candidate) and is NOT a real miss on its own; the real miss is logged
    // once at the prerender-commit point in loadDefinitionCacheEntryUncached.
    if (!rows.length) {
      return undefined;
    }

    keyLog.debug(
      `HIT ${fmtKey(moduleUrl, cacheScope, authUserId, resolvedRealmURL)} alias=${moduleAlias}`,
    );

    let row = rows[0];
    let definitions =
      parseJsonValue<Record<string, ModuleDefinitionResult | ErrorEntry>>(
        row.definitions,
      ) ?? {};
    let deps = parseJsonValue<string[]>(row.deps) ?? [];
    if (!Array.isArray(deps)) {
      deps = [];
    }
    let error = parseJsonValue<ErrorEntry>(row.error_doc) ?? undefined;
    let createdAt = row.created_at ? parseInt(row.created_at) : undefined;
    return {
      definitions,
      deps,
      error,
      cacheScope: row.cache_scope,
      authUserId: row.auth_user_id || undefined,
      resolvedRealmURL: row.resolved_realm_url || '',
      createdAt,
    };
  }

  async getCachedDefinitionsBatch(
    query: DefinitionCacheEntryQuery,
  ): Promise<DefinitionCacheEntries> {
    if (query.moduleUrls.length === 0) {
      return {};
    }
    let candidateUrls = new Set<string>();
    for (let moduleUrl of query.moduleUrls) {
      let canonicalModuleUrl = canonicalURL(
        moduleUrl,
        undefined,
        this.#virtualNetwork,
      );
      candidateUrls.add(canonicalModuleUrl);
      candidateUrls.add(normalizeExecutableURL(canonicalModuleUrl));
    }
    let params = [...candidateUrls].map((moduleUrl) => [param(moduleUrl)]);
    let moduleList = addExplicitParens(separatedByCommas(params)) as Expression;
    let rows = (await this.query(
      [
        'SELECT url, definitions, deps, error_doc, cache_scope, auth_user_id, resolved_realm_url, file_alias',
        'FROM',
        MODULES_TABLE,
        'WHERE',
        ...(every([
          ['resolved_realm_url =', param(query.resolvedRealmURL)],
          ['cache_scope =', param(query.cacheScope)],
          ['auth_user_id =', param(query.authUserId)],
          any([
            ['url IN', ...moduleList],
            ['file_alias IN', ...moduleList],
          ]) as Expression,
        ]) as Expression),
      ],
      modulesTableCoerceTypes,
    )) as {
      url: string;
      file_alias: string | null;
      definitions: Record<string, ModuleDefinitionResult | ErrorEntry> | null;
      deps: string[] | null;
      error_doc: ErrorEntry | null;
      cache_scope: CacheScope;
      auth_user_id: string | null;
      resolved_realm_url: string | null;
    }[];

    let entries: DefinitionCacheEntries = {};
    let assignEntry = (key: string, row: (typeof rows)[number]) => {
      let definitions =
        parseJsonValue<Record<string, ModuleDefinitionResult | ErrorEntry>>(
          row.definitions,
        ) ?? {};
      let deps = parseJsonValue<string[]>(row.deps) ?? [];
      if (!Array.isArray(deps)) {
        deps = [];
      }
      let error = parseJsonValue<ErrorEntry>(row.error_doc) ?? undefined;
      let existing = entries[key];
      if (existing && row.cache_scope !== 'realm-auth') {
        return;
      }
      entries[key] = {
        definitions,
        deps,
        error,
        cacheScope: row.cache_scope,
        authUserId: row.auth_user_id || undefined,
        resolvedRealmURL: row.resolved_realm_url || '',
      };
    };
    for (let row of rows) {
      assignEntry(row.url, row);
      if (row.file_alias) {
        assignEntry(row.file_alias, row);
      }
    }

    return entries;
  }

  private async writeToDatabaseCache({
    moduleUrl,
    moduleAlias,
    definitions,
    deps,
    errorDoc,
    resolvedRealmURL,
    cacheScope,
    authUserId,
    diagnostics,
  }: WriteToDatabaseCacheParams): Promise<void> {
    await this.query([
      'INSERT INTO',
      MODULES_TABLE,
      ...(addExplicitParens(
        separatedByCommas([
          ['url'],
          ['file_alias'],
          ['definitions'],
          ['deps'],
          ['error_doc'],
          ['created_at'],
          ['resolved_realm_url'],
          ['cache_scope'],
          ['auth_user_id'],
          ['diagnostics'],
        ]),
      ) as Expression),
      'VALUES',
      ...(addExplicitParens(
        separatedByCommas([
          [param(moduleUrl)],
          [param(moduleAlias)],
          [param(JSON.stringify(definitions ?? {}))],
          [param(JSON.stringify(deps ?? []))],
          [
            param(
              errorDoc
                ? JSON.stringify({
                    ...errorDoc,
                    error: clampSerializedError(errorDoc.error),
                  })
                : null,
            ),
          ],
          [param(Date.now())],
          [param(resolvedRealmURL)],
          [param(cacheScope)],
          [param(authUserId)],
          [param(diagnostics ? JSON.stringify(diagnostics) : null)],
        ]),
      ) as Expression),
      'ON CONFLICT ON CONSTRAINT modules_pkey DO UPDATE SET',
      ...(separatedByCommas([
        ['file_alias = excluded.file_alias'],
        ['definitions = excluded.definitions'],
        ['deps = excluded.deps'],
        ['error_doc = excluded.error_doc'],
        ['created_at = excluded.created_at'],
        ['resolved_realm_url = excluded.resolved_realm_url'],
        ['diagnostics = excluded.diagnostics'],
      ]) as Expression),
    ]);
  }

  private async persistDefinitionCacheEntry(
    moduleUrl: string,
    response: ModuleRenderResponse,
    resolvedRealmURL: string,
    cacheScope: CacheScope,
    userId: string,
  ): Promise<DefinitionCacheEntry> {
    keyLog.debug(
      `WRITE ${response.status === 'error' ? '(error) ' : ''}${fmtKey(moduleUrl, cacheScope, cacheScope === 'public' ? '' : userId, resolvedRealmURL)}`,
    );
    let entryURL = new URL(moduleUrl);
    let normalizedDeps = this.normalizeDependencies(
      response.deps ?? [],
      entryURL,
    );
    let errorEntry = response.error ?? undefined;
    if (errorEntry) {
      errorEntry = {
        ...errorEntry,
        error: {
          ...errorEntry.error,
          additionalErrors: errorEntry.error.additionalErrors ?? null,
        },
      };
      errorEntry = this.mergeErrorDeps(errorEntry, normalizedDeps, entryURL);
      errorEntry = await this.appendDependencyErrors(
        errorEntry,
        entryURL,
        resolvedRealmURL,
        cacheScope,
        cacheScope === 'public' ? '' : userId,
      );
    }
    let deps = normalizedDeps;
    if (errorEntry?.error.deps?.length) {
      deps = [...new Set([...deps, ...errorEntry.error.deps])];
    }
    let cacheEntry: DefinitionCacheEntry = {
      definitions: response.definitions ?? {},
      deps,
      error: errorEntry,
      cacheScope,
      authUserId: cacheScope === 'public' ? undefined : userId,
      resolvedRealmURL,
    };
    await this.writeToDatabaseCache({
      moduleUrl,
      moduleAlias: normalizeExecutableURL(moduleUrl),
      definitions: cacheEntry.definitions,
      deps: cacheEntry.deps,
      errorDoc: cacheEntry.error,
      resolvedRealmURL,
      cacheScope,
      authUserId: cacheScope === 'public' ? '' : userId,
      diagnostics: flattenPrerenderMeta(response.meta),
    });
    return cacheEntry;
  }

  private resolveLocalRealmURL(moduleURL: string): string | null {
    let localRealm = this.#realms.find((realm) =>
      moduleURL.startsWith(realm.url),
    );
    return localRealm?.url ?? null;
  }

  private normalizeDependencyForLookup(dep: string, relativeTo: URL): string {
    let canonical = canonicalURL(dep, relativeTo.href, this.#virtualNetwork);
    try {
      let url = new URL(canonical);
      if (hasExecutableExtension(url.href)) {
        return trimExecutableExtension(rri(url.href));
      }
      return url.href;
    } catch (_err) {
      return canonical;
    }
  }

  private normalizeDependencies(deps: string[], relativeTo: URL): string[] {
    let normalized = new Set<string>();
    for (let dep of deps ?? []) {
      let value = this.normalizeDependencyForLookup(dep, relativeTo);
      if (value) {
        normalized.add(value);
      }
    }
    return [...normalized];
  }

  private errorKey(error: SerializedError): string {
    return JSON.stringify({
      id: error.id ?? null,
      message: error.message ?? null,
      status: error.status ?? null,
    });
  }

  private async getModuleErrors(
    deps: string[],
    resolvedRealmURL: string,
    cacheScope: CacheScope,
    authUserId: string,
  ): Promise<SerializedError[]> {
    if (deps.length === 0) {
      return [];
    }
    let depList = addExplicitParens(
      separatedByCommas(deps.map((dep) => [param(dep)])),
    ) as Expression;
    let rows = (await this.query(
      [
        'SELECT error_doc',
        'FROM',
        MODULES_TABLE,
        'WHERE',
        ...(every([
          ['resolved_realm_url =', param(resolvedRealmURL)],
          ['cache_scope =', param(cacheScope)],
          ['auth_user_id =', param(authUserId)],
          any([
            ['url IN', ...depList],
            ['file_alias IN', ...depList],
          ]) as Expression,
        ]) as Expression),
      ],
      modulesTableCoerceTypes,
    )) as { error_doc: ErrorEntry | null }[];

    let errors: SerializedError[] = [];
    for (let row of rows) {
      if (!row.error_doc?.error) {
        continue;
      }
      let normalized = {
        ...row.error_doc.error,
        additionalErrors: row.error_doc.error.additionalErrors ?? null,
      };
      errors.push(normalized);
    }
    return errors;
  }

  private async collectModuleErrors(
    deps: string[],
    relativeTo: URL,
    resolvedRealmURL: string,
    cacheScope: CacheScope,
    authUserId: string,
  ): Promise<SerializedError[]> {
    let pending = new Set<string>();
    let visited = new Set<string>();
    let enqueue = (dep: string, base: URL) => {
      let normalized = this.normalizeDependencyForLookup(dep, base);
      if (!normalized || normalized.endsWith('.json')) {
        return;
      }
      if (visited.has(normalized)) {
        return;
      }
      visited.add(normalized);
      pending.add(normalized);
    };

    for (let dep of deps) {
      enqueue(dep, relativeTo);
    }

    let collected: SerializedError[] = [];
    let seenErrors = new Set<string>();

    while (pending.size > 0) {
      let batchDeps = [...pending];
      pending.clear();
      let errors = await this.getModuleErrors(
        batchDeps,
        resolvedRealmURL,
        cacheScope,
        authUserId,
      );
      for (let error of errors) {
        let key = this.errorKey(error);
        if (!seenErrors.has(key)) {
          collected.push(error);
          seenErrors.add(key);
        }
        let base = relativeTo;
        if (error.id) {
          try {
            base = this.#virtualNetwork.toURL(error.id);
          } catch (_err) {
            base = relativeTo;
          }
        }
        for (let dep of error.deps ?? []) {
          enqueue(dep, base);
        }
      }
    }

    return collected;
  }

  private async appendDependencyErrors(
    entry: ErrorEntry,
    entryURL: URL,
    resolvedRealmURL: string,
    cacheScope: CacheScope,
    authUserId: string,
  ): Promise<ErrorEntry> {
    let deps = entry.error.deps ?? [];
    if (deps.length === 0) {
      return entry;
    }
    let dependencyErrors = await this.collectModuleErrors(
      deps,
      entryURL,
      resolvedRealmURL,
      cacheScope,
      authUserId,
    );
    if (dependencyErrors.length === 0) {
      return entry;
    }

    let existing = Array.isArray(entry.error.additionalErrors)
      ? [...entry.error.additionalErrors]
      : [];
    let seen = new Set(existing.map((error) => this.errorKey(error)));
    seen.add(this.errorKey(entry.error));
    let added = false;
    for (let error of dependencyErrors) {
      let key = this.errorKey(error);
      if (!seen.has(key)) {
        existing.push(error);
        seen.add(key);
        added = true;
      }
    }
    if (!added) {
      return entry;
    }
    return {
      ...entry,
      error: {
        ...entry.error,
        additionalErrors: existing,
      },
    };
  }

  private mergeErrorDeps(
    entry: ErrorEntry,
    deps: string[] | undefined,
    relativeTo: URL,
  ): ErrorEntry {
    if (!deps || deps.length === 0) {
      return entry;
    }
    let normalizedDeps = deps
      .map((dep) => this.normalizeDependencyForLookup(dep, relativeTo))
      .filter(Boolean);
    let merged = new Set([...(entry.error.deps ?? []), ...normalizedDeps]);
    return {
      ...entry,
      error: {
        ...entry.error,
        deps: [...merged],
      },
    };
  }

  private async itemsThatReference(
    moduleAliases: string[],
    resolvedRealmURL: string,
  ): Promise<{ url: string; alias: string }[]> {
    if (moduleAliases.length === 0) {
      return [];
    }
    let moduleAliasList = addExplicitParens(
      separatedByCommas(
        moduleAliases.map((moduleAlias) => [param(moduleAlias)]),
      ),
    ) as Expression;
    let rows = (await this.query([
      'SELECT DISTINCT url, file_alias',
      'FROM',
      MODULES_TABLE,
      dbExpression({
        pg: `CROSS JOIN LATERAL jsonb_array_elements_text(
               COALESCE(deps, '[]'::jsonb)
             ) AS dep(value)`,
        sqlite: `CROSS JOIN json_each(COALESCE(deps, '[]')) AS dep`,
      }),
      'WHERE',
      ...(every([
        ['resolved_realm_url =', param(resolvedRealmURL)],
        ['dep.value IN', ...moduleAliasList],
      ]) as Expression),
    ])) as { url: string; file_alias: string | null }[];

    return rows.map((row) => ({
      url: row.url,
      alias: row.file_alias ?? row.url,
    }));
  }

  private async calculateInvalidations(
    moduleAlias: string,
    resolvedRealmURL: string,
    visited: Set<string>,
  ): Promise<string[]> {
    let moduleKey = this.moduleKey(moduleAlias);
    if (!moduleKey || visited.has(moduleKey)) {
      return [];
    }
    visited.add(moduleKey);
    let consumers = await this.itemsThatReference(
      this.moduleURLVariants(moduleAlias),
      resolvedRealmURL,
    );
    let invalidations: string[] = [];
    for (let consumer of consumers) {
      invalidations.push(consumer.url);
      if (consumer.alias && consumer.alias !== consumer.url) {
        invalidations.push(consumer.alias);
      }
      if (consumer.alias) {
        invalidations.push(
          ...(await this.calculateInvalidations(
            consumer.alias,
            resolvedRealmURL,
            visited,
          )),
        );
      }
    }
    return invalidations;
  }

  private moduleKey(moduleURL: string): string | undefined {
    let canonical = canonicalURL(moduleURL, undefined, this.#virtualNetwork);
    if (!canonical) {
      return undefined;
    }
    return normalizeExecutableURL(canonical);
  }

  private moduleURLVariants(moduleURL: string): string[] {
    let canonical = canonicalURL(moduleURL, undefined, this.#virtualNetwork);
    if (!canonical) {
      return [];
    }
    let variants = new Set<string>();
    variants.add(canonical);
    let alias = normalizeExecutableURL(canonical);
    if (alias) {
      variants.add(alias);
      // Also consider extension-based variants so callers can invalidate
      // module cache rows regardless of whether they have a file extension.
      if (!canonical.endsWith('/')) {
        for (let extension of executableExtensions) {
          variants.add(`${alias}${extension}`);
        }
      }
    }
    return [...variants];
  }

  private async deleteModuleAliases(
    resolvedRealmURL: string,
    moduleAliases: string[],
  ): Promise<void> {
    if (moduleAliases.length === 0) {
      return;
    }
    let aliasList = addExplicitParens(
      separatedByCommas(moduleAliases.map((alias) => [param(alias)])),
    ) as Expression;
    await this.query([
      'DELETE FROM',
      MODULES_TABLE,
      'WHERE',
      ...(every([
        ['resolved_realm_url =', param(resolvedRealmURL)],
        any([
          ['url IN', ...aliasList],
          ['file_alias IN', ...aliasList],
        ]) as Expression,
      ]) as Expression),
    ]);
  }
}

export interface RealmOwnerLookup {
  fromModule(
    moduleURL: string,
  ): Promise<{ realmURL: string; userId: string } | null>;
}

class RealmScopedDefinitionLookup implements DefinitionLookup {
  #inner: CachingDefinitionLookup;
  #realm: LocalRealm;

  constructor(inner: CachingDefinitionLookup, realm: LocalRealm) {
    this.#inner = inner;
    this.#realm = realm;
  }

  async lookupDefinition(
    codeRef: ResolvedCodeRef,
    opts?: DefinitionLookupOptions,
  ): Promise<Definition> {
    return await this.#inner.lookupDefinitionForRealm(
      codeRef,
      this.#realm,
      opts,
    );
  }

  async lookupCachedDefinition(
    codeRef: ResolvedCodeRef,
  ): Promise<Definition | undefined> {
    return await this.#inner.lookupCachedDefinition(codeRef, {
      requestingRealm: this.#realm,
    });
  }

  async invalidate(moduleURL: string): Promise<string[]> {
    return await this.#inner.invalidate(moduleURL);
  }

  async clearRealmDefinitions(resolvedRealmURL: string): Promise<void> {
    await this.#inner.clearRealmDefinitions(resolvedRealmURL);
  }

  async clearAllDefinitions(): Promise<void> {
    await this.#inner.clearAllDefinitions();
  }

  registerRealm(realm: LocalRealm): void {
    this.#inner.registerRealm(realm);
  }

  forRealm(realm: LocalRealm): DefinitionLookup {
    return this.#inner.forRealm(realm);
  }

  async getCachedDefinitions(
    moduleUrl: string,
    opts?: DefinitionLookupOptions,
  ): Promise<DefinitionCacheEntry | undefined> {
    return await this.#inner.getCachedDefinitions(moduleUrl, opts);
  }

  async populateDefinitionCacheEntry(
    args: PopulateDefinitionCacheEntryArgs,
  ): Promise<DefinitionCacheEntry | undefined> {
    return await this.#inner.populateDefinitionCacheEntry(args);
  }

  async getCachedDefinitionsBatch(
    query: DefinitionCacheEntryQuery,
  ): Promise<DefinitionCacheEntries> {
    return await this.#inner.getCachedDefinitionsBatch(query);
  }
}
