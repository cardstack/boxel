import { RealmPaths } from '../paths.ts';
import {
  param,
  textArrayParam,
  type Expression,
  type Querier,
} from '../expression.ts';

// Enabled file writers invalidate code in the same SQL statement as metadata.
// Ordinary writes execute their original SQL, with no database trigger.
export function invalidateLatticeFileChanges(change: Expression): Expression {
  return [
    'WITH changed AS (',
    ...change,
    'RETURNING realm_url, file_path)',
    'SELECT lattice_invalidate_code_keys(array_agg(lattice_code_file_key(realm_url, file_path)))',
    'FROM changed HAVING count(*) > 0',
  ];
}

export const LATTICE_CODE_JOB_TYPE = 'lattice-link-code';
export type LatticeCodeLinker = (args: {
  realmURL: string;
  realmUsername: string;
}) => Promise<{ published: number; superseded: number }>;

// Source publication captures identities only. Linking runs after this
// transaction in a separate worker lane, never inside the index swap.
export async function captureLatticeCodeChanges(
  tx: Querier,
  realmURL: string,
  generation: number,
  realmUsername: string,
) {
  const rows = await tx([
    `SELECT w.url,
      EXISTS (SELECT 1 FROM lattice_code_realms c WHERE c.realm_url=w.realm_url) AS enabled,
      EXISTS (SELECT 1 FROM lattice_code_artifacts c WHERE c.realm_url=w.realm_url AND c.file_url=w.url) AS registered
     FROM boxel_index_working w LEFT JOIN boxel_index i
       ON i.realm_url=w.realm_url AND i.url=w.url AND i.type=w.type
     WHERE w.realm_url=`,
    param(realmURL),
    'AND w.generation=',
    param(generation),
    `AND w.type='file' AND (
      w.pristine_doc->'attributes'->'latticeAnalysis' IS NOT NULL
      OR i.pristine_doc->'attributes'->'latticeAnalysis' IS NOT NULL
      OR EXISTS (SELECT 1 FROM lattice_code_artifacts c WHERE c.realm_url=w.realm_url AND c.file_url=w.url)
    ) AND (
      w.pristine_doc->'attributes'->'latticeAnalysis' IS DISTINCT FROM i.pristine_doc->'attributes'->'latticeAnalysis'
      OR w.is_deleted IS DISTINCT FROM i.is_deleted OR w.has_error IS DISTINCT FROM i.has_error
      OR (w.pristine_doc->'attributes'->'latticeAnalysis' IS NOT NULL
        AND EXISTS (SELECT 1 FROM lattice_code_realms c WHERE c.realm_url=w.realm_url) AND NOT EXISTS (
        SELECT 1 FROM lattice_code_artifacts c WHERE c.realm_url=w.realm_url AND c.file_url=w.url))
    )`,
  ]);
  const keys: string[] = [];
  const paths = new RealmPaths(new URL(realmURL));
  for (const row of rows) {
    const [identity] = await tx([
      'SELECT lattice_code_file_key(',
      param(realmURL),
      ',',
      param(paths.local(new URL(String(row.url)))),
      ') AS key',
    ]);
    keys.push(String(identity.key));
    if (!row.enabled && !row.registered) continue;
    await tx([
      `INSERT INTO lattice_code_artifacts (realm_url,file_url,realm_username,dependency_keys)
       VALUES (`,
      param(realmURL),
      ',',
      param(row.url),
      ',',
      param(realmUsername),
      ',',
      param(JSON.stringify([identity.key])),
      `::jsonb) ON CONFLICT (realm_url,file_url) DO UPDATE SET realm_username=EXCLUDED.realm_username`,
    ]);
  }
  if (keys.length)
    await tx([
      'SELECT lattice_invalidate_code_keys(',
      textArrayParam(keys),
      '::text[])',
    ]);
}

// A hint for queue admission, not a publication fence. Do not consume worker
// capacity while source jobs still have to publish the analysis being linked.
export const latticeCodeReadySQL = `(
  j.job_type <> 'lattice-link-code' OR NOT EXISTS (
    SELECT 1 FROM jobs s WHERE s.concurrency_group='indexing:' || (j.args->>'realmURL')
      AND s.job_type <> 'lattice-materialize' AND s.status='unfulfilled'
  )
)`;
