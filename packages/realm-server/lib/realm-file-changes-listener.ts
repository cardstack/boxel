import type { Realm } from '@cardstack/runtime-common';
import { logger, REALM_FILE_CHANGES_CHANNEL } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { WorkLoop } from '@cardstack/postgres';

const log = logger('realm-server:file-changes-listener');
const DEFAULT_POLL_INTERVAL_MS = 60_000;

// Cross-instance cache invalidation. When any realm-server emits
// `NOTIFY realm_file_changes, '<url>:<path>'` (see Realm.#notifyFileChange in
// runtime-common/realm.ts), every listener subscribed on this channel looks
// up the URL in its lookup function. If the realm is mounted locally,
// `realm.invalidateCache(path)` clears the matching #sourceCache /
// #moduleCache entries. If it's not mounted, the notification is dropped —
// this instance has no stale state to clear.
//
// The LISTEN is backed by `PgAdapter.listen` (dedicated Client, not pool-
// returned) exactly like the registry reconciler. A poll fallback is not
// strictly needed here — missed NOTIFYs degrade to cache staleness that the
// next write will re-invalidate — but the WorkLoop gives us a predictable
// shutdown path and matches the pattern used elsewhere. We set the poll
// interval to something long (60s) so the fallback loop doesn't burn CPU
// on busy instances; it exists to surface connection health, not to
// re-scan anything.
export interface RealmFileChangesListenerDeps {
  dbAdapter: PgAdapter;
  lookupMountedRealm: (url: string) => Realm | undefined;
  // Optional for tests.
  pollIntervalMs?: number;
}

export class RealmFileChangesListener {
  #deps: RealmFileChangesListenerDeps;
  #loop: WorkLoop;
  #started = false;

  constructor(deps: RealmFileChangesListenerDeps) {
    this.#deps = deps;
    this.#loop = new WorkLoop(
      'realm-file-changes',
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
        REALM_FILE_CHANGES_CHANNEL,
        (notification: { payload?: string }) => {
          // Invalidate synchronously on wake rather than forcing a reconcile
          // pass: there is nothing to poll from the DB side, the whole
          // payload is in the notification.
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
    try {
      realm.invalidateCache(parsed.path);
    } catch (err: unknown) {
      log.warn(
        `invalidateCache failed for ${parsed.url} ${parsed.path}: ${String(err)}`,
      );
    }
  }
}

// Payload shape: `<realmURL>:<localPath>`. Realm URLs always carry a
// trailing slash (enforced by `ensureTrailingSlash` throughout the code),
// so the separator between URL and path is the first `:` that immediately
// follows a `/`. That avoids false matches on the scheme colon
// (`http://...`) and any host:port colon (`localhost:4201`).
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
