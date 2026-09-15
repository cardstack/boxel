import { param, textArrayParam, type Querier } from './expression.ts';

// PostgreSQL storage detail, not card identity or a portable validity rule.
// xmin detects other writers; ctid also detects a second update in the same
// transaction. Filenode fences storage rewrites; cmin fences repeated TRUNCATE
// in the creating transaction, which PostgreSQL can perform in place.
// Expire the receipt before 32-bit xmin can wrap. A table rewrite
// or rollback (which can change a tuple's command-ID encoding) may cause a
// conservative miss, as can a missing legacy receipt. Never serve stale reuse.
// The fixed aliases belong to the two index serving queries (i and la).
export const latticeInputArtifactReceipt = `
  la.row_xmin = i.xmin::text AND la.row_ctid = i.ctid::text
  AND la.row_cmin = i.cmin::text
  AND la.row_filenode = pg_relation_filenode(i.tableoid)::text
  AND la.captured_xid::numeric >=
    pg_snapshot_xmax(pg_current_snapshot())::text::numeric - 1000000000
  AND la.captured_xid::numeric <
    pg_snapshot_xmax(pg_current_snapshot())::text::numeric`;

// Called only after promotion, inside an enabled writer's transaction. Restrict
// capture to rows created by that transaction: recapturing an ancient xmin
// would defeat the wraparound bound. Unsupported/subtransaction versions miss
// safely. Neither bodies nor digests are transferred to JavaScript here.
export async function captureLatticeInputArtifacts(
  tx: Querier,
  realmURL: string,
  urls: string[],
): Promise<void> {
  for (let offset = 0; offset < urls.length; offset += 1000) {
    let batch = urls.slice(offset, offset + 1000);
    await tx([
      'DELETE FROM lattice_input_artifacts WHERE realm_url =',
      param(realmURL),
      'AND url = ANY(',
      textArrayParam(batch),
      ')',
    ]);
    await tx([
      `INSERT INTO lattice_input_artifacts
        (realm_url,url,type,digest,resource,row_xmin,row_cmin,row_ctid,row_filenode,captured_xid)
       SELECT i.realm_url,i.url,i.type,
         encode(sha256(convert_to(i.pristine_doc::text,'UTF8')),'hex'),
         jsonb_build_object('id',COALESCE(i.pristine_doc->'id',to_jsonb(i.file_alias)),
           'type','card','meta',i.pristine_doc->'meta'),
         i.xmin::text,i.cmin::text,i.ctid::text,pg_relation_filenode(i.tableoid)::text,
         pg_current_xact_id()::text
       FROM boxel_index i WHERE i.realm_url =`,
      param(realmURL),
      'AND i.url = ANY(',
      textArrayParam(batch),
      `) AND i.type = 'instance' AND i.is_deleted IS NOT TRUE
         AND i.has_error IS NOT TRUE AND i.pristine_doc IS NOT NULL
         AND i.xmin::text::numeric =
           mod(pg_current_xact_id()::text::numeric,4294967296)`,
    ]);
  }
}
