import type { Realm } from '@cardstack/runtime-common';
import { logger, param, query } from '@cardstack/runtime-common';
import type { PgAdapter, NotificationSubscription } from '@cardstack/postgres';
import { WorkLoop } from '@cardstack/postgres';

const log = logger('realm-server:registry-reconciler');
const CHANNEL = 'realm_registry';
const DEFAULT_POLL_INTERVAL_MS = 30_000;

// A row read from realm_registry. See packages/postgres/migrations/*_create-
// realm-registry.js for the column semantics and the kind-specific
// interpretation of disk_id.
export interface RealmRegistryRow {
  id: string;
  url: string;
  kind: 'source' | 'published' | 'bootstrap';
  disk_id: string;
  owner_username: string;
  source_url: string | null;
  last_published_at: number | null;
  pinned: boolean;
}

export interface ReconcilerDeps {
  dbAdapter: PgAdapter;
  // Synchronous: construct a Realm from a registry row and publish it
  // (push into the shared realms[] array, mount onto the VirtualNetwork).
  // Returns the constructed Realm. The reconciler is responsible for
  // calling realm.start() afterwards. Splitting prepare from start lets
  // the eager pinned-mount loop publish every realm to virtualNetwork
  // before any of them awaits the (potentially multi-minute) fullIndex,
  // so worker self-fetches and request-path lookups for an in-flight
  // realm always resolve via the published-but-not-started realm.
  prepareRealmFromRow: (row: RealmRegistryRow) => Realm;
  // Inverse of prepareRealmFromRow: unmount + clean up a Realm that the
  // registry no longer lists. Called when a row is deleted.
  unmount: (realm: Realm) => Promise<void>;
  // Optional for tests — poll interval in ms (default 30s).
  pollIntervalMs?: number;
}

// Reconciles a process's in-memory realm state against realm_registry.
//
// Phase 3 behavior: the reconcile loop eagerly mounts only `pinned=true`
// rows (bootstrap realms — base, catalog). Non-pinned rows (source and
// published) are left to mount on first request via lookupOrMount(),
// which is wired into the request hot path. The reconcile loop still
// unmounts any reconciler-owned mount whose registry row has disappeared.
//
// The reconciler maintains three maps:
//   - knownByUrl:    every row the reconciler has seen, refreshed each pass.
//                    The in-memory reflection of the registry.
//   - mounted:       the subset of knownByUrl that has an active Realm
//                    instance on this process. In Phase 2 ~equals knownByUrl.
//   - pendingMounts: URL-keyed in-flight ensureMounted() promises, so
//                    concurrent callers serialize per URL. Used by the
//                    Phase 3 request path.
//
// The loop is driven by a WorkLoop (shared with pg-queue). Every mutation
// handler emits `NOTIFY realm_registry` after its DB write; the LISTEN
// wakes the loop, which re-reads the registry and applies the diff. A 30s
// poll is the safety net for missed notifications (pg_reconnect, LISTEN
// transient failure).
export class RealmRegistryReconciler {
  #deps: ReconcilerDeps;
  #loop: WorkLoop;
  #started = false;
  #subscription?: NotificationSubscription;
  #starting?: Promise<void>;
  knownByUrl = new Map<string, RealmRegistryRow>();
  mounted = new Map<string, Realm>();
  pendingMounts = new Map<string, Promise<Realm>>();
  // URLs the reconciler itself mounted via ensureMounted(). The unmount
  // phase of reconcile() only touches these — realms registered via
  // registerExistingMounts (legacy loadRealms path) are preserved even if
  // they transiently appear absent from the registry during a skipped-
  // backfill window on a peer instance. Phase 3 removes registerExistingMounts
  // entirely and the reconciler owns all mounts, so every mount will be
  // in this set.
  #reconcilerOwned = new Set<string>();

  constructor(deps: ReconcilerDeps) {
    this.#deps = deps;
    this.#loop = new WorkLoop(
      'realm-registry',
      deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    );
  }

  // Snapshot existing realms into the reconciler's mounted map. Called
  // during boot (after CLI realms + server.start()) so the reconciler
  // treats those as already-mounted and doesn't try to re-mount them.
  // Coexistence with the legacy mount path is a Phase 2 property;
  // Phase 3 removes the legacy mount and the reconciler owns all mounts.
  //
  // Realms registered this way are NOT added to #reconcilerOwned, so the
  // reconciler will never unmount them — their lifecycle is the legacy
  // path's responsibility (publish/unpublish/delete handlers call
  // removeMountedRealm / destroyMountedRealm directly).
  registerExistingMounts(realms: Iterable<Realm>): void {
    for (const realm of realms) {
      this.mounted.set(realm.url, realm);
    }
  }

  // Begin the LISTEN + poll loop. Safe to call once; no-ops on repeat.
  async start(): Promise<void> {
    if (this.#started) {
      await this.#starting;
      return;
    }
    this.#started = true;
    this.#starting = (async () => {
      this.#subscription = await this.#deps.dbAdapter.subscribe(
        CHANNEL,
        this.#loop.wake.bind(this.#loop),
      );
      this.#loop.run(async (loop) => {
        // Run one reconcile immediately on start, then loop on wake-or-poll.
        while (!loop.shuttingDown) {
          await this.#safeReconcile();
          await loop.sleep();
        }
      });
    })();
    try {
      await this.#starting;
    } finally {
      this.#starting = undefined;
    }
  }

  async shutDown(): Promise<void> {
    // Wait for any in-flight start() to finish wiring up #subscription before
    // tearing down. Otherwise shutDown can race a still-pending subscribe()
    // and leave a live subscription installed after we thought we were shut
    // down. Swallow start() errors here — nothing to unsubscribe if startup
    // failed.
    try {
      await this.#starting;
    } catch {
      // ignore
    }
    await this.#loop.shutDown();
    const sub = this.#subscription;
    this.#subscription = undefined;
    await sub?.unsubscribe();
  }

  async #safeReconcile(): Promise<void> {
    try {
      await this.reconcile();
    } catch (err: unknown) {
      log.warn(
        `reconcile pass failed; will retry on next poll: ${String(err)}`,
      );
    }
  }

  // Public for tests and the Phase 3 request-path integration. One pass:
  // re-read the registry, mount anything new (respecting kind='bootstrap'
  // eager-mount already-mounted idempotence), unmount anything removed.
  async reconcile(): Promise<void> {
    const rows = (await query(this.#deps.dbAdapter, [
      `SELECT id::text AS id, url, kind, disk_id, owner_username, source_url, last_published_at, pinned FROM realm_registry`,
    ])) as Array<Record<string, unknown>>;

    const nextKnown = new Map<string, RealmRegistryRow>();
    for (const r of rows) {
      const row: RealmRegistryRow = {
        id: r.id as string,
        url: r.url as string,
        kind: r.kind as RealmRegistryRow['kind'],
        disk_id: r.disk_id as string,
        owner_username: r.owner_username as string,
        source_url: (r.source_url as string | null) ?? null,
        last_published_at:
          r.last_published_at == null ? null : Number(r.last_published_at),
        pinned: r.pinned as boolean,
      };
      nextKnown.set(row.url, row);
    }
    this.knownByUrl = nextKnown;

    // Eager mount: pinned rows only. In Phase 3, non-pinned rows wait
    // for first-request mount via lookupOrMount(). Pinned rows
    // (bootstrap: base, catalog) need to be available before the server
    // accepts traffic on the home page / catalog path, so they mount on
    // the reconciler's first pass and on every subsequent pass that
    // detects a new pinned row.
    //
    // Two-phase mount, matching Phase 2's loadRealms() shape: prepare
    // (synchronous publish to realms[] + virtualNetwork) for ALL pinned
    // rows first, then sequentially await realm.start() on each.
    //
    // Why two phases: realm.start() awaits a fullIndex on a fresh DB,
    // which can take minutes per realm. If we awaited start() inside
    // the prepare loop, every realm later in the iteration would be
    // unreachable in virtualNetwork for the entire duration of earlier
    // realms' indexing — requests to /skills/_readiness-check would
    // 404 while /base/ is still indexing. Publishing all realms up
    // front means every URL routes through the realm immediately;
    // requests block on the realm's #startedUp gate (e.g.,
    // readinessCheck awaits #startedUp.promise) but don't 404.
    //
    // Why sequential start() rather than Promise.all: indexing has
    // cross-realm dependencies and parallel fullIndex jobs queue up
    // through a single worker process anyway, so parallelism here
    // doesn't reduce wall-clock time but does increase memory and
    // contention. Sequential matches Phase 2's tested behavior.
    let toStart: Realm[] = [];
    for (const [url, row] of nextKnown) {
      if (!row.pinned) {
        continue;
      }
      if (this.mounted.has(url)) {
        continue;
      }
      try {
        const realm = this.#deps.prepareRealmFromRow(row);
        this.mounted.set(url, realm);
        this.#reconcilerOwned.add(url);
        toStart.push(realm);
      } catch (err: unknown) {
        log.warn(
          `failed to prepare pinned ${url} during reconcile: ${String(err)}; leaving for next pass`,
        );
      }
    }
    for (const realm of toStart) {
      const start = Date.now();
      try {
        await realm.start();
        log.info(
          `mount ok url=%s pinned=true duration_ms=%d`,
          realm.url,
          Date.now() - start,
        );
      } catch (err: unknown) {
        log.warn(
          `failed to start pinned ${realm.url}: ${String(err)}; unwinding so the next reconcile pass can retry from scratch`,
        );
        this.mounted.delete(realm.url);
        this.#reconcilerOwned.delete(realm.url);
        try {
          await this.#deps.unmount(realm);
        } catch (unwindErr: unknown) {
          log.warn(
            `failed to unwind pinned start failure for ${realm.url}: ${String(unwindErr)}`,
          );
        }
      }
    }

    // Unmount removals. Only touch realms the reconciler mounted itself
    // (#reconcilerOwned); legacy-registered mounts are preserved. In a
    // multi-instance deployment the reconciler may skip its boot backfill
    // (peer holds the advisory lock) and then read a transiently partial
    // registry — we don't want that to unmount legitimate legacy mounts.
    // When Phase 3 removes the legacy mount path, every mount will be
    // reconciler-owned and this filter becomes a no-op.
    for (const [url, realm] of this.mounted) {
      if (!this.#reconcilerOwned.has(url)) {
        continue;
      }
      if (!nextKnown.has(url)) {
        try {
          await this.#deps.unmount(realm);
        } catch (err: unknown) {
          log.warn(`failed to unmount ${url}: ${String(err)}; leaving mounted`);
          continue;
        }
        this.mounted.delete(url);
        this.#reconcilerOwned.delete(url);
      }
    }
  }

  // Request-path entry point. Returns the mounted Realm for the URL if
  // any; otherwise looks up the registry row (in-memory first, then a
  // direct DB read so a request that arrives before the next reconcile
  // poll doesn't 404 on a freshly-published realm) and mounts it via
  // ensureMounted(). Returns undefined when the URL is not in the
  // registry — the caller should respond 404 in that case. Mount
  // failures propagate; the caller should respond 5xx and let the next
  // request retry.
  //
  // pendingMounts is checked BEFORE mounted because ensureMounted()
  // publishes the Realm into mounted synchronously before awaiting
  // realm.start(). A concurrent caller that took the mounted fast-path
  // would receive a not-yet-started Realm; routing it through the
  // in-flight promise instead lets the caller await start() like the
  // original requester.
  async lookupOrMount(
    url: string,
    opts?: { fromScratchIndexPriority?: number },
  ): Promise<Realm | undefined> {
    const inflight = this.pendingMounts.get(url);
    if (inflight) {
      return inflight;
    }
    const existing = this.mounted.get(url);
    if (existing) {
      return existing;
    }
    let row = this.knownByUrl.get(url);
    if (!row) {
      row = await this.#lookupRow(url);
      if (!row) {
        return undefined;
      }
      this.knownByUrl.set(url, row);
    }
    return this.ensureMounted(row, opts);
  }

  async #lookupRow(url: string): Promise<RealmRegistryRow | undefined> {
    const rows = (await query(this.#deps.dbAdapter, [
      `SELECT id::text AS id, url, kind, disk_id, owner_username, source_url, last_published_at, pinned FROM realm_registry WHERE url = `,
      param(url),
    ])) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      return undefined;
    }
    const r = rows[0];
    return {
      id: r.id as string,
      url: r.url as string,
      kind: r.kind as RealmRegistryRow['kind'],
      disk_id: r.disk_id as string,
      owner_username: r.owner_username as string,
      source_url: (r.source_url as string | null) ?? null,
      last_published_at:
        r.last_published_at == null ? null : Number(r.last_published_at),
      pinned: r.pinned as boolean,
    };
  }

  // Mount-on-demand primitive. Used by lookupOrMount() (request-path)
  // for non-pinned rows on first request.
  //
  // Publishes the realm synchronously (so concurrent request handlers
  // resolve via realms[] / mounted) and then awaits realm.start().
  // Per-URL serialization: concurrent callers for the same URL share
  // one in-flight start. Cleared from pendingMounts on settle so a
  // retry after failure gets a fresh attempt.
  //
  // Emits a structured `mount` log line on every settled call: success
  // duration, failure duration + reason, kind, pinned flag. Phase 3
  // rollout safety relies on this signal — Loki/Grafana extract cold-
  // mount latency, mount failure rate, and pinned-vs-lazy ratios from
  // these lines.
  async ensureMounted(
    row: RealmRegistryRow,
    opts?: { fromScratchIndexPriority?: number },
  ): Promise<Realm> {
    // pendingMounts checked before mounted: see lookupOrMount() above.
    // The Realm is published into mounted synchronously before its
    // start() promise resolves, so a caller hitting the mounted
    // fast-path would receive a not-yet-started Realm. Falling through
    // to the in-flight promise lets concurrent callers await start()
    // alongside the originator.
    const inflight = this.pendingMounts.get(row.url);
    if (inflight) {
      return inflight;
    }
    const existing = this.mounted.get(row.url);
    if (existing) {
      return existing;
    }
    const start = Date.now();
    let realm: Realm;
    try {
      realm = this.#deps.prepareRealmFromRow(row);
    } catch (err: unknown) {
      log.warn(
        `mount fail url=%s kind=%s pinned=%s duration_ms=%d reason=%s`,
        row.url,
        row.kind,
        row.pinned,
        Date.now() - start,
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
    // Publish into mounted/reconcilerOwned synchronously so that a
    // concurrent request handler awaiting in-flight mounts via
    // lookupOrMount() can resolve via the existing-mount fast path
    // (and so the unmount phase of a future reconcile() is allowed to
    // tear this realm down when the row disappears).
    this.mounted.set(row.url, realm);
    this.#reconcilerOwned.add(row.url);
    const promise = (async () => {
      try {
        await realm.start(opts);
        log.info(
          `mount ok url=%s kind=%s pinned=%s duration_ms=%d`,
          row.url,
          row.kind,
          row.pinned,
          Date.now() - start,
        );
        return realm;
      } catch (err: unknown) {
        log.warn(
          `mount fail url=%s kind=%s pinned=%s duration_ms=%d reason=%s`,
          row.url,
          row.kind,
          row.pinned,
          Date.now() - start,
          err instanceof Error ? err.message : String(err),
        );
        // Clean up the optimistic mounted/reconcilerOwned entries we
        // set before starting, so the next ensureMounted call for this
        // URL fires a fresh prepare+start instead of returning the
        // failed half-constructed realm. Also call deps.unmount() to
        // unwind the realms[]/virtualNetwork publish that
        // prepareRealmFromRow did, otherwise findOrMountRealm's
        // realms[] fast-path would keep returning a realm whose
        // #startedUp never resolves and request handlers would block
        // forever.
        this.mounted.delete(row.url);
        this.#reconcilerOwned.delete(row.url);
        try {
          await this.#deps.unmount(realm);
        } catch (unwindErr: unknown) {
          log.warn(
            `failed to unwind start failure for ${row.url}: ${String(unwindErr)}`,
          );
        }
        throw err;
      } finally {
        this.pendingMounts.delete(row.url);
      }
    })();
    this.pendingMounts.set(row.url, promise);
    return promise;
  }
}
