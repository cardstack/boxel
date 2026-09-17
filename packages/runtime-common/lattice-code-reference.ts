import {
  dbExpression,
  param,
  type Expression,
  type Querier,
} from './expression.ts';

// A compact reference to file-owned code facts. Only an admitted native
// producer may bind it to an indexed output; authored card JSON cannot do so.
export interface LatticeCodeReference {
  version: 1;
  realmURL: string;
  fileURL: string;
  exportName: string;
  actorUserId: string;
  runtimeRevision: string;
  policyRevision: string;
  fingerprint: string;
}

export function latticeOwnerDefinitionCurrent(
  realm: Expression,
  owner: Expression,
  epoch: Expression,
  revision: Expression,
): Expression {
  return [
    dbExpression({
      pg: [
        'lattice_owner_code_current(',
        ...realm,
        ',',
        ...owner,
        ',',
        ...epoch,
        ')',
      ],
      sqlite: ['(', ...revision, '=', ...epoch, ')'],
    }),
  ];
}

// Bulk equivalent of lattice_owner_code_current. A realm may have thousands
// of owners sharing one code receipt: validate each distinct proof once in
// this statement, while still checking every owner's binding generation.
// MATERIALIZED is important: inlining the function repeats the scope walk.
export function latticeOwnerCodeStatuses(
  realm: Expression,
  epoch: Expression,
): Expression {
  return [
    `WITH bindings AS MATERIALIZED (
      SELECT o.owner_url,o.code_bound,o.definition_revision,o.published_generation,
        b.generation AS binding_generation,b.reference
      FROM lattice_owners o LEFT JOIN lattice_owner_code b
        ON b.realm_url=o.realm_url AND b.owner_url=o.owner_url
      WHERE o.realm_url=`,
    ...realm,
    `), proofs AS MATERIALIZED (
      SELECT reference,lattice_code_reference_current(reference) AS current
      FROM (SELECT DISTINCT reference FROM bindings
        WHERE code_bound AND binding_generation=published_generation) refs
    ) SELECT b.owner_url,COALESCE(CASE WHEN NOT b.code_bound
        THEN b.definition_revision=`,
    ...epoch,
    ` ELSE b.binding_generation=b.published_generation AND p.current END,FALSE) AS current
      FROM bindings b LEFT JOIN proofs p ON p.reference=b.reference`,
  ];
}

// The enclosing publication already locks owner rows. Lock shared code inputs
// once per distinct receipt too, so a code edit cannot race a feeder read's
// final check even when the feeder's own index row has not changed yet.
export async function assertLatticeOwnerCodes(
  tx: Querier,
  realmURL: string,
  owners: string[],
) {
  if (!owners.length) return;
  const rows = await tx([
    'SELECT reference FROM lattice_owner_code WHERE realm_url=',
    param(realmURL),
    'AND owner_url IN (SELECT jsonb_array_elements_text(',
    param(JSON.stringify(owners)),
    '::jsonb)) ORDER BY owner_url FOR SHARE',
  ]);
  const references = new Set(rows.map((row) => JSON.stringify(row.reference)));
  for (const reference of references) {
    const [row] = await tx([
      'SELECT lattice_lock_code_reference(',
      param(reference),
      '::jsonb) AS current',
    ]);
    if (!row?.current)
      throw new Error('Lattice feeder code changed before publication');
  }
}
