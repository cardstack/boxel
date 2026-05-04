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
  | { kind: 'module'; resolvedRealmURL: string; moduleURL: string }
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
          this.#deps.definitionLookup.bumpModuleGeneration(
            parsed.resolvedRealmURL,
            parsed.moduleURL,
          );
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

// Payload formats emitted by CachingDefinitionLookup invalidation paths:
//   `module:<resolvedRealmURL>:<moduleURL>`
//   `realm:<resolvedRealmURL>`
//   `global`
//
// Realm and module URLs always carry a scheme (`http://`, `https://`) and a
// trailing slash on the realm URL; the discriminator prefix is separated by
// the first `:` that immediately precedes a non-`/` character. We split on
// the first `:` after the kind keyword to keep parsing simple — the kind
// keyword is one of three known values and never contains `:`.
export function parseModuleCacheInvalidationPayload(
  payload: string,
): ParsedModuleCacheInvalidation | undefined {
  if (payload === 'global') {
    return { kind: 'global' };
  }
  if (payload.startsWith('realm:')) {
    const resolvedRealmURL = payload.slice('realm:'.length);
    if (!resolvedRealmURL) {
      return undefined;
    }
    return { kind: 'realm', resolvedRealmURL };
  }
  if (payload.startsWith('module:')) {
    // After stripping `module:`, the rest is `<resolvedRealmURL>:<moduleURL>`.
    // Realm URLs always end in `/`, so the separator is the first `:` that
    // immediately follows a `/`. Mirrors realm-file-changes-listener
    // parsePayload's separator approach.
    const rest = payload.slice('module:'.length);
    const match = /\/:/.exec(rest);
    if (!match) {
      return undefined;
    }
    const resolvedRealmURL = rest.slice(0, match.index + 1);
    const moduleURL = rest.slice(match.index + 2);
    if (!resolvedRealmURL || !moduleURL) {
      return undefined;
    }
    return { kind: 'module', resolvedRealmURL, moduleURL };
  }
  return undefined;
}
