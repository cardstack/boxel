// The notices a person is owed about their automations (`automation_notices`):
// admission refused a run that acts as them over something they fix in the
// secure window, such as an operation whose binding they haven't approved.
//
// A notice is recorded once while unread: an automation that comes due
// every few minutes with its binding still unapproved adds no second notice
// until the person has seen the first. It is listed only while its recipient
// is still a direct writer of the automation's realm, since only a direct
// writer can act on it. The secure origin's key page lists them and marks the
// ones it shows read; the app reads only the unread count, for its badge.

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
}

// The most notices a listing returns, newest first.
const MAX_LISTED = 100;

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
].join(', ');

// Records a notice for `recipient`, unless an unread one for the same
// automation, reason and operation is waiting already. Returns whether it
// recorded one.
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
    ") ON CONFLICT (recipient, automation_id, reason, COALESCE(operation, '')) WHERE read_at IS NULL DO NOTHING RETURNING id",
  ] as Expression);
  return rows.length > 0;
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
  let rows = await query(dbAdapter, [
    `SELECT ${NOTICE_COLUMNS} FROM automation_notices WHERE recipient =`,
    param(recipient),
    `ORDER BY created_at DESC, id DESC LIMIT ${MAX_LISTED}`,
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
  };
}
