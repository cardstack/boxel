import {
  logger,
  MODULE_CACHE_INVALIDATED_CHANNEL,
  type CachingDefinitionLookup,
} from '@cardstack/runtime-common';
import type { PgAdapter, NotificationSubscription } from '@cardstack/postgres';

const log = logger('realm-server:module-cache-invalidation-listener');

// Cross-instance module-cache invalidation broadcast (CS-10952). Peer
// realm-server processes emit `NOTIFY module_cache_invalidated, '<payload>'`
// from CachingDefinitionLookup.invalidate / clearRealmDefinitions / clearAllDefinitions
// after their DELETE commits; this listener parses the payload and replays
// the appropriate generation bump on the locally-attached
// CachingDefinitionLookup so its in-flight prerenders observe the
// invalidation at persist time and discard stale results instead of
// re-inserting the row a peer just deleted.
//
// The LISTEN is backed by `PgAdapter.subscribe` (shared multiplexed
// notification client). There is no periodic work to run between
// notifications — the whole dispatch is in the payload — so we don't keep a
// WorkLoop here. Mirrors `RealmFileChangesListener`.
//
// Self-notify is harmless: the emitting process bumps its counter
// synchronously before its DELETE, so the listener's bump on receiving its
// own NOTIFY is a second bump on a counter that's only used for snapshot
// equality. Idempotent.
export interface ModuleCacheInvalidationListenerDeps {
  dbAdapter: PgAdapter;
  definitionLookup: CachingDefinitionLookup;
}

export type ParsedModuleCacheInvalidation =
  | { kind: 'module'; resolvedRealmURL: string; moduleURLs: string[] }
  | { kind: 'realm'; resolvedRealmURL: string }
  | { kind: 'global' };

export class ModuleCacheInvalidationListener {
  #deps: ModuleCacheInvalidationListenerDeps;
  #subscription?: NotificationSubscription;
  #starting?: Promise<void>;

  constructor(deps: ModuleCacheInvalidationListenerDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    if (this.#subscription || this.#starting) {
      await this.#starting;
      return;
    }
    this.#starting = (async () => {
      this.#subscription = await this.#deps.dbAdapter.subscribe(
        MODULE_CACHE_INVALIDATED_CHANNEL,
        (notification) => {
          this.#handleNotification(notification.payload);
        },
      );
    })();
    try {
      await this.#starting;
    } finally {
      this.#starting = undefined;
    }
  }

  async shutDown(): Promise<void> {
    // Wait for any in-flight start() to finish wiring up #subscription before
    // tearing down. Otherwise shutDown can run while subscribe() is still
    // awaiting the LISTEN, return early with #subscription still undefined,
    // and the racing start() then installs a live subscription after we
    // thought we were shut down. Swallow start() errors here — if startup
    // failed, there's nothing for us to unsubscribe.
    try {
      await this.#starting;
    } catch {
      // ignore
    }
    const sub = this.#subscription;
    this.#subscription = undefined;
    await sub?.unsubscribe();
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
