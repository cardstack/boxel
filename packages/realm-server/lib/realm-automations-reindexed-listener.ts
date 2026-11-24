import type { Realm } from '@cardstack/runtime-common';
import {
  logger,
  REALM_AUTOMATIONS_REINDEXED_CHANNEL,
} from '@cardstack/runtime-common';
import type { PgAdapter, NotificationSubscription } from '@cardstack/postgres';

const log = logger('realm-server:automations-reindexed-listener');

// Checks the key approvals of a realm's automations in full once a
// from-scratch index pass over the realm has landed. The worker that ran the
// pass emits `NOTIFY realm_automations_reindexed, '<realmURL>'` after its
// index hook has synced the realm's automations with their cards, whoever
// started the pass. The hook compares only the approvals already given, as
// the worker reads no operation definitions. So the realm server serving the
// realm makes the check: an automation whose approvals all match again runs
// again, and one whose edit adds an operation needing a key no approval
// covers waits for key approval.
//
// A realm not mounted here is left to the servers that mount it. A
// notification lost while the connection was down is not caught up: the
// automation stays as the hook left it until an approval lands or its next
// run's admission, the same bounded staleness the other realm channels
// accept.
export interface RealmAutomationsReindexedListenerDeps {
  dbAdapter: PgAdapter;
  lookupMountedRealm: (url: string) => Realm | undefined;
}

export class RealmAutomationsReindexedListener {
  #deps: RealmAutomationsReindexedListenerDeps;
  #subscription?: NotificationSubscription;
  #starting?: Promise<void>;

  constructor(deps: RealmAutomationsReindexedListenerDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    if (this.#subscription || this.#starting) {
      await this.#starting;
      return;
    }
    this.#starting = (async () => {
      this.#subscription = await this.#deps.dbAdapter.subscribe(
        REALM_AUTOMATIONS_REINDEXED_CHANNEL,
        (notification) => {
          void this.handleNotification(notification.payload);
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
    // Waits for an in-flight start() to install its subscription, so a racing
    // start() can't leave a live one behind. A start() that failed has
    // nothing to unsubscribe.
    try {
      await this.#starting;
    } catch {
      // ignore
    }
    const sub = this.#subscription;
    this.#subscription = undefined;
    await sub?.unsubscribe();
  }

  // Invoked by the LISTEN handler, and by tests. Settles once the realm's
  // follow has, and never rejects.
  async handleNotification(payload: string | undefined): Promise<void> {
    const realmURL = payload?.trim();
    if (!realmURL) {
      log.warn(`ignoring empty ${REALM_AUTOMATIONS_REINDEXED_CHANNEL} payload`);
      return;
    }
    let realm: Realm | undefined;
    try {
      realm = this.#deps.lookupMountedRealm(realmURL);
    } catch (err: unknown) {
      log.warn(`looking up realm ${realmURL} failed: ${String(err)}`);
      return;
    }
    await realm?.followAutomationKeyApprovalsAfterFromScratchPass();
  }
}
