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
import { ANONYMOUS_ACTOR } from '@cardstack/runtime-common/card-operations/anonymous-actor';
import { budgetUse, type BudgetUse } from './key-limits.ts';
import {
  KEY_LIMIT_COLUMNS,
  limitsViewOf,
  type KeyLimitsView,
} from './key-limit-settings.ts';
import { isUUID, namedToViewer } from './named-users.ts';
import { subjectOfRefusal } from './key-use-subject.ts';
import { UserKeyError } from './user-keys.ts';

// The record of each use of a share or a personal key, and the usage view
// that reads it back for the key's owner and the share's realm's direct
// writers.
//
// A use is one `callApi` invocation whose binding resolved to the share or
// key: from a browser, the AI assistant, the CLI or a pipeline, whether the
// vendor answered or the call was refused. Each share and key the call's
// slots were filled from records it (`key_uses`). A call that was sent, or
// failed, is a row of its own. A refusal is collapsed into the row of the
// same refusal in the same minute (same share or key, realm, operation,
// caller, mode, code, status and host), whose `count` it adds one to, so a
// caller who keeps calling past a limit adds a row a minute, not a row a
// call. Every count below sums `count`. A refusal raised
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

// How often a realm-server process sweeps the uses past the retention window,
// whichever shares and keys they belong to. A share or key nobody uses any
// more is swept the same as one in use.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

// How many of the callers who used a share or key most the view lists.
const TOP_CALLERS = 5;

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

// Records the use against each share and key it counts against, and starts a
// sweep of the uses past the retention window when one is due. A refusal adds
// one to its minute's row (`refusal_window`, the start of that UTC minute, by
// the database's clock) and moves the row's `created_at` forward to it, never
// back, so the row reads as its latest refusal even when an earlier statement
// takes the row's lock after a later one. The unique index on the row's
// identity (the migration that adds `refusal_window`) makes that atomic
// however many refusals arrive at once; the ON CONFLICT target names its
// columns and expressions exactly. A refusal of
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
  for (let subject of use.countsAgainst) {
    await query(dbAdapter, [
      `INSERT INTO key_uses (share_id, key_id, realm_url, operation, caller, mode, outcome, code, status, host, refusal_window) VALUES (`,
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
      ...(use.outcome === 'refused'
        ? [
            `, date_trunc('minute', NOW())) ON CONFLICT (share_id, key_id, md5(realm_url), md5(operation), md5(caller), mode, code, status, host, refusal_window) WHERE refusal_window IS NOT NULL DO UPDATE SET count = key_uses.count + 1, created_at = GREATEST(key_uses.created_at, EXCLUDED.created_at)`,
          ]
        : [`, NULL)`]),
    ]);
  }
  let now = Date.now();
  let last = lastSweep.get(dbAdapter);
  if (last === undefined || now - last >= SWEEP_INTERVAL_MS) {
    lastSweep.set(dbAdapter, now);
    // Not awaited: the call that happens to be due for a sweep doesn't wait
    // on a table-wide delete, and a sweep that fails is its own warning, not
    // a use that failed to record.
    void sweepExpiredKeyUses(dbAdapter).catch((error) =>
      log.warn(
        `sweeping expired key uses failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
}

// When each database's uses were last swept, by this process.
const lastSweep = new WeakMap<DBAdapter, number>();

// Removes every use past the retention window, by the database's clock, the
// same clock that stamped it.
export async function sweepExpiredKeyUses(dbAdapter: DBAdapter): Promise<void> {
  await query(dbAdapter, [
    `DELETE FROM key_uses WHERE created_at < NOW() - make_interval(days => `,
    param(KEY_USE_RETENTION_DAYS),
    `)`,
  ]);
}

// The caller a use is recorded under: a signed-in caller by their Matrix ID,
// and null for a caller who isn't signed in, whom a lookup names by the
// anonymous actor rather than leaving unset.
function recordedCaller(caller: string | undefined): string | null {
  return caller && caller !== ANONYMOUS_ACTOR ? caller : null;
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
      caller: recordedCaller(lookup.caller),
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
  limits: KeyLimitsView;
  budgets: BudgetUse;
  // The start of the current UTC month: the counts below are since then.
  since: string;
  calls: number;
  // `caller` is null for someone not signed in, and for someone withheld
  // from the viewer (`withheld`).
  lastUse: {
    at: string;
    caller: string | null;
    withheld?: true;
    operation: string;
    outcome: CallApiUse['outcome'];
  } | null;
  // The callers who used it most. Every caller withheld from the viewer is
  // counted together, in one entry.
  topCallers: { caller: string | null; calls: number; withheld?: true }[];
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

// Which callers the viewer may be shown. A share's callers include readers
// admitted by a `*` or `users` row, or a policy grant, none of which names
// anyone, so a share's caller is shown only as the share listings show its
// owner (`namedToViewer`, ADR 011 §1.1). A personal key serves only its
// owner's calls, so only the owner, who is the viewer, is ever shown.
async function namedCallers(
  dbAdapter: DBAdapter,
  viewer: string,
  realmURL: string | undefined,
  callers: string[],
): Promise<(caller: string) => boolean> {
  if (!realmURL) {
    return (caller) => caller === viewer;
  }
  let isNamed = await namedToViewer(
    (expression) => query(dbAdapter, expression),
    viewer,
    [realmURL],
    callers,
  );
  return (caller) => isNamed(realmURL, caller);
}

async function usageOf(
  dbAdapter: DBAdapter,
  subject: CallApiUseSubject,
  {
    viewer,
    realmURL,
    limits,
    grants,
    canEditLimits,
  }: {
    viewer: string;
    // The share's realm; absent for a personal key.
    realmURL?: string;
    limits: KeyLimitsView;
    grants: UsageGrant[];
    canEditLimits: boolean;
  },
): Promise<KeyUsage> {
  // The month is the database's, the clock that stamps every use.
  let [month] = await query(dbAdapter, [
    `SELECT date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS since`,
  ]);
  let since = iso(month.since)!;
  let where = () => [
    ` FROM key_uses WHERE ${subjectColumn(subject)} = `,
    param(subject.id),
    ` AND created_at >= `,
    param(since),
  ];
  let [count] = await query(dbAdapter, [
    `SELECT COALESCE(SUM(count), 0) AS calls`,
    ...where(),
  ]);
  let [last] = await query(dbAdapter, [
    `SELECT created_at, caller, operation, outcome FROM key_uses WHERE ${subjectColumn(subject)} = `,
    param(subject.id),
    ` ORDER BY created_at DESC, id DESC LIMIT 1`,
  ]);
  let callers = await query(dbAdapter, [
    `SELECT caller, SUM(count) AS calls`,
    ...where(),
    ` GROUP BY caller`,
  ]);
  let isShown = await namedCallers(
    dbAdapter,
    viewer,
    realmURL,
    [
      ...callers.map((row) => row.caller as string | null),
      (last?.caller as string | null) ?? null,
    ].filter((caller): caller is string => typeof caller === 'string'),
  );
  let isWithheld = (caller: string | null) =>
    caller !== null && !isShown(caller);
  let refusals = await query(dbAdapter, [
    `SELECT code, SUM(count) AS count`,
    ...where(),
    ` AND outcome = 'refused' AND code IS NOT NULL GROUP BY code ORDER BY count DESC, code`,
  ]);
  let outcomes = await query(dbAdapter, [
    `SELECT status, SUM(count) AS count`,
    ...where(),
    ` AND status IS NOT NULL GROUP BY status ORDER BY status`,
  ]);
  return {
    limits,
    budgets: await budgetUse(dbAdapter, subject, limits),
    since,
    calls: Number(count?.calls ?? 0),
    lastUse: last ? lastUseOf(last, isWithheld) : null,
    topCallers: topCallersOf(callers, isWithheld),
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

function lastUseOf(
  row: Record<string, unknown>,
  isWithheld: (caller: string | null) => boolean,
): NonNullable<KeyUsage['lastUse']> {
  let caller = (row.caller as string | null) ?? null;
  let withheld = isWithheld(caller);
  return {
    at: iso(row.created_at)!,
    caller: withheld ? null : caller,
    ...(withheld ? { withheld: true as const } : {}),
    operation: row.operation as string,
    outcome: row.outcome as CallApiUse['outcome'],
  };
}

// The callers who used it most, with every caller withheld from the viewer
// counted together, most calls first and then by id.
function topCallersOf(
  rows: Record<string, unknown>[],
  isWithheld: (caller: string | null) => boolean,
): KeyUsage['topCallers'] {
  let entries: KeyUsage['topCallers'] = [];
  let withheldCalls = 0;
  for (let row of rows) {
    let caller = (row.caller as string | null) ?? null;
    let calls = Number(row.calls);
    if (isWithheld(caller)) {
      withheldCalls += calls;
    } else {
      entries.push({ caller, calls });
    }
  }
  if (withheldCalls > 0) {
    entries.push({ caller: null, calls: withheldCalls, withheld: true });
  }
  // Named callers by id, then someone not signed in, then everyone withheld.
  let order = (entry: KeyUsage['topCallers'][number]) =>
    entry.caller !== null ? `0${entry.caller}` : entry.withheld ? '2' : '1';
  return entries
    .sort((a, b) => {
      let [x, y] = [order(a), order(b)];
      return b.calls - a.calls || (x < y ? -1 : x > y ? 1 : 0);
    })
    .slice(0, TOP_CALLERS);
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
  if (!isUUID(shareId)) {
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
      viewer: user,
      realmURL: share.realm_url as string,
      limits: limitsViewOf(share),
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
  if (!isUUID(keyId)) {
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
    {
      viewer: owner,
      limits: limitsViewOf(key),
      grants: grants.map(grantOf),
      canEditLimits: true,
    },
  );
}
