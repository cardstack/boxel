import {
  fetchDirectWriters,
  logger,
  param,
  query,
  type DBAdapter,
  type Querier,
} from '@cardstack/runtime-common';
import {
  OperationFailure,
  type CallApiSlot,
} from '@cardstack/runtime-common/card-operations';
import type { Expression } from '@cardstack/runtime-common/expression';

// Rejected grants: what happens when a vendor refuses a key.
//
// A 401 from inside a grant's destination means the vendor refused the key
// there, so the grant becomes `rejected`. The key's other grants are left
// alone: a vendor can refuse a key at one host and accept it at another, such
// as a data-residency host. While a grant is rejected, calls under it are
// refused `credential-rejected` without contacting the vendor, except one probe
// per grant per interval, so a card that keeps polling with a dead key spends
// nothing and a key the vendor accepts again is noticed without anyone acting.
// A probe the vendor answers below 400 returns the grant to `active`, and
// replacing the key returns every one of its grants at once.
//
// A 403 never changes state. Vendors use it for too many things that say
// nothing about the key itself (GitHub alone: an organization whose single
// sign-on approval the token lacks, missing permissions on one resource, its
// secondary rate limit). It is recorded on the grant as the latest
// `vendor-forbidden` outcome, which the key's owner sees beside the grant.
//
// Entering the state records one notice per recipient, naming the key and the
// destination: the key's owner, and when the call came through a share, the
// direct writers of the share's realm too. Only the transition notifies, so a
// probe the vendor refuses again sends nothing.
//
// A key that mints its access tokens can be refused before any call is made:
// Google's token endpoint refuses a service-account key that is revoked or
// deleted, whose account is disabled, or that can't act as its subject. That
// refusal is about the key, not about any one destination, so it is recorded
// on the key: the key becomes `rejected` and every grant of it is refused
// `credential-rejected` without contacting Google, except one probe per key
// per interval. A probe that mints returns the key to `active`, and replacing
// the key does too. Entering the state notifies the same recipients, once.

const log = logger('realm:key-grants');

export const KEY_GRANT_CHANNEL = 'boxel:key-grant';

// How long a rejected grant waits between probes, unless the platform sets
// `KEY_GRANT_PROBE_INTERVAL_SECONDS`.
export const DEFAULT_PROBE_INTERVAL_MS = 15 * 60 * 1000;

export function probeIntervalFromEnv(
  value = process.env.KEY_GRANT_PROBE_INTERVAL_SECONDS,
): number {
  if (value === undefined || value === '') {
    return DEFAULT_PROBE_INTERVAL_MS;
  }
  let seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(
      `KEY_GRANT_PROBE_INTERVAL_SECONDS must be a number of seconds, not "${value}"`,
    );
  }
  return seconds * 1000;
}

// One JSON line per event on the `boxel:key-grant` channel. Hosts and ids
// only: a destination's path can be a secret's prefix, and nothing here
// carries a value.
export type KeyGrantEvent =
  | {
      event: 'grant-rejected';
      grant: string;
      host: string;
      realm: string;
      share: string | null;
    }
  | {
      event: 'grant-cleared';
      grant: string;
      host: string;
      reason: 'probe' | 'key-replaced';
    }
  | { event: 'probe'; grant: string; host: string; status: number | null }
  | {
      event: 'key-rejected';
      key: string;
      realm: string;
      share: string | null;
    }
  | { event: 'key-cleared'; key: string; reason: 'probe' | 'key-replaced' }
  | { event: 'key-probe'; key: string; minted: boolean }
  | { event: 'vendor-outcome'; host: string; status: number };

let sink: ((event: KeyGrantEvent) => void) | undefined;

export function setKeyGrantSink(
  next: ((event: KeyGrantEvent) => void) | undefined,
): void {
  sink = next;
}

let channelLog: ReturnType<typeof logger> | undefined;

export function emitKeyGrantEvent(event: KeyGrantEvent): void {
  try {
    if (sink) {
      sink(event);
      return;
    }
    (channelLog ??= logger(KEY_GRANT_CHANNEL)).info(
      JSON.stringify({ channel: KEY_GRANT_CHANNEL, ...event }),
    );
  } catch (error) {
    log.warn(
      `could not record a key grant event: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(invalid URL)';
  }
}

// The refusal for a slot whose grant the vendor rejected. The detail says what
// brings the key back, since a caller that sees only the message, such as the
// AI assistant, gets neither the code nor `meta`.
export function credentialRejected(
  operation: string | undefined,
  slot: Pick<CallApiSlot, 'name' | 'key'>,
  destination: string,
): OperationFailure {
  let what = operation ? `operation "${operation}"` : 'this operation';
  return new OperationFailure({
    status: 424,
    code: 'credential-rejected',
    title: 'Credential rejected',
    detail: `${what} sends the key for the credential slot "${slot.name}" to ${destination}, and that service rejected the key, so nothing is sent with it until its owner replaces it or a periodic retry is accepted`,
    meta: { slot: { name: slot.name, key: slot.key }, destination },
  });
}

// Moves a grant to `rejected` and records its notices, only when this is the
// move: a grant already rejected was announced already. Answers whether this
// call made the move.
export async function markGrantRejected(
  dbAdapter: DBAdapter,
  {
    grantId,
    realmURL,
    shareId,
  }: { grantId: string; realmURL: string; shareId?: string },
): Promise<boolean> {
  // The realm's writers are read before the move, outside its transaction.
  // Only a vendor's refusal gets here, so a successful call never pays for it.
  let writers = shareId
    ? await fetchDirectWriters(dbAdapter, new URL(realmURL))
    : [];
  let moved = await dbAdapter.withTransaction(async (txQuery) => {
    let [row] = await txQuery([
      `UPDATE user_key_grants g SET state = 'rejected', rejected_at = NOW(), last_probe_at = NOW()
         FROM user_keys k
        WHERE g.id = `,
      param(grantId),
      ` AND g.state = 'active' AND k.id = g.key_id
        RETURNING g.id, g.key_id, g.owner, g.destination, k.name AS key_name`,
    ]);
    if (!row) {
      return undefined;
    }
    await recordRejectionNotices(txQuery, {
      grantId,
      keyId: row.key_id as string,
      keyName: row.key_name as string,
      destination: row.destination as string,
      owner: row.owner as string,
      writers,
      realmURL,
      shareId,
    });
    return row;
  });
  if (!moved) {
    return false;
  }
  emitKeyGrantEvent({
    event: 'grant-rejected',
    grant: grantId,
    host: hostOf(moved.destination as string),
    realm: realmURL,
    share: shareId ?? null,
  });
  return true;
}

// One notice per recipient, naming the key and the destination the refused
// call was sent to: the key's owner and, for a call through a share, the
// direct writers of the share's realm.
async function recordRejectionNotices(
  txQuery: Querier,
  {
    grantId,
    keyId,
    keyName,
    destination,
    owner,
    writers,
    realmURL,
    shareId,
  }: {
    grantId: string;
    keyId: string;
    keyName: string;
    destination: string;
    owner: string;
    writers: string[];
    realmURL: string;
    shareId?: string;
  },
): Promise<void> {
  for (let recipient of new Set<string>([owner, ...writers])) {
    await txQuery([
      `INSERT INTO user_key_grant_notices (grant_id, key_id, key_name, destination, recipient, owner, realm_url, share_id, reason) VALUES (`,
      param(grantId),
      `, `,
      param(keyId),
      `, `,
      param(keyName),
      `, `,
      param(destination),
      `, `,
      param(recipient),
      `, `,
      param(owner),
      `, `,
      param(shareId ? realmURL : null),
      `, `,
      param(shareId ?? null),
      `, 'credential-rejected')`,
    ]);
  }
}

// Returns a rejected grant to `active` after a probe the vendor accepted.
export async function clearGrantRejection(
  dbAdapter: DBAdapter,
  grantId: string,
): Promise<boolean> {
  let [row] = await query(dbAdapter, [
    `UPDATE user_key_grants SET state = 'active', rejected_at = NULL, last_probe_at = NULL WHERE id = `,
    param(grantId),
    ` AND state = 'rejected' RETURNING destination`,
  ]);
  if (!row) {
    return false;
  }
  emitKeyGrantEvent({
    event: 'grant-cleared',
    grant: grantId,
    host: hostOf(row.destination as string),
    reason: 'probe',
  });
  return true;
}

// Returns every rejected grant of a key to `active`, inside the transaction
// that replaces the key's value: the new value hasn't been refused anywhere.
export async function clearKeyRejections(
  txQuery: Querier,
  keyId: string,
): Promise<void> {
  let rows = await txQuery([
    `UPDATE user_key_grants SET state = 'active', rejected_at = NULL, last_probe_at = NULL WHERE key_id = `,
    param(keyId),
    ` AND state = 'rejected' RETURNING id, destination`,
  ]);
  for (let row of rows) {
    emitKeyGrantEvent({
      event: 'grant-cleared',
      grant: row.id as string,
      host: hostOf(row.destination as string),
      reason: 'key-replaced',
    });
  }
}

// Records a 403 under a grant as its latest `vendor-forbidden` outcome. The
// grant's state is unchanged.
export async function recordVendorForbidden(
  dbAdapter: DBAdapter,
  grantId: string,
  host: string,
): Promise<void> {
  await query(dbAdapter, [
    `UPDATE user_key_grants SET last_forbidden_at = NOW(), last_forbidden_host = `,
    param(host),
    ` WHERE id = `,
    param(grantId),
  ]);
}

// Claims the probe of a rejected grant: at most one call per interval gets
// it, however many arrive at once, because the claim and the check are one
// statement.
export async function claimProbe(
  dbAdapter: DBAdapter,
  grantId: string,
  intervalMs: number,
): Promise<boolean> {
  let [row] = await query(dbAdapter, [
    `UPDATE user_key_grants SET last_probe_at = NOW() WHERE id = `,
    param(grantId),
    ` AND state = 'rejected' AND `,
    ...probeDue('last_probe_at', intervalMs),
    ` RETURNING id`,
  ]);
  return !!row;
}

// The SQL condition that a rejected grant's next probe is due.
export function probeDue(column: string, intervalMs: number): Expression {
  return [
    `(${column} IS NULL OR ${column} <= NOW() - make_interval(secs => `,
    param(intervalMs / 1000),
    `))`,
  ];
}

// Moves a key whose token endpoint refused it to `rejected` and records its
// notices, only when this is the move: a key already rejected was announced
// already. `grantId` is the grant the refused call came through, which the
// notices name with its destination. Answers whether this call made the move.
export async function markKeyRejected(
  dbAdapter: DBAdapter,
  {
    keyId,
    grantId,
    realmURL,
    shareId,
  }: { keyId: string; grantId: string; realmURL: string; shareId?: string },
): Promise<boolean> {
  let writers = shareId
    ? await fetchDirectWriters(dbAdapter, new URL(realmURL))
    : [];
  let moved = await dbAdapter.withTransaction(async (txQuery) => {
    let [row] = await txQuery([
      `UPDATE user_keys SET state = 'rejected', rejected_at = NOW(), last_probe_at = NOW() WHERE id = `,
      param(keyId),
      ` AND state = 'active' RETURNING owner, name`,
    ]);
    if (!row) {
      return false;
    }
    let [grant] = await txQuery([
      `SELECT destination FROM user_key_grants WHERE id = `,
      param(grantId),
    ]);
    if (grant) {
      await recordRejectionNotices(txQuery, {
        grantId,
        keyId,
        keyName: row.name as string,
        destination: grant.destination as string,
        owner: row.owner as string,
        writers,
        realmURL,
        shareId,
      });
    }
    return true;
  });
  if (moved) {
    emitKeyGrantEvent({
      event: 'key-rejected',
      key: keyId,
      realm: realmURL,
      share: shareId ?? null,
    });
  }
  return moved;
}

// Claims the probe of a rejected key: at most one call per interval gets it,
// whichever of the key's grants it comes through.
export async function claimKeyProbe(
  dbAdapter: DBAdapter,
  keyId: string,
  intervalMs: number,
): Promise<boolean> {
  let [row] = await query(dbAdapter, [
    `UPDATE user_keys SET last_probe_at = NOW() WHERE id = `,
    param(keyId),
    ` AND state = 'rejected' AND `,
    ...probeDue('last_probe_at', intervalMs),
    ` RETURNING id`,
  ]);
  return !!row;
}

// Returns a rejected key to `active`: after a probe that minted, or inside the
// transaction that replaces its value, which hasn't been refused.
export async function clearKeyRejected(
  querier: Querier,
  keyId: string,
  reason: 'probe' | 'key-replaced',
): Promise<boolean> {
  let [row] = await querier([
    `UPDATE user_keys SET state = 'active', rejected_at = NULL, last_probe_at = NULL WHERE id = `,
    param(keyId),
    ` AND state = 'rejected' RETURNING id`,
  ]);
  if (!row) {
    return false;
  }
  emitKeyGrantEvent({ event: 'key-cleared', key: keyId, reason });
  return true;
}
