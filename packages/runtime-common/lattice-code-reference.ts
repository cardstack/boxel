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
