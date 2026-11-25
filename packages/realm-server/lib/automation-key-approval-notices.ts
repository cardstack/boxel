import {
  isDirectWriter,
  logger,
  param,
  query,
  separatedByCommas,
  type DBAdapter,
  type Expression,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';
import type { AwaitedKeyApproval } from '@cardstack/runtime-common/automation-key-approval';
import { KEY_NOTICES_UPDATED_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type { SendEvent } from '@cardstack/runtime-common/send-event';
import { matrixServerNameFromEnv } from '../utils/matrix-server-name.ts';
import { UserKeyError } from './user-keys.ts';

const log = logger('automation-key-approval-notices');

// Key approval notices (`automation_key_approval_notices`): while an
// automation waits for key approval, each person other than its payer whose
// approval it waits on, or who is asked to share a key it needs, has one
// notice about it. The notice names the automation, its workspace and each
// operation it is asked about with where the operation sends, and the key
// page links it to the secure window's `approve` page for the automation.
//
// The realm server keeps the notices in step with the automation's key
// approvals each time it checks them (`followKeyApprovalNotices`), which it
// does whenever the automation's state can follow its approvals: at switch-on
// and resume, when an approval lands or ends, and after an index pass that
// touched the automation's card or script. So a notice ends when the approval
// it asks for lands, when the operation leaves the card, or when the
// automation stops waiting, and goes with the automation's row when the
// automation is removed, from the console or because its card was deleted or
// stopped being an automation. Each recipient whose notice was recorded, changed or
// ended is sent `KEY_NOTICES_UPDATED_EVENT_TYPE`, so a session they have open
// reads the badge count again. A row an index pass removes is gone before
// any realm server checks it, so its recipients read the count the next time
// their session asks.
//
// A notice is listed only while its automation waits for key approval, and an
// operation that asks a realm's direct writer to share a key only while the
// recipient still directly writes the realm. What isn't listed isn't counted
// as unread either. The secure origin's key page lists them and marks the
// ones it shows read; the app reads only the unread count, for its badge.

export interface KeyApprovalNoticeOperation {
  operation: string;
  targetType: { module: string; name: string };
  destination: string;
  ask: AwaitedKeyApproval['ask'];
}

export interface KeyApprovalNotice {
  id: string;
  // The automation's card and its realm, as URLs.
  automation: string;
  realm: string;
  // The automation card's title as indexed; null when the index has none.
  title: string | null;
  operations: KeyApprovalNoticeOperation[];
  // When the key page first listed it; null while it is unread.
  readAt: string | null;
  createdAt: string;
}

// The most notices a listing returns, newest first.
const MAX_LISTED = 100;

let noticeSender: SendEvent | undefined;

// Who tells a recipient their key notices changed. The realm server sets it
// once its Matrix client can send; without one, recipients read the count the
// next time their session asks.
export function setKeyApprovalNoticeSender(next: SendEvent | undefined): void {
  noticeSender = next;
}

let pendingSends = new Set<Promise<void>>();

// Settles every send started so far, for a test that reads what was sent.
export async function keyApprovalNoticeSendsSettled(): Promise<void> {
  await Promise.allSettled([...pendingSends]);
}

// Brings the automation's notices in step with whom its key approvals wait
// on. `awaiting` is the check's answer (`checkAutomationKeyApprovals`), or
// undefined when the realm couldn't check, which leaves a waiting
// automation's notices as they are. The automation's row is read, locked, in
// the same transaction: when it is gone or isn't waiting for key approval,
// its notices end. Otherwise each recipient's notice holds the operations
// they are asked about now; a notice that asks about an operation it didn't
// before is unread again, and a recipient no longer waited on loses theirs.
export async function followKeyApprovalNotices(
  dbAdapter: DBAdapter,
  {
    automationId,
    automationURL,
    realmURL,
    awaiting,
  }: {
    automationId: RealmResourceIdentifier;
    automationURL: string;
    realmURL: string;
    awaiting: AwaitedKeyApproval[] | undefined;
  },
): Promise<void> {
  let told: string[] = [];
  try {
    told = await dbAdapter.withTransaction(async (txQuery) => {
      let [row] = await txQuery([
        'SELECT state FROM automations WHERE automation_id =',
        param(automationId),
        'FOR UPDATE',
      ]);
      let waiting = row?.state === 'waiting-for-key-approval';
      if (waiting && !awaiting) {
        return [];
      }
      let byRecipient = waiting ? operationsByRecipient(awaiting!) : new Map();
      let changed: string[] = [];
      for (let [recipient, operations] of byRecipient) {
        let rows = await txQuery([
          'INSERT INTO automation_key_approval_notices AS n (automation_id, recipient, automation_url, realm_url, operations) VALUES (',
          param(automationId),
          ',',
          param(recipient),
          ',',
          param(automationURL),
          ',',
          param(realmURL),
          ',',
          param(JSON.stringify(operations)),
          // A notice that already names every operation it asks about now
          // keeps whether it was read; one that names a new one is unread
          // again.
          `::jsonb) ON CONFLICT (automation_id, recipient) DO UPDATE SET
             operations = EXCLUDED.operations,
             automation_url = EXCLUDED.automation_url,
             realm_url = EXCLUDED.realm_url,
             read_at = CASE WHEN n.operations @> EXCLUDED.operations THEN n.read_at END,
             updated_at = now()
           WHERE n.operations IS DISTINCT FROM EXCLUDED.operations
              OR n.automation_url IS DISTINCT FROM EXCLUDED.automation_url
              OR n.realm_url IS DISTINCT FROM EXCLUDED.realm_url
           RETURNING recipient`,
        ]);
        if (rows.length > 0) {
          changed.push(recipient);
        }
      }
      let kept = [...byRecipient.keys()];
      let ended = await txQuery([
        'DELETE FROM automation_key_approval_notices WHERE automation_id =',
        param(automationId),
        ...(kept.length
          ? [
              'AND recipient NOT IN (',
              ...separatedByCommas(kept.map((recipient) => [param(recipient)])),
              ')',
            ]
          : []),
        'RETURNING recipient',
      ] as Expression);
      return [...changed, ...ended.map((row) => String(row.recipient))];
    });
  } catch (error) {
    log.warn(
      `could not bring the key approval notices of automation ${automationId} in step: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  tell(told);
}

// The recipients of the automation's notices, read before a change that
// removes its row (and with it, `ON DELETE CASCADE`, its notices), so they
// can be told once the change commits (`tellKeyApprovalNoticesChanged`).
export async function keyApprovalNoticeRecipients(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
): Promise<string[]> {
  try {
    let rows = await query(dbAdapter, [
      'SELECT recipient FROM automation_key_approval_notices WHERE automation_id =',
      param(automationId),
    ]);
    return rows.map((row) => String(row.recipient));
  } catch (error) {
    log.warn(
      `could not read the key approval notices of automation ${automationId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

// Tells each recipient their key notices changed.
export function tellKeyApprovalNoticesChanged(recipients: string[]): void {
  tell(recipients);
}

// Each recipient's operations, in the order the check answered them, one
// entry per operation and ask.
function operationsByRecipient(
  awaiting: AwaitedKeyApproval[],
): Map<string, KeyApprovalNoticeOperation[]> {
  let byRecipient = new Map<string, KeyApprovalNoticeOperation[]>();
  for (let { recipient, ask, operation, targetType, destination } of awaiting) {
    let operations = byRecipient.get(recipient) ?? [];
    if (
      !operations.some(
        (listed) =>
          listed.operation === operation &&
          listed.ask === ask &&
          listed.targetType.module === targetType.module &&
          listed.targetType.name === targetType.name,
      )
    ) {
      operations.push({ operation, targetType, destination, ask });
    }
    byRecipient.set(recipient, operations);
  }
  return byRecipient;
}

function tell(recipients: string[]): void {
  let send = noticeSender;
  if (!send) {
    return;
  }
  for (let recipient of new Set(recipients)) {
    let sending = (async () => {
      try {
        await send(recipient, KEY_NOTICES_UPDATED_EVENT_TYPE);
      } catch (error) {
        // The notice is recorded either way; the recipient sees it the next
        // time their session asks.
        log.warn(
          `could not tell ${recipient} their key approval notices changed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
    pendingSends.add(sending);
    void sending.finally(() => pendingSends.delete(sending));
  }
}

function noticeOf(row: Record<string, any>): KeyApprovalNotice {
  return {
    id: String(row.id),
    automation: row.automation_url,
    realm: row.realm_url,
    title: typeof row.title === 'string' && row.title ? row.title : null,
    operations: row.operations,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// The recipient's notices whose automation still waits for key approval,
// newest first. An operation that asks the recipient to share a key is left
// out once they no longer directly write its realm, and a notice left with no
// operation isn't listed.
export async function listKeyApprovalNotices(
  dbAdapter: DBAdapter,
  recipient: string,
): Promise<KeyApprovalNotice[]> {
  let rows = (await query(dbAdapter, [
    `SELECT n.id, n.automation_url, n.realm_url, n.operations, n.read_at, n.created_at,
            (SELECT NULLIF(COALESCE(i.pristine_doc -> 'attributes' ->> 'cardTitle', i.pristine_doc -> 'attributes' -> 'cardInfo' ->> 'name'), '')
               FROM boxel_index i
              WHERE (i.url = n.automation_url OR i.file_alias = n.automation_url)
                AND i.type = 'instance'
                AND (i.is_deleted = FALSE OR i.is_deleted IS NULL)
              LIMIT 1) AS title
       FROM automation_key_approval_notices n
       JOIN automations a ON a.automation_id = n.automation_id
      WHERE a.state = 'waiting-for-key-approval' AND n.recipient = `,
    param(recipient),
    ` ORDER BY n.created_at DESC, n.id DESC LIMIT ${MAX_LISTED}`,
  ])) as Record<string, any>[];
  let writes = new Map<string, Promise<boolean>>();
  let writesRealm = (realm: string) => {
    let answer = writes.get(realm);
    if (!answer) {
      answer = isDirectWriter(
        dbAdapter,
        new URL(realm),
        recipient,
        matrixServerNameFromEnv(),
      );
      writes.set(realm, answer);
    }
    return answer;
  };
  let listed: KeyApprovalNotice[] = [];
  for (let row of rows) {
    let notice = noticeOf(row);
    let operations: KeyApprovalNoticeOperation[] = [];
    for (let operation of notice.operations) {
      if (
        operation.ask === 'share-a-key' &&
        !(await writesRealm(notice.realm))
      ) {
        continue;
      }
      operations.push(operation);
    }
    if (operations.length > 0) {
      listed.push({ ...notice, operations });
    }
  }
  return listed;
}

// How many of the notices the recipient's key page lists it hasn't marked
// read: their part of the count the app shows on the user's avatar.
export async function countUnreadKeyApprovalNotices(
  dbAdapter: DBAdapter,
  recipient: string,
): Promise<number> {
  return (await listKeyApprovalNotices(dbAdapter, recipient)).filter(
    (notice) => !notice.readAt,
  ).length;
}

// Marks the recipient's notices with these ids read, as their key page does
// once it has shown them. Naming the ids leaves a notice recorded, or made
// unread again, after the page loaded unread until a page lists it. Ids that
// aren't the recipient's, or are already read, are passed over. Answers how
// many it marked.
export async function markKeyApprovalNoticesRead(
  dbAdapter: DBAdapter,
  recipient: string,
  ids: unknown,
): Promise<number> {
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_LISTED ||
    !ids.every((id) => typeof id === 'string' && /^[0-9]{1,18}$/.test(id))
  ) {
    throw new UserKeyError(
      400,
      `ids must be a list of at most ${MAX_LISTED} notice ids`,
    );
  }
  if (ids.length === 0) {
    return 0;
  }
  let rows = (await query(dbAdapter, [
    `UPDATE automation_key_approval_notices SET read_at = NOW() WHERE recipient = `,
    param(recipient),
    ` AND read_at IS NULL AND id IN (`,
    // Bound as text and cast, so an id past 2^53 isn't rounded on the way.
    ...separatedByCommas(ids.map((id) => [param(id), '::bigint'])),
    `) RETURNING id`,
  ] as Expression)) as { id: unknown }[];
  return rows.length;
}
