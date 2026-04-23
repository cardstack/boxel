import type { Realm } from '@cardstack/runtime-common';
import { logger, query } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
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
  // Construct a Realm from a registry row and mount it into the virtual
  // network. Returns the mounted Realm. The reconciler owns the `mounted`
  // map; the factory is just the adapter between a registry row and a
  // constructed+mounted Realm instance.
  mountFromRow: (row: RealmRegistryRow) => Promise<Realm>;
  // Inverse of mountFromRow: unmount + clean up a Realm that the registry
  // no longer lists. Called when a row is deleted.
  unmount: (realm: Realm) => Promise<void>;
  // Optional for tests — poll interval in ms (default 30s).
  pollIntervalMs?: number;
}

// Reconciles a process's in-memory realm state against realm_registry.
//
// Phase 2 behavior (this PR): the reconcile loop mounts every row in the
// registry that isn't already mounted locally, and unmounts anything the
// registry no longer lists. Pinned vs unpinned is tracked but not yet
// differentiated — Phase 3 flips the policy so only pinned rows are eagerly
// mounted and everything else waits for mount-on-demand.
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
  start(): void {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#loop.run(async (loop) => {
      await this.#deps.dbAdapter.listen(
        CHANNEL,
        loop.wake.bind(loop),
        async () => {
          // Run one reconcile immediately on start, then loop on wake-or-poll.
          while (!loop.shuttingDown) {
            await this.#safeReconcile();
            await loop.sleep();
          }
        },
      );
    });
  }

  async shutDown(): Promise<void> {
    await this.#loop.shutDown();
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

    // Mount additions. In Phase 2 we eagerly mount everything (preserving
    // today's behavior); Phase 3 will gate this on `row.pinned`.
    for (const [url, row] of nextKnown) {
      if (!this.mounted.has(url)) {
        try {
          await this.ensureMounted(row);
        } catch (err: unknown) {
          log.warn(
            `failed to mount ${url} during reconcile: ${String(err)}; leaving for next pass`,
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

  // Mount-on-demand primitive. Used by reconcile() for new rows and by the
  // Phase 3 request path on the first request for a not-yet-mounted realm.
  // Per-URL serialization: concurrent callers for the same URL share one
  // in-flight mount. Cleared from pendingMounts on settle so a retry after
  // failure gets a fresh attempt.
  async ensureMounted(row: RealmRegistryRow): Promise<Realm> {
    const existing = this.mounted.get(row.url);
    if (existing) {
      return existing;
    }
    const inflight = this.pendingMounts.get(row.url);
    if (inflight) {
      return inflight;
    }
    const promise = (async () => {
      try {
        const realm = await this.#deps.mountFromRow(row);
        this.mounted.set(row.url, realm);
        // Mark as reconciler-owned so the unmount phase of a future
        // reconcile() is allowed to tear it down when the row disappears.
        this.#reconcilerOwned.add(row.url);
        return realm;
      } finally {
        this.pendingMounts.delete(row.url);
      }
    })();
    this.pendingMounts.set(row.url, promise);
    return promise;
  }
}
