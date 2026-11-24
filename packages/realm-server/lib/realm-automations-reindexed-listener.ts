import type { Realm, RealmAutomationsTouched } from '@cardstack/runtime-common';
import {
  logger,
  REALM_AUTOMATIONS_REINDEXED_CHANNEL,
  REALM_AUTOMATIONS_TOUCHED_CHANNEL,
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
// An incremental pass no realm follows (one the worker enqueues on its own,
// such as the prerender reconcile's retry) is announced the same way, on
// `realm_automations_touched`, naming the automations it touched: the realm
// server checks those (`Realm.followAutomationKeyApprovalsAfterWorkerPass`).
// An incremental pass a realm awaits is checked by that realm, and isn't
// announced.
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
  #touchedSubscription?: NotificationSubscription;
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
      this.#touchedSubscription = await this.#deps.dbAdapter.subscribe(
        REALM_AUTOMATIONS_TOUCHED_CHANNEL,
        (notification) => {
          void this.handleTouchedNotification(notification.payload);
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
    const subs = [this.#subscription, this.#touchedSubscription];
    this.#subscription = undefined;
    this.#touchedSubscription = undefined;
    await Promise.all(subs.map((sub) => sub?.unsubscribe()));
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

  // Invoked by the LISTEN handler for `realm_automations_touched`, and by
  // tests. Settles once the realm's follow has, and never rejects.
  async handleTouchedNotification(payload: string | undefined): Promise<void> {
    let touched = parseTouched(payload);
    if (!touched) {
      log.warn(
        `ignoring malformed ${REALM_AUTOMATIONS_TOUCHED_CHANNEL} payload: ${payload}`,
      );
      return;
    }
    let realm: Realm | undefined;
    try {
      realm = this.#deps.lookupMountedRealm(touched.realmURL);
    } catch (err: unknown) {
      log.warn(`looking up realm ${touched.realmURL} failed: ${String(err)}`);
      return;
    }
    await realm?.followAutomationKeyApprovalsAfterWorkerPass(
      touched.automationIds,
      { reportChanges: touched.reportChanges },
    );
  }
}

function parseTouched(
  payload: string | undefined,
): RealmAutomationsTouched | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload ?? '');
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  let { realmURL, automationIds, reportChanges } = parsed as Record<
    string,
    unknown
  >;
  if (
    typeof realmURL !== 'string' ||
    !realmURL ||
    !Array.isArray(automationIds) ||
    !automationIds.every((id) => typeof id === 'string')
  ) {
    return undefined;
  }
  return {
    realmURL,
    automationIds,
    // Absent, the check reports what it moved, as a pass announces by
    // default.
    reportChanges: reportChanges !== false,
  };
}
