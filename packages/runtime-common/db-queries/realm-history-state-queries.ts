// Read/write helpers for `realm_history_state`: one row per realm a
// history-aware realm-server has mounted, saying whether it recorded then, and
// carrying what recovery leaves behind — the read-only seal a failed recovery
// sets, and the lease that keeps two replicas from recovering a realm at once.
//
// Postgres only: only realm-server realms record history.
import type { DBAdapter } from '../db.ts';
import { param, query } from '../expression.ts';

export interface RealmHistoryState {
  recording: boolean;
  readOnly?: { at: string; reason: string; detail?: string };
}

// Why a realm that records history refuses writes.
export type ReadOnlyReason = 'recovery-failed';

export async function realmHistoryState(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<RealmHistoryState | undefined> {
  let [row] = (await query(dbAdapter, [
    `SELECT recording, read_only_at, read_only_reason, read_only_detail
     FROM realm_history_state WHERE realm_url =`,
    param(realmURL),
  ])) as {
    recording: boolean;
    read_only_at: string | null;
    read_only_reason: string | null;
    read_only_detail: string | null;
  }[];
  if (!row) {
    return undefined;
  }
  return {
    recording: Boolean(row.recording),
    ...(row.read_only_at != null
      ? {
          readOnly: {
            at: String(row.read_only_at),
            reason: String(row.read_only_reason ?? 'recovery-failed'),
            ...(row.read_only_detail != null
              ? { detail: String(row.read_only_detail) }
              : {}),
          },
        }
      : {}),
  };
}

// Note whether the realm records its writes as of this mount. A realm whose
// row says it did not, or that has none, is taken in as a gap the next time it
// is mounted recording.
export async function setRealmRecording(
  dbAdapter: DBAdapter,
  realmURL: string,
  recording: boolean,
): Promise<void> {
  await query(dbAdapter, [
    `INSERT INTO realm_history_state (realm_url, recording) VALUES (`,
    param(realmURL),
    `,`,
    param(recording),
    `) ON CONFLICT (realm_url) DO UPDATE SET recording = EXCLUDED.recording,
       recording_changed_at = now()
     WHERE realm_history_state.recording IS DISTINCT FROM EXCLUDED.recording`,
  ]);
}

// The realm's read-only seal, or nothing for a realm that takes writes. Read
// fresh on every write, so a peer's seal or clear takes effect at once.
export async function realmReadOnly(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<{ reason: string; detail?: string } | undefined> {
  let [row] = (await query(dbAdapter, [
    `SELECT read_only_reason, read_only_detail FROM realm_history_state
     WHERE read_only_at IS NOT NULL AND realm_url =`,
    param(realmURL),
  ])) as {
    read_only_reason: string | null;
    read_only_detail: string | null;
  }[];
  if (!row) {
    return undefined;
  }
  return {
    reason: String(row.read_only_reason ?? 'recovery-failed'),
    ...(row.read_only_detail != null
      ? { detail: String(row.read_only_detail) }
      : {}),
  };
}

export async function setRealmReadOnly(
  dbAdapter: DBAdapter,
  realmURL: string,
  reason: ReadOnlyReason,
  detail: string,
): Promise<void> {
  await query(dbAdapter, [
    `INSERT INTO realm_history_state
       (realm_url, recording, read_only_at, read_only_reason, read_only_detail)
     VALUES (`,
    param(realmURL),
    `, true, now(),`,
    param(reason),
    `,`,
    param(detail),
    `) ON CONFLICT (realm_url) DO UPDATE SET read_only_at = now(),
       read_only_reason = EXCLUDED.read_only_reason,
       read_only_detail = EXCLUDED.read_only_detail`,
  ]);
}

export async function clearRealmReadOnly(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<void> {
  await query(dbAdapter, [
    `UPDATE realm_history_state SET read_only_at = NULL,
       read_only_reason = NULL, read_only_detail = NULL
     WHERE realm_url =`,
    param(realmURL),
  ]);
}

// Take the realm's recovery lease for `owner`, for `ms`. Resolves false while
// another owner holds an unexpired one. A lease rather than an advisory lock:
// recovery takes other pool connections while it runs, and a lock held across
// those, with other replicas' waiters each pinning a connection of their own,
// is how a pool runs dry.
export async function claimRecoveryLease(
  dbAdapter: DBAdapter,
  realmURL: string,
  owner: string,
  ms: number,
): Promise<boolean> {
  let rows = await query(dbAdapter, [
    `INSERT INTO realm_history_state
       (realm_url, recording, recovery_lease_owner, recovery_lease_until)
     VALUES (`,
    param(realmURL),
    `, false,`,
    param(owner),
    `, now() + CAST(`,
    param(ms),
    `AS float8) * interval '1 millisecond') ON CONFLICT (realm_url) DO UPDATE SET
       recovery_lease_owner = EXCLUDED.recovery_lease_owner,
       recovery_lease_until = EXCLUDED.recovery_lease_until
     WHERE realm_history_state.recovery_lease_until IS NULL
        OR realm_history_state.recovery_lease_until < now()
        OR realm_history_state.recovery_lease_owner = EXCLUDED.recovery_lease_owner
     RETURNING realm_url`,
  ]);
  return rows.length > 0;
}

export async function releaseRecoveryLease(
  dbAdapter: DBAdapter,
  realmURL: string,
  owner: string,
  outcome: string,
): Promise<void> {
  await query(dbAdapter, [
    `UPDATE realm_history_state SET recovery_lease_owner = NULL,
       recovery_lease_until = NULL, last_recovered_at = now(),
       last_recovery_outcome =`,
    param(outcome),
    `WHERE realm_url =`,
    param(realmURL),
    `AND recovery_lease_owner =`,
    param(owner),
  ]);
}

// Whether a replica holds an unexpired recovery lease on the realm.
export async function recoveryLeased(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<boolean> {
  let rows = await query(dbAdapter, [
    `SELECT 1 FROM realm_history_state WHERE recovery_lease_until > now()
     AND realm_url =`,
    param(realmURL),
  ]);
  return rows.length > 0;
}

// The realms recovery's schedule visits: those that recorded when last
// mounted.
export async function recordingRealmURLs(
  dbAdapter: DBAdapter,
): Promise<string[]> {
  let rows = await query(dbAdapter, [
    `SELECT realm_url FROM realm_history_state WHERE recording ORDER BY realm_url`,
  ]);
  return rows.map((row) => String(row.realm_url));
}
