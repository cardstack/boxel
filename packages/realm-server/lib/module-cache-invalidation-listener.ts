import {
  logger,
  MODULE_CACHE_INVALIDATED_CHANNEL,
  type CachingDefinitionLookup,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { WorkLoop } from '@cardstack/postgres';

const log = logger('realm-server:module-cache-invalidation-listener');
const DEFAULT_POLL_INTERVAL_MS = 60_000;

// Cross-instance module-cache invalidation broadcast (CS-10952). Peer
// realm-server processes emit `NOTIFY module_cache_invalidated, '<payload>'`
// from CachingDefinitionLookup.invalidate / clearRealmCache / clearAllModules
// after their DELETE commits; this listener parses the payload and replays
// the appropriate generation bump on the locally-attached
// CachingDefinitionLookup so its in-flight prerenders observe the
// invalidation at persist time and discard stale results instead of
// re-inserting the row a peer just deleted.
//
// Mirrors RealmFileChangesListener exactly: dedicated LISTEN connection
// (PgAdapter.listen uses a fresh Client to dodge pool-LISTEN reliability
// issues — see node-postgres#1543), WorkLoop for predictable shutdown, 60s
// safety poll. There's nothing to poll from the DB side — the entire
// dispatch is in the payload — so the wake-loop just sleeps until shutdown.
//
// Self-notify is harmless: the emitting process bumps its counter
// synchronously before its DELETE, so the listener's bump on receiving its
// own NOTIFY is a second bump on a counter that's only used for snapshot
// equality. Idempotent.
export interface ModuleCacheInvalidationListenerDeps {
  dbAdapter: PgAdapter;
  definitionLookup: CachingDefinitionLookup;
  // Optional for tests.
  pollIntervalMs?: number;
}

export type ParsedModuleCacheInvalidation =
  | { kind: 'module'; resolvedRealmURL: string; moduleURLs: string[] }
  | { kind: 'realm'; resolvedRealmURL: string }
  | { kind: 'global' };

export class ModuleCacheInvalidationListener {
  #deps: ModuleCacheInvalidationListenerDeps;
  #loop: WorkLoop;
  #started = false;

  constructor(deps: ModuleCacheInvalidationListenerDeps) {
    this.#deps = deps;
    this.#loop = new WorkLoop(
      'module-cache-invalidation',
      deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    );
  }

  start(): void {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#loop.run(async (loop) => {
      await this.#deps.dbAdapter.listen(
        MODULE_CACHE_INVALIDATED_CHANNEL,
        (notification: { payload?: string }) => {
          this.#handleNotification(notification.payload);
        },
        async () => {
          while (!loop.shuttingDown) {
            await loop.sleep();
          }
        },
      );
    });
  }

  async shutDown(): Promise<void> {
    await this.#loop.shutDown();
  }

  // Exposed for tests; invoked internally by the LISTEN handler.
  handleNotification(payload: string | undefined): void {
    this.#handleNotification(payload);
  }

  #handleNotification(payload: string | undefined): void {
    if (!payload) {
      return;
    }
    const parsed = parseModuleCacheInvalidationPayload(payload);
    if (!parsed) {
      log.warn(
        `ignoring malformed ${MODULE_CACHE_INVALIDATED_CHANNEL} payload: ${payload}`,
      );
      return;
    }
    try {
      switch (parsed.kind) {
        case 'module':
          for (const moduleURL of parsed.moduleURLs) {
            this.#deps.definitionLookup.bumpModuleGeneration(
              parsed.resolvedRealmURL,
              moduleURL,
            );
          }
          return;
        case 'realm':
          this.#deps.definitionLookup.bumpRealmGeneration(
            parsed.resolvedRealmURL,
          );
          return;
        case 'global':
          this.#deps.definitionLookup.bumpGlobalGeneration();
          return;
      }
    } catch (err: unknown) {
      log.warn(
        `bump failed for ${MODULE_CACHE_INVALIDATED_CHANNEL} payload "${payload}": ${String(err)}`,
      );
    }
  }
}

// Payload formats emitted by CachingDefinitionLookup invalidation paths
// (JSON-encoded):
//   {"k":"module","r":<resolvedRealmURL>,"m":[<moduleURL>,...]}
//   {"k":"realm","r":<resolvedRealmURL>}
//   {"k":"global"}
//
// Module fan-out is batched into a single payload (chunked at the emitter
// to stay under Postgres's 8000-byte NOTIFY payload cap) so one invalidate()
// produces one notify per chunk instead of one per URL.
export function parseModuleCacheInvalidationPayload(
  payload: string,
): ParsedModuleCacheInvalidation | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  const obj = parsed as Record<string, unknown>;
  switch (obj.k) {
    case 'module': {
      const resolvedRealmURL = obj.r;
      const moduleURLs = obj.m;
      if (typeof resolvedRealmURL !== 'string' || !resolvedRealmURL) {
        return undefined;
      }
      if (!Array.isArray(moduleURLs) || moduleURLs.length === 0) {
        return undefined;
      }
      const urls: string[] = [];
      for (const url of moduleURLs) {
        if (typeof url !== 'string' || !url) {
          return undefined;
        }
        urls.push(url);
      }
      return { kind: 'module', resolvedRealmURL, moduleURLs: urls };
    }
    case 'realm': {
      const resolvedRealmURL = obj.r;
      if (typeof resolvedRealmURL !== 'string' || !resolvedRealmURL) {
        return undefined;
      }
      return { kind: 'realm', resolvedRealmURL };
    }
    case 'global':
      return { kind: 'global' };
    default:
      return undefined;
  }
}
