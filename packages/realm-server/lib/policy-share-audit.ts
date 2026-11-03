import { createHash } from 'node:crypto';
import {
  CardError,
  isDirectWriter,
  logger,
  param,
  query,
  realmPolicyCardNamed,
  rri,
  separatedByCommas,
  type DBAdapter,
  type Expression,
  type LocalPath,
  type PolicyShareAudit,
  type PolicyShareAuditEntry,
  type PolicyWriteAudit,
  type PolicyWriteAuditor,
  type PolicyWriteAuditRequest,
  type Realm,
  type ServedRealm,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import type { ResolvedCodeRef } from '@cardstack/runtime-common/code-ref';
import { KEY_NOTICES_UPDATED_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type { SendEvent } from '@cardstack/runtime-common/send-event';
import { servesVisitorsSQL, UserKeyError } from './user-keys.ts';

// The realm server's side of the policy audit (`policy-share-audit.ts` in
// runtime-common): which realms a write's policy change governs, which shares
// in them it opens to people who aren't signed in, and the notices their
// owners get once a confirmed change lands.
//
// A write changes the policy a realm is governed by when it writes the
// realm's own `realm.json` naming another policy card (or none), or writes a
// policy card the realm names. A written card is a policy card when what is
// written adopts from RealmPolicy, so a card a realm names before it exists,
// or one deleted and written again, is audited like any other.
//
// Only a realm with a share bound to an operation can be affected, and only
// through an active, interactive binding on an active share: that is the only
// kind that ever serves a visitor (`checkSlot` in `key-bindings.ts`). So those
// realms are the only ones asked about. Each one's pointer is read without
// mounting it (`realmPolicyPointer`), and only a realm whose pointer names a
// changed card is mounted, to compile the policy it would be governed by from
// the bytes being written and compare it with the policy in force. A realm
// that names a changed card and can't be mounted refuses the write: it can't
// be audited, and letting the write through would open its shares unseen.
//
// A share is listed when one of its bindings is for an operation the new
// policy opens to visitors with a shared key and the policy in force doesn't.
// A share whose key can never serve visitors (a sign-in app's, or a
// connection's) isn't listed: no policy puts it in front of them.
//
// The saver is shown the list as they may see it. A realm's shares are its
// direct writers' to see (`key-shares.ts`), so for a realm the saver isn't a
// direct writer of, each entry keeps its realm, policy, operations and whether
// its key allows anonymous use, and leaves out the share, label and owner. The
// confirmation is computed from the list in full either way.
//
// A refused write leaves the realm as it was, so the audit reads the stored
// state of every realm but the bytes this write would put down.

const log = logger('realm:policy-share-audit');

// A realm's policy pointer, read without mounting it: the card it names,
// undefined for none, or null where it can't be read that way.
export type PolicyPointerReader = (
  realmURL: string,
) => Promise<string | undefined | null>;

export function createPolicyWriteAuditor({
  dbAdapter,
  realmFor,
  virtualNetwork,
  policyPointerOf = async () => null,
  sendEvent,
}: {
  dbAdapter: DBAdapter;
  realmFor: (url: URL) => Promise<ServedRealm | undefined>;
  virtualNetwork: VirtualNetwork;
  // Without it, each candidate realm is mounted to read its pointer.
  policyPointerOf?: PolicyPointerReader;
  // Tells each owner a notice was recorded for that one is waiting, so a
  // session they have open shows it (`KEY_NOTICES_UPDATED_EVENT_TYPE`).
  sendEvent?: SendEvent;
}): PolicyWriteAuditor {
  return {
    audit: (request) =>
      auditPolicyWrite(request, {
        dbAdapter,
        realmFor,
        virtualNetwork,
        policyPointerOf,
      }),
    notify: async (audit, savedBy) => {
      let owners: Set<string>;
      try {
        owners = await recordPolicyNotices(dbAdapter, audit, savedBy);
      } catch (err: unknown) {
        log.warn(
          `could not record the notices of a policy change that opens shares to people who aren't signed in: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      if (!sendEvent) {
        return;
      }
      for (let owner of owners) {
        try {
          await sendEvent(owner, KEY_NOTICES_UPDATED_EVENT_TYPE);
        } catch (err: unknown) {
          // The notice is recorded either way; the owner sees it the next
          // time their session asks.
          log.warn(
            `could not tell ${owner} a key notice is waiting: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    },
  };
}

interface AuditTarget {
  realm: Realm;
  // The policy the realm would be governed by, or null for none.
  next: { card: string; attributes?: Record<string, any> } | null;
}

async function auditPolicyWrite(
  request: PolicyWriteAuditRequest,
  {
    dbAdapter,
    realmFor,
    virtualNetwork,
    policyPointerOf,
  }: {
    dbAdapter: DBAdapter;
    realmFor: (url: URL) => Promise<ServedRealm | undefined>;
    virtualNetwork: VirtualNetwork;
    policyPointerOf: PolicyPointerReader;
  },
): Promise<PolicyWriteAudit | undefined> {
  let written = new Map<string, LocalPath>();
  for (let path of request.paths) {
    if (path.endsWith('.json')) {
      written.set(cardIdOf(request.realmURL, path), path);
    }
  }
  let configWritten = request.paths.includes('realm.json');
  let changedPolicies = new Set<string>();
  for (let [card, path] of written) {
    if (path !== 'realm.json' && (await request.writesPolicyCard(path))) {
      changedPolicies.add(card);
    }
  }
  if (changedPolicies.size === 0 && !configWritten) {
    return undefined;
  }
  let candidates = (
    (await query(dbAdapter, [
      `SELECT DISTINCT s.realm_url FROM key_shares s
         JOIN key_bindings b ON b.share_id = s.id
        WHERE s.key_id IS NOT NULL AND s.state = 'active'
          AND b.interactive AND b.state = 'active'`,
      ...(changedPolicies.size === 0
        ? [` AND s.realm_url = `, param(request.realmURL)]
        : []),
      ` ORDER BY s.realm_url`,
    ])) as { realm_url: string }[]
  ).map((row) => row.realm_url);
  if (candidates.length === 0) {
    return undefined;
  }

  // The attributes a written policy card will hold.
  let attributesOf = async (path: LocalPath) => {
    try {
      let attributes = JSON.parse(await request.contentOf(path))?.data
        ?.attributes;
      return attributes &&
        typeof attributes === 'object' &&
        !Array.isArray(attributes)
        ? (attributes as Record<string, any>)
        : {};
    } catch {
      return {};
    }
  };
  let nextPolicy = async (card: string | undefined) => {
    if (!card) {
      return null;
    }
    let path = written.get(stripJSON(card));
    return path ? { card, attributes: await attributesOf(path) } : { card };
  };
  let mount = async (realmURL: string): Promise<Realm> => {
    let realm: Realm | undefined;
    try {
      let served = await realmFor(new URL(realmURL));
      realm = served?.url === realmURL ? await served.mount() : undefined;
    } catch (err: unknown) {
      log.warn(
        `could not mount ${realmURL} to audit a policy change against its shares: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!realm) {
      throw new CardError(
        `This change can't be saved now: it changes the policy of ${realmURL}, which keys are shared into, and that workspace can't be checked for what the change opens to people who aren't signed in. Try again shortly.`,
        { status: 503, title: 'Policy change not checked' },
      );
    }
    return realm;
  };

  let targets: AuditTarget[] = [];
  for (let realmURL of candidates) {
    if (realmURL === request.realmURL && configWritten) {
      let realm = await mount(realmURL);
      let current = (await realm.getRealmPolicy())?.card;
      let config: unknown;
      try {
        config = JSON.parse(await request.contentOf('realm.json'));
      } catch {
        config = undefined;
      }
      let next = realmPolicyCardNamed(
        (config as { data?: { attributes?: { policy?: unknown } } } | undefined)
          ?.data?.attributes?.policy,
        virtualNetwork,
      );
      if (next !== current || (next && changedPolicies.has(stripJSON(next)))) {
        targets.push({ realm, next: await nextPolicy(next) });
      }
      continue;
    }
    if (changedPolicies.size === 0) {
      continue;
    }
    let pointer = await policyPointerOf(realmURL);
    if (pointer === null) {
      pointer = (await (await mount(realmURL)).getRealmPolicy())?.card;
    }
    if (pointer && changedPolicies.has(stripJSON(pointer))) {
      targets.push({
        realm: await mount(realmURL),
        next: await nextPolicy(pointer),
      });
    }
  }
  if (targets.length === 0) {
    return undefined;
  }

  let entries: PolicyShareAuditEntry[] = [];
  for (let target of targets) {
    entries.push(...(await openedShares(dbAdapter, target)));
  }
  if (entries.length === 0) {
    return undefined;
  }
  entries.sort(
    (a, b) =>
      a.realm.localeCompare(b.realm) ||
      (a.label ?? '').localeCompare(b.label ?? '') ||
      (a.share ?? '').localeCompare(b.share ?? ''),
  );
  let confirmation = createHash('sha256')
    .update(JSON.stringify(entries))
    .digest('hex');
  let audit: PolicyShareAudit = { entries, confirmation };
  let visible = new Map<string, boolean>();
  for (let realm of new Set(entries.map((entry) => entry.realm))) {
    visible.set(
      realm,
      request.actor
        ? await isDirectWriter(dbAdapter, new URL(realm), request.actor)
        : false,
    );
  }
  let shown: PolicyShareAudit = {
    confirmation,
    entries: entries.map((entry) =>
      visible.get(entry.realm)
        ? entry
        : { ...entry, share: null, label: null, owner: null },
    ),
  };
  return { audit, shown };
}

// The shares in the target's realm that the policy it would be governed by
// opens to visitors while the one in force doesn't: those bound to such an
// operation through an active, interactive binding on an active share, whose
// key can serve visitors at all.
async function openedShares(
  dbAdapter: DBAdapter,
  { realm, next }: AuditTarget,
): Promise<PolicyShareAuditEntry[]> {
  if (!next) {
    return [];
  }
  let rows = (await query(dbAdapter, [
    `SELECT DISTINCT b.share_id, b.definition_url, b.export_name, b.operation_name,
            s.label, s.owner, k.anonymous
       FROM key_bindings b
       JOIN key_shares s ON s.id = b.share_id
       JOIN user_keys k ON k.id = s.key_id
       LEFT JOIN oauth_clients c ON c.key_id = k.id
      WHERE b.realm_url = `,
    param(realm.url),
    ` AND b.interactive AND b.state = 'active' AND s.state = 'active'`,
    ` AND ${servesVisitorsSQL('k', 'c')}`,
  ])) as {
    share_id: string;
    definition_url: string;
    export_name: string;
    operation_name: string;
    label: string;
    owner: string;
    anonymous: boolean | null;
  }[];
  if (rows.length === 0) {
    return [];
  }
  let asked = new Map<
    string,
    { codeRef: ResolvedCodeRef; operation: string }
  >();
  for (let row of rows) {
    asked.set(operationName(row), {
      codeRef: { module: rri(row.definition_url), name: row.export_name },
      operation: row.operation_name,
    });
  }
  let questions = [...asked.entries()];
  let answers = await realm.sharedKeyOpeningsAdded(
    next,
    questions.map(([, question]) => question),
  );
  let opened = new Set(
    questions.filter((_, i) => answers[i]).map(([name]) => name),
  );
  let byShare = new Map<string, PolicyShareAuditEntry>();
  for (let row of rows) {
    let name = operationName(row);
    if (!opened.has(name)) {
      continue;
    }
    let entry = byShare.get(row.share_id);
    if (!entry) {
      entry = {
        realm: realm.url,
        policy: next.card,
        share: row.share_id,
        label: row.label,
        owner: row.owner,
        keyAllowsAnonymous: Boolean(row.anonymous),
        operations: [],
      };
      byShare.set(row.share_id, entry);
    }
    if (!entry.operations.includes(name)) {
      entry.operations.push(name);
    }
  }
  for (let entry of byShare.values()) {
    entry.operations.sort();
  }
  return [...byShare.values()];
}

// One notice per listed share, unless the owner's latest notice for that share
// already says the same: a save confirmed again before the first one's index
// pass lands is audited against the policy it replaced, and owes no second
// notice. Answers the owners a notice was recorded for.
async function recordPolicyNotices(
  dbAdapter: DBAdapter,
  audit: PolicyShareAudit,
  savedBy: string | null,
): Promise<Set<string>> {
  let owners = new Set<string>();
  for (let entry of audit.entries) {
    if (!entry.share) {
      continue;
    }
    let reason = entry.keyAllowsAnonymous ? 'visitors-use' : 'visitors-wanted';
    let operations = JSON.stringify(entry.operations);
    let rows = (await query(dbAdapter, [
      `INSERT INTO key_policy_notices (owner, share_id, key_id, realm_url, label, policy_card, saved_by, reason, operations)
       SELECT s.owner, s.id, s.key_id, s.realm_url, s.label, `,
      param(entry.policy),
      `, `,
      param(savedBy),
      `, `,
      param(reason),
      `, `,
      param(operations),
      `::jsonb FROM key_shares s WHERE s.id = `,
      param(entry.share),
      ` AND NOT EXISTS (
          SELECT 1 FROM (
            SELECT reason, policy_card, operations FROM key_policy_notices
             WHERE share_id = s.id ORDER BY created_at DESC, id DESC LIMIT 1
          ) latest
          WHERE latest.reason = `,
      param(reason),
      ` AND latest.policy_card IS NOT DISTINCT FROM `,
      param(entry.policy),
      ` AND latest.operations = `,
      param(operations),
      `::jsonb) RETURNING owner`,
    ])) as { owner: string }[];
    for (let { owner } of rows) {
      owners.add(owner);
    }
  }
  return owners;
}

export interface KeyPolicyNotice {
  id: string;
  realm: string;
  share: string;
  label: string;
  // The key the share holds, null once the key is deleted.
  key: string | null;
  policy: string | null;
  savedBy: string | null;
  reason: 'visitors-use' | 'visitors-wanted';
  operations: string[];
  // When the owner declined a `visitors-wanted` request; null otherwise.
  declinedAt: string | null;
  // When the owner's key page first listed it; null while it is unread.
  readAt: string | null;
  createdAt: string;
}

// The user's notices as a key's owner, newest first, at most 100.
export async function listOwnPolicyNotices(
  dbAdapter: DBAdapter,
  owner: string,
): Promise<KeyPolicyNotice[]> {
  let rows = (await query(dbAdapter, [
    `SELECT ${NOTICE_COLUMNS} FROM key_policy_notices WHERE owner = `,
    param(owner),
    ` ORDER BY created_at DESC, id DESC LIMIT 100`,
  ])) as Record<string, any>[];
  return rows.map(noticeOf);
}

const NOTICE_COLUMNS =
  'id, share_id, key_id, realm_url, label, policy_card, saved_by, reason, operations, declined_at, read_at, created_at';

function noticeOf(row: Record<string, any>): KeyPolicyNotice {
  return {
    id: String(row.id),
    realm: row.realm_url,
    share: row.share_id,
    label: row.label,
    key: row.key_id ?? null,
    policy: row.policy_card ?? null,
    savedBy: row.saved_by ?? null,
    reason: row.reason,
    operations:
      typeof row.operations === 'string'
        ? JSON.parse(row.operations)
        : row.operations,
    declinedAt: row.declined_at
      ? new Date(row.declined_at).toISOString()
      : null,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// How many of the owner's notices their key page hasn't listed yet: the count
// the app shows on the user's avatar.
export async function countUnreadPolicyNotices(
  dbAdapter: DBAdapter,
  owner: string,
): Promise<number> {
  let [row] = (await query(dbAdapter, [
    `SELECT COUNT(*) AS unread FROM key_policy_notices WHERE owner = `,
    param(owner),
    ` AND read_at IS NULL`,
  ])) as { unread: number | string }[];
  return Number(row?.unread ?? 0);
}

// The most notices one request marks read: the most a listing returns.
const MAX_MARKED_READ = 100;

// Marks the owner's notices with these ids read, as their key page does once
// it has shown them. Naming the ids, rather than marking everything, leaves a
// notice recorded after the page loaded unread until a page lists it. Ids that
// aren't the owner's, or are already read, are passed over. Answers how many
// it marked.
export async function markPolicyNoticesRead(
  dbAdapter: DBAdapter,
  owner: string,
  ids: unknown,
): Promise<number> {
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_MARKED_READ ||
    !ids.every((id) => typeof id === 'string' && /^[0-9]{1,18}$/.test(id))
  ) {
    throw new UserKeyError(
      400,
      `ids must be a list of at most ${MAX_MARKED_READ} notice ids`,
    );
  }
  if (ids.length === 0) {
    return 0;
  }
  let rows = (await query(dbAdapter, [
    `UPDATE key_policy_notices SET read_at = NOW() WHERE owner = `,
    param(owner),
    ` AND read_at IS NULL AND id IN (`,
    ...separatedByCommas(ids.map((id) => [param(Number(id))])),
    `) RETURNING id`,
  ] as Expression)) as { id: unknown }[];
  return rows.length;
}

// The owner declines a workspace's request that visitors use one of their
// keys. It changes nothing about the key: visitors there stay refused, as
// they are until the key allows them. The request isn't shown again, and the
// same request isn't made again by saving the same policy (see
// `recordPolicyNotices`). Only a `visitors-wanted` notice of the owner's own,
// not yet declined, can be.
export async function declinePolicyNotice(
  dbAdapter: DBAdapter,
  owner: string,
  id: string,
): Promise<KeyPolicyNotice> {
  if (!/^[0-9]+$/.test(id)) {
    throw new UserKeyError(404, 'no such notice');
  }
  let [row] = (await query(dbAdapter, [
    `UPDATE key_policy_notices SET declined_at = NOW() WHERE id = `,
    param(Number(id)),
    ` AND owner = `,
    param(owner),
    ` AND reason = 'visitors-wanted' AND declined_at IS NULL RETURNING ${NOTICE_COLUMNS}`,
  ])) as Record<string, any>[];
  if (!row) {
    let [existing] = (await query(dbAdapter, [
      `SELECT reason, declined_at FROM key_policy_notices WHERE id = `,
      param(Number(id)),
      ` AND owner = `,
      param(owner),
    ])) as { reason: string; declined_at: string | null }[];
    if (!existing) {
      throw new UserKeyError(404, 'no such notice');
    }
    throw new UserKeyError(
      409,
      existing.reason === 'visitors-wanted'
        ? 'this request is already declined'
        : 'only a request that visitors use a key can be declined',
    );
  }
  return noticeOf(row);
}

// An operation as a notice and a confirmation name it, the way
// `boxel keys approve --operation` does.
function operationName(row: {
  definition_url: string;
  export_name: string;
  operation_name: string;
}): string {
  return `${row.definition_url}#${row.export_name}.${row.operation_name}`;
}

// A written file as the id a realm's `policy` names a card by.
function cardIdOf(realmURL: string, path: LocalPath): string {
  return stripJSON(new URL(path, realmURL).href);
}

function stripJSON(url: string): string {
  return url.replace(/\.json$/, '');
}
