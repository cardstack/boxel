import { createHash } from 'node:crypto';
import stringify from 'safe-stable-stringify';
import type { DBAdapter } from '@cardstack/runtime-common';
import {
  param,
  query,
  type Querier,
} from '@cardstack/runtime-common/expression';
import { LATTICE_GTS_LINKER_REVISION } from '@cardstack/runtime-common/lattice-gts-link';
import type { LatticeNativeRealmPolicy } from './lattice-postgres-admission.ts';
import type { LatticeCodeReference } from '@cardstack/runtime-common/lattice-code-reference';

export type LatticeCodeAdmission = ((tx: Querier) => Promise<void>) & {
  reference: LatticeCodeReference;
  coversReview: boolean;
};

export function latticeCodePolicyRevision(policy: LatticeNativeRealmPolicy) {
  return createHash('sha256').update(stringify(policy)!).digest('hex');
}

// Explicit worker configuration enables file-owned linking for BOTH producers.
// Reinstalling the same review is a no-op; a changed runtime/review invalidates
// the old receipts before a new worker can use them. Old workers are fenced by
// the same configuration row at publication.
export async function registerLatticeCodePolicies(
  db: DBAdapter,
  policies: LatticeNativeRealmPolicy[],
) {
  if (db.kind !== 'pg') throw new Error('Code admission requires PostgreSQL');
  for (const policy of policies) {
    await db.withWriteLock(
      `lattice-code-config:${policy.realmURL}`,
      async (tx) => {
        if (!tx) throw new Error('Code configuration requires a transaction');
        const changed = await tx([
          `INSERT INTO lattice_code_realms (realm_url,actor_user_id,runtime_revision,policy_revision) VALUES (`,
          param(policy.realmURL),
          ',',
          param(policy.actorUserId),
          ',',
          param(policy.runtimeRevision),
          ',',
          param(latticeCodePolicyRevision(policy)),
          `) ON CONFLICT (realm_url) DO UPDATE SET actor_user_id=EXCLUDED.actor_user_id,
          runtime_revision=EXCLUDED.runtime_revision,policy_revision=EXCLUDED.policy_revision
         WHERE (lattice_code_realms.actor_user_id,lattice_code_realms.runtime_revision,lattice_code_realms.policy_revision)
           IS DISTINCT FROM (EXCLUDED.actor_user_id,EXCLUDED.runtime_revision,EXCLUDED.policy_revision)
         RETURNING realm_url`,
        ]);
        if (!changed.length) return;
        const affected = await tx([
          `UPDATE lattice_code_artifacts SET dirty=TRUE,work_version=work_version+1 WHERE realm_url=`,
          param(policy.realmURL),
          'RETURNING realm_username',
        ]);
        for (const username of new Set(
          affected.map((row) => String(row.realm_username)),
        )) {
          await tx([
            'SELECT lattice_enqueue_code_link(',
            param(policy.realmURL),
            ',',
            param(username),
            ')',
          ]);
        }
      },
    );
  }
}

export async function assertLatticeCodePolicy(
  tx: Querier,
  policy: LatticeNativeRealmPolicy,
) {
  const [row] = await tx([
    `SELECT 1 FROM lattice_code_realms WHERE realm_url=`,
    param(policy.realmURL),
    'AND actor_user_id=',
    param(policy.actorUserId),
    'AND runtime_revision=',
    param(policy.runtimeRevision),
    'AND policy_revision=',
    param(latticeCodePolicyRevision(policy)),
    'FOR SHARE',
  ]);
  if (!row) throw new Error('Lattice code processor policy changed');
}

// Additional admission evidence, never authority to run arbitrary code. The
// existing semantic review, source/module receipts and input fences still run.
// Read one export's scalar classification, not every definition in the file.
export async function readLatticeCodeAdmission(
  db: DBAdapter,
  policy: LatticeNativeRealmPolicy,
  fileURL: string,
  exportName: string,
): Promise<LatticeCodeAdmission | undefined> {
  const identity = [
    'c.realm_url=',
    param(policy.realmURL),
    'AND c.file_url=',
    param(fileURL),
    'AND c.actor_user_id=',
    param(policy.actorUserId),
    'AND c.runtime_revision=',
    param(policy.runtimeRevision),
    'AND c.dirty=FALSE',
    "AND c.receipt->>'version'='1' AND c.receipt->>'fileId'=c.file_url",
    "AND c.receipt->>'state'='analyzed'",
  ];
  const [row] = await query(
    db,
    [
      `SELECT c.work_version,c.receipt->'exports'->`,
      param(exportName),
      `->>'fingerprint' AS fingerprint,
      c.scope FROM lattice_code_artifacts c JOIN lattice_code_realms r ON r.realm_url=c.realm_url WHERE`,
      ...identity,
      'AND r.actor_user_id=c.actor_user_id AND r.runtime_revision=c.runtime_revision AND r.policy_revision=',
      param(latticeCodePolicyRevision(policy)),
      "AND c.receipt->'exports'->",
      param(exportName),
      "->>'state'='requires-admission'",
      "AND c.receipt->'exports'->",
      param(exportName),
      "->>'linkerRevision'=",
      param(LATTICE_GTS_LINKER_REVISION),
      "AND c.receipt->'exports'->",
      param(exportName),
      "->>'runtimeRevision'=c.runtime_revision",
      "AND c.receipt->'exports'->",
      param(exportName),
      "->'root'->>'fileId'=c.file_url",
      "AND c.receipt->'exports'->",
      param(exportName),
      "->'root'->>'name'=",
      param(exportName),
      "AND jsonb_typeof(c.scope)='array' AND octet_length(c.scope::text)<=131072",
    ],
    { scope: 'JSON' },
  );
  if (
    !row ||
    typeof row.fingerprint !== 'string' ||
    !row.fingerprint ||
    !Array.isArray(row.scope) ||
    !row.scope.length ||
    row.scope.length > 128
  )
    return undefined;
  // xmin protected the linker's attempt, but is not a durable content revision:
  // an identical file write or reindex can change xmin without changing code.
  const scope = row.scope as Array<{
    realm: string;
    path: string;
    username: string;
    hash: string;
    size: number;
  }>;
  if (
    scope.some(
      (s) =>
        !s.realm ||
        !s.path ||
        !s.hash ||
        !Number.isSafeInteger(s.size) ||
        s.size < 0 ||
        (s.username !== '*' && s.username !== policy.actorUserId),
    )
  )
    return undefined;
  const values = JSON.stringify(
    scope.map(({ realm, path, username, hash, size }) => ({
      realm,
      path,
      username,
      hash,
      size,
    })),
  );
  const checkScope = async (execute: Querier, lock: boolean) => {
    const matched = await execute([
      `SELECT f.realm_url,f.file_path FROM jsonb_to_recordset(`,
      param(values),
      `::jsonb) AS e(realm text,path text,username text,hash text,size bigint)
       JOIN realm_user_permissions p ON p.realm_url=e.realm AND p.username=e.username AND p.read=TRUE
       JOIN realm_metadata r ON r.url=e.realm AND r.archived_at IS NULL
       JOIN realm_file_meta f ON f.realm_url=e.realm AND f.file_path=e.path AND f.content_hash=e.hash AND f.content_size=e.size
       ORDER BY f.realm_url,f.file_path`,
      ...(lock ? ['FOR SHARE OF p,r,f'] : []),
    ]);
    return matched.length === scope.length;
  };
  if (!(await checkScope((expression) => query(db, expression), false)))
    return undefined;
  const reference: LatticeCodeReference = {
    version: 1,
    realmURL: policy.realmURL,
    fileURL,
    exportName,
    actorUserId: policy.actorUserId,
    runtimeRevision: policy.runtimeRevision,
    policyRevision: latticeCodePolicyRevision(policy),
    fingerprint: row.fingerprint,
  };
  const check = async (tx: Querier) => {
    await assertLatticeCodePolicy(tx, policy);
    if (!(await checkScope(tx, true)))
      throw new Error('Lattice code inputs or authority changed');
    const [current] = await tx([
      'SELECT 1 FROM lattice_code_artifacts c WHERE',
      ...identity,
      'AND c.work_version=',
      param(row.work_version),
      "AND c.receipt->'exports'->",
      param(exportName),
      "->>'fingerprint'=",
      param(row.fingerprint),
      'FOR SHARE',
    ]);
    if (!current)
      throw new Error('Lattice code classification changed before publication');
    const [valid] = await tx([
      'SELECT lattice_lock_code_reference(',
      param(JSON.stringify(reference)),
      '::jsonb) AS current',
    ]);
    if (!valid?.current)
      throw new Error('Lattice code reference is no longer current');
  };
  // The native review can include serializers/query metadata outside the
  // authored import closure. Do not use the narrower receipt for persistent
  // freshness unless it covers every reviewed implementation source and grant.
  // Native execution still has the existing complete review/publication fence.
  const coversReview = policy.modules.every((module) =>
    scope.some(
      (source) =>
        source.realm === module.realmURL &&
        source.path === module.sourcePath &&
        source.hash === module.sourceMD5 &&
        source.username ===
          (module.cacheScope === 'public' ? '*' : module.authUserId),
    ),
  );
  return Object.assign(check, { reference, coversReview });
}
