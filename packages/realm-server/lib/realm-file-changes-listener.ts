import type { Realm } from '@cardstack/runtime-common';
import {
  logger,
  REALM_FILE_CHANGES_CHANNEL,
  REALM_FILE_CHANGES_WILDCARD,
} from '@cardstack/runtime-common';
import type { PgAdapter, NotificationSubscription } from '@cardstack/postgres';

const log = logger('realm-server:file-changes-listener');

// Cross-instance cache invalidation. When any realm-server emits
// `NOTIFY realm_file_changes, '<url>:<path>'` (see Realm.#notifyFileChange in
// runtime-common/realm.ts), every listener subscribed on this channel looks
// up the URL in its lookup function. If the realm is mounted locally,
// `realm.invalidateCache(path)` clears the matching #sourceCache /
// #transpiledModuleCache entries. If it's not mounted, the notification is dropped —
// this instance has no stale state to clear.
//
// Bulk variant: when the path is the wildcard sentinel `*` (CS-11156),
// `realm.clearLocalSourceCaches()` drops every cached path for that realm. Emitted
// by the publish-realm / unpublish-realm / delete-realm handlers after the
// FS swap or removal so peers (whose file-watcher events do NOT cross
// replicas) bypass their pre-swap cached bytes on the next read.
//
// The LISTEN is backed by `PgAdapter.subscribe` (shared multiplexed
// notification client). There is no periodic work to run between
// notifications — the whole dispatch is in the payload — so we don't keep a
// WorkLoop here.
export interface RealmFileChangesListenerDeps {
  dbAdapter: PgAdapter;
  lookupMountedRealm: (url: string) => Realm | undefined;
}

export class RealmFileChangesListener {
  #deps: RealmFileChangesListenerDeps;
  #subscription?: NotificationSubscription;
  #starting?: Promise<void>;

  constructor(deps: RealmFileChangesListenerDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    if (this.#subscription || this.#starting) {
      await this.#starting;
      return;
    }
    this.#starting = (async () => {
      this.#subscription = await this.#deps.dbAdapter.subscribe(
        REALM_FILE_CHANGES_CHANNEL,
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
    const parsed = parsePayload(payload);
    if (!parsed) {
      log.warn(`ignoring malformed realm_file_changes payload: ${payload}`);
      return;
    }
    const realm = this.#deps.lookupMountedRealm(parsed.url);
    if (!realm) {
      // Not mounted on this instance — nothing to invalidate.
      return;
    }
    const isWildcard = parsed.path === REALM_FILE_CHANGES_WILDCARD;
    try {
      if (isWildcard) {
        realm.clearLocalSourceCaches();
      } else {
        realm.invalidateCache(parsed.path);
      }
    } catch (err: unknown) {
      const op = isWildcard ? 'clearLocalSourceCaches' : 'invalidateCache';
      log.warn(`${op} failed for ${parsed.url} ${parsed.path}: ${String(err)}`);
    }
  }
}

// Payload shape: `<realmURL>:<localPath>` or `<realmURL>:*` (bulk
// invalidation — CS-11156). Realm URLs always carry a trailing slash
// (enforced by `ensureTrailingSlash` throughout the code), so the
// separator between URL and path is the first `:` that immediately
// follows a `/`. That avoids false matches on the scheme colon
// (`http://...`) and any host:port colon (`localhost:4201`). The same
// regex handles both shapes; the wildcard payload parses as
// `path = '*'`.
const PAYLOAD_SEPARATOR = /\/:/;

export function parsePayload(
  payload: string,
): { url: string; path: string } | undefined {
  const match = PAYLOAD_SEPARATOR.exec(payload);
  if (!match) {
    return undefined;
  }
  const url = payload.slice(0, match.index + 1);
  const path = payload.slice(match.index + 2);
  if (!url || !path) {
    return undefined;
  }
  return { url, path };
}
