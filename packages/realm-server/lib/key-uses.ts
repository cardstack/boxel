import {
  isDirectWriter,
  logger,
  param,
  query,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type {
  CallApiSlotLookup,
  CallApiUse,
  CallApiUseSubject,
  OperationFailure,
} from '@cardstack/runtime-common/card-operations';
import { budgetUse, type BudgetUse } from './key-limits.ts';
import {
  KEY_LIMIT_COLUMNS,
  limitsOf,
  type KeyLimits,
} from './key-limit-settings.ts';
import { subjectOfRefusal } from './key-use-subject.ts';
import { UserKeyError } from './user-keys.ts';

// The record of each use of a share or a personal key, and the usage view
// that reads it back for the key's owner and the share's realm's direct
// writers.
//
// A use is one `callApi` invocation whose binding resolved to the share or
// key: from a browser, the AI assistant, the CLI or a pipeline, whether the
// vendor answered or the call was refused. One row is written for each share
// and key the call's slots were filled from (`key_uses`). A refusal raised
// while the slots were being filled is written against the one share or key
// that refused it (`lib/key-use-subject.ts`); one that came before any
// binding was found, such as `binding-not-approved`, names no key, and is
// recorded nowhere but the key-use log line.
//
// The usage view answers, for the current UTC month: how many calls, the last
// use and by whom, the top callers, refusals by code and the vendor's answers
// by status, with 403 named `vendor-forbidden`. What the share or key has
// spent against its budgets is the limiter's own counter (`budgetUse`), which
// counts only interactive calls, as the budgets do. A row records no value,
// request or response, and no URL beyond the destination's host.

const log = logger('key-uses');

// How long a use is kept: long enough to cover the current calendar month
// whatever the day, with the previous one for comparison.
export const KEY_USE_RETENTION_DAYS = 62;

const MS_PER_DAY = 86_400_000;

// How many of the callers who used a share or key most the view lists.
const TOP_CALLERS = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function subjectColumn(subject: CallApiUseSubject): string {
  return subject.kind === 'share' ? 'share_id' : 'key_id';
}

function hostOf(url: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// Writes one row for each share and key the use counts against, and removes
// that share's or key's rows older than the retention window. A refusal of
// `credential-rejected` made once the request was built is the vendor's 401
// (a rejection known beforehand refuses before any URL exists), so it is
// recorded with that status among the vendor's answers.
export async function recordKeyUses(
  dbAdapter: DBAdapter,
  use: CallApiUse,
): Promise<void> {
  let status =
    use.status ??
    (use.code === 'credential-rejected' && use.url ? 401 : undefined);
  let cutoff = new Date(
    Date.now() - KEY_USE_RETENTION_DAYS * MS_PER_DAY,
  ).toISOString();
  for (let subject of use.countsAgainst) {
    await query(dbAdapter, [
      `INSERT INTO key_uses (share_id, key_id, realm_url, operation, caller, mode, outcome, code, status, host) VALUES (`,
      param(subject.kind === 'share' ? subject.id : null),
      `, `,
      param(subject.kind === 'key' ? subject.id : null),
      `, `,
      param(use.realmURL),
      `, `,
      param(use.operation),
      `, `,
      param(use.caller),
      `, `,
      param(use.mode),
      `, `,
      param(use.outcome),
      `, `,
      param(use.code ?? null),
      `, `,
      param(status ?? null),
      `, `,
      param(hostOf(use.url)),
      `)`,
    ]);
    await query(dbAdapter, [
      `DELETE FROM key_uses WHERE ${subjectColumn(subject)} = `,
      param(subject.id),
      ` AND created_at < `,
      param(cutoff),
    ]);
  }
}

// Records a refusal raised while a call's slots were being filled, against
// the share or key that raised it. A record that can't be written is logged
// and costs the caller nothing: they get the refusal either way.
export async function recordFillRefusal(
  dbAdapter: DBAdapter,
  lookup: CallApiSlotLookup,
  failure: OperationFailure,
): Promise<void> {
  let subject = subjectOfRefusal(failure);
  if (!subject) {
    return;
  }
  try {
    await recordKeyUses(dbAdapter, {
      realmURL: lookup.realmURL,
      operation: lookup.operation,
      caller: lookup.caller || null,
      mode: lookup.mode,
      url: null,
      outcome: 'refused',
      code: failure.error.code,
      countsAgainst: [subject],
    });
  } catch (error) {
    log.warn(
      `could not record the refusal ${failure.error.code} against ${subject.kind} ${subject.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// A grant of the key, as the usage view lists it: where the key may be sent,
// and whether the vendor there rejected it (`rejected`, after a 401) or last
// refused a request with a 403 (`lastForbiddenAt`).
export interface UsageGrant {
  id: string;
  host: string;
  destination: string;
  state: 'active' | 'rejected';
  rejectedAt: string | null;
  lastForbiddenAt: string | null;
}

export interface KeyUsage {
  limits: KeyLimits;
  budgets: BudgetUse;
  // The start of the current UTC month: the counts below are since then.
  since: string;
  calls: number;
  lastUse: {
    at: string;
    caller: string | null;
    operation: string;
    outcome: CallApiUse['outcome'];
  } | null;
  topCallers: { caller: string | null; calls: number }[];
  refusals: { code: string; count: number }[];
  vendorOutcomes: {
    status: number;
    count: number;
    outcome?: 'vendor-forbidden';
  }[];
  grants: UsageGrant[];
  canEditLimits: boolean;
}

function iso(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return new Date(value as string).toISOString();
}

function startOfMonth(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
}

async function usageOf(
  dbAdapter: DBAdapter,
  subject: CallApiUseSubject,
  {
    limits,
    grants,
    canEditLimits,
  }: { limits: KeyLimits; grants: UsageGrant[]; canEditLimits: boolean },
): Promise<KeyUsage> {
  let since = startOfMonth();
  let where = () => [
    ` FROM key_uses WHERE ${subjectColumn(subject)} = `,
    param(subject.id),
    ` AND created_at >= `,
    param(since),
  ];
  let [count] = await query(dbAdapter, [
    `SELECT COUNT(*) AS calls`,
    ...where(),
  ]);
  let [last] = await query(dbAdapter, [
    `SELECT created_at, caller, operation, outcome FROM key_uses WHERE ${subjectColumn(subject)} = `,
    param(subject.id),
    ` ORDER BY created_at DESC, id DESC LIMIT 1`,
  ]);
  let callers = await query(dbAdapter, [
    `SELECT caller, COUNT(*) AS calls`,
    ...where(),
    ` GROUP BY caller ORDER BY calls DESC, caller LIMIT ${TOP_CALLERS}`,
  ]);
  let refusals = await query(dbAdapter, [
    `SELECT code, COUNT(*) AS count`,
    ...where(),
    ` AND outcome = 'refused' AND code IS NOT NULL GROUP BY code ORDER BY count DESC, code`,
  ]);
  let outcomes = await query(dbAdapter, [
    `SELECT status, COUNT(*) AS count`,
    ...where(),
    ` AND status IS NOT NULL GROUP BY status ORDER BY status`,
  ]);
  return {
    limits,
    budgets: await budgetUse(dbAdapter, subject, limits),
    since,
    calls: Number(count?.calls ?? 0),
    lastUse: last
      ? {
          at: iso(last.created_at)!,
          caller: (last.caller as string | null) ?? null,
          operation: last.operation as string,
          outcome: last.outcome as CallApiUse['outcome'],
        }
      : null,
    topCallers: callers.map((row) => ({
      caller: (row.caller as string | null) ?? null,
      calls: Number(row.calls),
    })),
    refusals: refusals.map((row) => ({
      code: row.code as string,
      count: Number(row.count),
    })),
    vendorOutcomes: outcomes.map((row) => {
      let status = Number(row.status);
      return {
        status,
        count: Number(row.count),
        ...(status === 403 ? { outcome: 'vendor-forbidden' as const } : {}),
      };
    }),
    grants,
    canEditLimits,
  };
}

function grantOf(row: Record<string, unknown>): UsageGrant {
  let destination = row.destination as string;
  return {
    id: row.id as string,
    host: hostOf(destination) ?? destination,
    destination,
    state: row.state === 'rejected' ? 'rejected' : 'active',
    rejectedAt: iso(row.rejected_at),
    lastForbiddenAt: iso(row.last_forbidden_at),
  };
}

const GRANT_COLUMNS =
  'g.id, g.destination, g.state, g.rejected_at, g.last_forbidden_at';

// A share's usage, for a direct writer of its realm; the owner of the key it
// holds may also change its limits. Anyone else, including an owner who lost
// write and whose share was suspended for it, is told it doesn't exist.
//
// A share's grants are those its bindings in the realm send under, not every
// grant of the key it holds: the realm's other writers see where the realm's
// cards send it, not where its owner uses it elsewhere.
export async function shareUsage(
  dbAdapter: DBAdapter,
  { user, shareId }: { user: string; shareId: string },
): Promise<KeyUsage> {
  let noSuchShare = () => new UserKeyError(404, 'no such share');
  if (!UUID.test(shareId)) {
    throw noSuchShare();
  }
  let [share] = await query(dbAdapter, [
    `SELECT owner, realm_url, ${KEY_LIMIT_COLUMNS} FROM key_shares WHERE id = `,
    param(shareId),
  ]);
  if (
    !share ||
    !(await isDirectWriter(dbAdapter, new URL(share.realm_url as string), user))
  ) {
    throw noSuchShare();
  }
  let grants = await query(dbAdapter, [
    `SELECT DISTINCT ${GRANT_COLUMNS} FROM key_bindings b JOIN user_key_grants g ON g.id = b.grant_id WHERE b.share_id = `,
    param(shareId),
    ` ORDER BY g.destination, g.id`,
  ]);
  return usageOf(
    dbAdapter,
    { kind: 'share', id: shareId },
    {
      limits: limitsOf(share),
      grants: grants.map(grantOf),
      canEditLimits: share.owner === user,
    },
  );
}

// One of the user's own keys' usage, with every grant of the key. Another
// user's key answers as one that doesn't exist.
export async function userKeyUsage(
  dbAdapter: DBAdapter,
  { owner, keyId }: { owner: string; keyId: string },
): Promise<KeyUsage> {
  let noSuchKey = () => new UserKeyError(404, 'no such key');
  if (!UUID.test(keyId)) {
    throw noSuchKey();
  }
  let [key] = await query(dbAdapter, [
    `SELECT ${KEY_LIMIT_COLUMNS} FROM user_keys WHERE id = `,
    param(keyId),
    ` AND owner = `,
    param(owner),
  ]);
  if (!key) {
    throw noSuchKey();
  }
  let grants = await query(dbAdapter, [
    `SELECT ${GRANT_COLUMNS} FROM user_key_grants g WHERE g.key_id = `,
    param(keyId),
    ` ORDER BY g.destination, g.id`,
  ]);
  return usageOf(
    dbAdapter,
    { kind: 'key', id: keyId },
    { limits: limitsOf(key), grants: grants.map(grantOf), canEditLimits: true },
  );
}
