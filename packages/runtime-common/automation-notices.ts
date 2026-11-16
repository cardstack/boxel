// The notices a person is owed about their automations (`automation_notices`):
// admission refused a run that acts as them over something they fix in the
// secure window, such as an operation whose binding they haven't approved.
//
// One notice stands for each recipient, automation, reason, operation and
// type: a later refusal of the same kind refreshes it (`last_refused_at`)
// rather than adding another, so an automation that comes due every few
// minutes with its binding still unapproved holds one notice, and the badge
// doesn't come back after the person has seen it. A notice ends when what it
// reports is fixed: a run of the automation that acts as the person is
// admitted (`clearAutomationNotices`), or the person approves the operation
// (`clearApprovedAutomationNotices`). It is listed only while its recipient is
// still a direct writer of the automation's realm, since only a direct writer
// can act on it, and only while a refusal refreshed it in the last
// `NOTICE_LISTED_DAYS`, so a notice whose automation stopped running drops
// away. The secure origin's key page lists them and marks the ones it shows
// read; the app reads only the unread count, for its badge.

import type { DBAdapter } from './db.ts';
import { isDirectWriter } from './db-queries/realm-permission-queries.ts';
import {
  param,
  query,
  separatedByCommas,
  type Expression,
} from './expression.ts';
import type {
  RealmIdentifier,
  RealmResourceIdentifier,
} from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';

// The admission refusals a person fixes in the secure window, each of which
// leaves them a notice:
// - `binding-not-approved`: approve the operation for automations there.
// - `binding-needs-reapproval`: the operation's request changed since they
//   approved it; approve it again.
// - `share-suspended`: the realm's share the operation uses is suspended;
//   a direct writer resumes it, or the key's owner swaps in another key.
// - `credential-rejected`: the vendor refused the key or connection the
//   operation uses; reconnect it, or replace the key.
export const NOTICED_ADMISSION_REFUSALS = [
  'binding-not-approved',
  'binding-needs-reapproval',
  'share-suspended',
  'credential-rejected',
] as const;

export type NoticedAdmissionRefusal =
  (typeof NOTICED_ADMISSION_REFUSALS)[number];

export function isNoticedAdmissionRefusal(
  code: string,
): code is NoticedAdmissionRefusal {
  return (NOTICED_ADMISSION_REFUSALS as readonly string[]).includes(code);
}

export interface AutomationNotice {
  id: string;
  automationId: RealmResourceIdentifier;
  realm: RealmIdentifier;
  // The run admission refused, while its row is kept.
  runId: string | null;
  reason: NoticedAdmissionRefusal;
  // The declared operation refused, and the type it is declared on.
  operation: string | null;
  targetType: { module: string; name: string } | null;
  // What the refusal said.
  detail: string;
  // When the key page first listed it; null while it is unread.
  readAt: string | null;
  createdAt: string;
  // The most recent refusal it reports.
  lastRefusedAt: string;
}

// The most notices a listing returns, newest first.
const MAX_LISTED = 100;

// How long a notice is listed after the refusal that last refreshed it.
export const NOTICE_LISTED_DAYS = 30;

const NOTICE_COLUMNS = [
  'id',
  'automation_id',
  'realm',
  'run_id',
  'reason',
  'operation',
  'target_module',
  'target_name',
  'detail',
  'read_at',
  'created_at',
  'last_refused_at',
].join(', ');

// Records a notice for `recipient`, or refreshes the one that stands for
// the same automation, reason, operation and type. A refreshed notice keeps
// whether it was read. Returns whether it recorded a new one.
export async function recordAutomationNotice(
  dbAdapter: DBAdapter,
  notice: {
    recipient: string;
    automationId: RealmResourceIdentifier;
    realm: RealmIdentifier;
    runId: string;
    reason: NoticedAdmissionRefusal;
    // The declared operation refused, and the type it is declared on.
    operation?: {
      operation: string;
      targetType: { module: string; name: string };
    };
    detail: string;
  },
): Promise<boolean> {
  let rows = await query(dbAdapter, [
    'INSERT INTO automation_notices (recipient, automation_id, realm, run_id, reason, operation, target_module, target_name, detail) VALUES (',
    ...separatedByCommas([
      [param(notice.recipient)],
      [param(notice.automationId)],
      [param(notice.realm)],
      [param(notice.runId)],
      [param(notice.reason)],
      [param(notice.operation?.operation ?? null)],
      [
        param(
          notice.operation ? String(notice.operation.targetType.module) : null,
        ),
      ],
      [param(notice.operation?.targetType.name ?? null)],
      [param(notice.detail)],
    ]),
    `) ON CONFLICT (recipient, automation_id, reason, COALESCE(operation, ''), COALESCE(target_module, ''), COALESCE(target_name, ''))
      DO UPDATE SET run_id = EXCLUDED.run_id, detail = EXCLUDED.detail, realm = EXCLUDED.realm, last_refused_at = now()
      RETURNING (xmax = 0) AS inserted`,
  ] as Expression);
  return Boolean(rows[0]?.inserted);
}

// Ends `recipient`'s notices about `automationId`: a run of it that acts as
// them was admitted, so nothing they report stands.
export async function clearAutomationNotices(
  dbAdapter: DBAdapter,
  { recipient, automationId }: { recipient: string; automationId: string },
): Promise<void> {
  await query(dbAdapter, [
    'DELETE FROM automation_notices WHERE recipient =',
    param(recipient),
    'AND automation_id =',
    param(automationId),
  ]);
}

// Ends `recipient`'s notices that an operation of theirs isn't approved, or
// needs approving again, once they approve an operation of that name on a
// type of that name. A notice whose automation still can't run comes back
// with its next refusal.
export async function clearApprovedAutomationNotices(
  dbAdapter: DBAdapter,
  {
    recipient,
    operations,
  }: { recipient: string; operations: { operation: string; name: string }[] },
): Promise<void> {
  for (let { operation, name } of operations) {
    await query(dbAdapter, [
      'DELETE FROM automation_notices WHERE recipient =',
      param(recipient),
      "AND reason IN ('binding-not-approved', 'binding-needs-reapproval') AND operation =",
      param(operation),
      'AND target_name =',
      param(name),
    ]);
  }
}

// The notices `recipient` is owed, newest first: those of realms they still
// directly write.
export async function listAutomationNotices(
  dbAdapter: DBAdapter,
  recipient: string,
  {
    virtualNetwork,
    matrixServerName,
  }: {
    virtualNetwork: Pick<VirtualNetwork, 'toURL'>;
    matrixServerName: string;
  },
): Promise<AutomationNotice[]> {
  // Every standing notice is read and filtered before the listing is cut to
  // `MAX_LISTED`, so notices of realms the recipient no longer writes can't
  // crowd out the ones they can act on. One notice stands per subject, so a
  // recipient has few.
  let rows = await query(dbAdapter, [
    `SELECT ${NOTICE_COLUMNS} FROM automation_notices WHERE recipient =`,
    param(recipient),
    `AND last_refused_at > now() - interval '${NOTICE_LISTED_DAYS} days'`,
    'ORDER BY last_refused_at DESC, id DESC',
  ] as Expression);
  let writes = new Map<string, Promise<boolean>>();
  let listed: AutomationNotice[] = [];
  for (let row of rows) {
    let realm = String(row.realm);
    let writer = writes.get(realm);
    if (!writer) {
      writer = isDirectWriter(
        dbAdapter,
        virtualNetwork.toURL(realm as RealmIdentifier),
        recipient,
        matrixServerName,
      );
      writes.set(realm, writer);
    }
    if (await writer) {
      listed.push(noticeOf(row));
      if (listed.length === MAX_LISTED) {
        break;
      }
    }
  }
  return listed;
}

export async function countUnreadAutomationNotices(
  dbAdapter: DBAdapter,
  recipient: string,
  options: {
    virtualNetwork: Pick<VirtualNetwork, 'toURL'>;
    matrixServerName: string;
  },
): Promise<number> {
  return (await listAutomationNotices(dbAdapter, recipient, options)).filter(
    (notice) => notice.readAt === null,
  ).length;
}

// Marks the recipient's notices with these ids read, as their key page does
// once it has shown them. Naming the ids, rather than marking everything,
// leaves a notice recorded after the page loaded unread until a page lists
// it. Ids that aren't the recipient's, or are already read, are passed over.
// Returns how many it marked.
export async function markAutomationNoticesRead(
  dbAdapter: DBAdapter,
  recipient: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  let rows = await query(dbAdapter, [
    'UPDATE automation_notices SET read_at = now() WHERE recipient =',
    param(recipient),
    'AND read_at IS NULL AND id IN (',
    // Bound as text and cast, so an id past 2^53 isn't rounded on the way.
    ...separatedByCommas(ids.map((id) => [param(id), '::bigint'])),
    ') RETURNING id',
  ] as Expression);
  return rows.length;
}

// The most ids one request may mark read: the most a listing returns.
export const MAX_MARKED_AUTOMATION_NOTICES = MAX_LISTED;

function noticeOf(row: Record<string, any>): AutomationNotice {
  return {
    id: String(row.id),
    automationId: row.automation_id as RealmResourceIdentifier,
    realm: row.realm as RealmIdentifier,
    runId: row.run_id ?? null,
    reason: row.reason as NoticedAdmissionRefusal,
    operation: row.operation ?? null,
    targetType:
      row.target_module && row.target_name
        ? { module: String(row.target_module), name: String(row.target_name) }
        : null,
    detail: String(row.detail),
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    lastRefusedAt: new Date(row.last_refused_at).toISOString(),
  };
}
