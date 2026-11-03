import { createHash } from 'node:crypto';
import {
  logger,
  param,
  query,
  realmPolicyCardNamed,
  rri,
  type DBAdapter,
  type LocalPath,
  type PolicyShareAudit,
  type PolicyShareAuditEntry,
  type PolicyWriteAuditor,
  type PolicyWriteAuditRequest,
  type Realm,
  type ServedRealm,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import type { ResolvedCodeRef } from '@cardstack/runtime-common/code-ref';
import { servesVisitorsSQL } from './user-keys.ts';

// The realm server's side of the policy audit (`policy-share-audit.ts` in
// runtime-common): which realms a write's policy change governs, which shares
// in them it opens to people who aren't signed in, and the notices their
// owners get once a confirmed change lands.
//
// Only a realm with a share in it can be affected, so those are the only
// realms asked about. For each of them the write changes the policy in force
// when it writes the realm's own `realm.json` and names another policy card
// (or none), or when it writes the policy card the realm names. The policy
// the realm would then be governed by is compiled by that realm, as it
// compiles its own, from the bytes being written where the card is among
// them, and compared with the policy in force. A share is listed when one of
// its bindings is for an operation the new policy opens to visitors with a
// shared key and the policy in force doesn't. A share whose key can never
// serve visitors (a sign-in app's, or a connection's) isn't listed: no policy
// puts it in front of them.
//
// A refused write leaves the realm as it was, so the audit reads the stored
// state of every realm but the bytes this write would put down.

const log = logger('realm:policy-share-audit');

export function createPolicyWriteAuditor({
  dbAdapter,
  realmFor,
  virtualNetwork,
}: {
  dbAdapter: DBAdapter;
  realmFor: (url: URL) => Promise<ServedRealm | undefined>;
  virtualNetwork: VirtualNetwork;
}): PolicyWriteAuditor {
  return {
    audit: (request) =>
      auditPolicyWrite(request, { dbAdapter, realmFor, virtualNetwork }),
    notify: (audit, savedBy) => recordPolicyNotices(dbAdapter, audit, savedBy),
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
  }: {
    dbAdapter: DBAdapter;
    realmFor: (url: URL) => Promise<ServedRealm | undefined>;
    virtualNetwork: VirtualNetwork;
  },
): Promise<PolicyShareAudit | undefined> {
  let written = new Map<string, LocalPath>();
  for (let path of request.paths) {
    if (path.endsWith('.json')) {
      written.set(cardIdOf(request.realmURL, path), path);
    }
  }
  if (written.size === 0) {
    return undefined;
  }
  let realmsWithShares = (
    (await query(dbAdapter, [
      `SELECT DISTINCT realm_url FROM key_shares WHERE key_id IS NOT NULL`,
    ])) as { realm_url: string }[]
  ).map((row) => row.realm_url);
  if (realmsWithShares.length === 0) {
    return undefined;
  }

  // The attributes a written policy card will hold, or undefined where its
  // bytes aren't a card document.
  let attributesOf = async (path: LocalPath) => {
    try {
      let doc = JSON.parse(await request.contentOf(path));
      let attributes = doc?.data?.attributes;
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

  let targets: AuditTarget[] = [];
  for (let realmURL of realmsWithShares) {
    let served = await realmFor(new URL(realmURL));
    if (!served || served.url !== realmURL) {
      continue;
    }
    let realm: Realm | undefined;
    try {
      realm = await served.mount();
    } catch (err: unknown) {
      log.warn(
        `could not mount ${realmURL} to audit a policy change against its shares: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!realm) {
      continue;
    }
    let current = (await realm.getRealmPolicy())?.card;
    let next = current;
    if (realmURL === request.realmURL && request.paths.includes('realm.json')) {
      let config: unknown;
      try {
        config = JSON.parse(await request.contentOf('realm.json'));
      } catch {
        config = undefined;
      }
      next = realmPolicyCardNamed(
        (config as { data?: { attributes?: { policy?: unknown } } } | undefined)
          ?.data?.attributes?.policy,
        virtualNetwork,
      );
    }
    if (next !== current || (next && written.has(stripJSON(next)))) {
      targets.push({ realm, next: await nextPolicy(next) });
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
      a.label.localeCompare(b.label) ||
      a.share.localeCompare(b.share),
  );
  let policy = targets.find((target) => target.next)?.next?.card ?? null;
  return {
    policy,
    entries,
    confirmation: createHash('sha256')
      .update(JSON.stringify({ policy, entries }))
      .digest('hex'),
  };
}

// The shares in the target's realm that the policy it would be governed by
// opens to visitors while the one in force doesn't.
async function openedShares(
  dbAdapter: DBAdapter,
  { realm, next }: AuditTarget,
): Promise<PolicyShareAuditEntry[]> {
  let rows = (await query(dbAdapter, [
    `SELECT DISTINCT b.share_id, b.definition_url, b.export_name, b.operation_name,
            s.label, s.owner, k.anonymous
       FROM key_bindings b
       JOIN key_shares s ON s.id = b.share_id
       JOIN user_keys k ON k.id = s.key_id
       LEFT JOIN oauth_clients c ON c.key_id = k.id
      WHERE b.realm_url = `,
    param(realm.url),
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

async function recordPolicyNotices(
  dbAdapter: DBAdapter,
  audit: PolicyShareAudit,
  savedBy: string | null,
): Promise<void> {
  for (let entry of audit.entries) {
    await query(dbAdapter, [
      `INSERT INTO key_policy_notices (owner, share_id, key_id, realm_url, label, policy_card, saved_by, reason, operations)
       SELECT s.owner, s.id, s.key_id, s.realm_url, s.label, `,
      param(audit.policy),
      `, `,
      param(savedBy),
      `, `,
      param(entry.keyAllowsAnonymous ? 'visitors-use' : 'visitors-wanted'),
      `, `,
      param(JSON.stringify(entry.operations)),
      `::jsonb FROM key_shares s WHERE s.id = `,
      param(entry.share),
    ]);
  }
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
  createdAt: string;
}

// The user's notices as a key's owner, newest first, at most 100.
export async function listOwnPolicyNotices(
  dbAdapter: DBAdapter,
  owner: string,
): Promise<KeyPolicyNotice[]> {
  let rows = (await query(dbAdapter, [
    `SELECT id, share_id, key_id, realm_url, label, policy_card, saved_by, reason, operations, created_at
       FROM key_policy_notices WHERE owner = `,
    param(owner),
    ` ORDER BY created_at DESC, id DESC LIMIT 100`,
  ])) as Record<string, any>[];
  return rows.map((row) => ({
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
    createdAt: new Date(row.created_at).toISOString(),
  }));
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
