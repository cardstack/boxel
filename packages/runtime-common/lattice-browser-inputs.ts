import { CardError } from './error.ts';
import { param, type Querier } from './expression.ts';
import type { LatticeInputSnapshot } from './lattice-materialization.ts';
import {
  LATTICE_RETAINED_LINK_LIMIT,
  type LatticeIndexedSnapshotInput,
} from './lattice-retained-snapshots.ts';

export type LatticeInputRowReceipt = Pick<
  LatticeIndexedSnapshotInput,
  'rowVersion' | 'indexGeneration' | 'definitionSeal'
>;
export interface LatticeInputAuthority {
  realmURL: string;
  generation: number;
  actor: string;
  loaderEpoch: string;
  permissionVersion: string;
  metadataVersion: string;
}
export interface LatticeLoadedLink {
  ownerURL: string;
  fieldPath: string;
  sourceURL: string;
}
export interface LatticeBrowserInputCapture {
  version: 1;
  inputs: LatticeIndexedSnapshotInput[];
  authority?: LatticeInputAuthority;
}

// Small read receipt; publication locks and compares it again. This does not
// grant access: the realm endpoint must already have authorized the request.
export async function readLatticeInputAuthority(
  tx: Querier,
  realmURL: string,
  actor: string,
  generation: number,
  lock = false,
): Promise<LatticeInputAuthority> {
  const [row] = await tx([
    `SELECT g.current_generation,g.loader_epoch,p.xmin::text AS permission_version,
       r.xmin::text AS metadata_version FROM realm_generations g
     JOIN realm_user_permissions p ON p.realm_url=g.realm_url
     JOIN realm_metadata r ON r.url=g.realm_url WHERE g.realm_url=`,
    param(realmURL),
    'AND p.username=',
    param(actor),
    'AND p.read=TRUE AND r.archived_at IS NULL',
    ...(lock ? ['FOR SHARE OF g,p,r'] : []),
  ]);
  if (
    !row ||
    Number(row.current_generation) !== generation ||
    !row.loader_epoch
  )
    throw new CardError('Lattice input authority is no longer current', {
      status: 409,
    });
  return {
    realmURL,
    actor,
    generation,
    loaderEpoch: String(row.loader_epoch),
    permissionVersion: String(row.permission_version),
    metadataVersion: String(row.metadata_version),
  };
}

export async function assertLatticeInputAuthority(
  tx: Querier,
  expected: LatticeInputAuthority,
) {
  const actual = await readLatticeInputAuthority(
    tx,
    expected.realmURL,
    expected.actor,
    expected.generation,
    true,
  );
  if (
    actual.loaderEpoch !== expected.loaderEpoch ||
    actual.permissionVersion !== expected.permissionVersion ||
    actual.metadataVersion !== expected.metadataVersion
  )
    throw new Error('Lattice input authority changed before publication');
}

const scopes = new WeakMap<
  LatticeInputSnapshot,
  {
    authority: LatticeInputAuthority;
    rows: Map<string, LatticeInputRowReceipt>;
  }
>();

// Called only for a successfully decoded authenticated input reply. Never
// inspect authored card metadata for receipts. A scope is one prerender visit.
export function recordLatticeBrowserInput(
  snapshot: LatticeInputSnapshot,
  url: string,
  receipt: LatticeInputRowReceipt,
  authority: LatticeInputAuthority,
) {
  if (!snapshot.retainLinks) return;
  if (
    !authority ||
    authority.realmURL !== snapshot.realmURL ||
    authority.generation !== snapshot.generation ||
    authority.loaderEpoch !== snapshot.loaderEpoch ||
    typeof authority.actor !== 'string' ||
    !/^\d+$/.test(authority.permissionVersion) ||
    !/^\d+$/.test(authority.metadataVersion) ||
    !url.startsWith(snapshot.realmURL) ||
    !receipt ||
    !/^\d+:\d+:\(\d+,\d+\)$/.test(receipt.rowVersion) ||
    !Number.isSafeInteger(receipt.indexGeneration) ||
    receipt.indexGeneration < 0 ||
    receipt.indexGeneration > snapshot.generation ||
    typeof receipt.definitionSeal !== 'string' ||
    !receipt.definitionSeal ||
    receipt.definitionSeal.length > 1024
  )
    throw new Error('Invalid Lattice retained input receipt');
  let scope = scopes.get(snapshot);
  if (!scope)
    scopes.set(
      snapshot,
      (scope = { authority: structuredClone(authority), rows: new Map() }),
    );
  if (JSON.stringify(scope.authority) !== JSON.stringify(authority))
    throw new Error('Lattice input authority changed within the render');
  const previous = scope.rows.get(url);
  if (previous && JSON.stringify(previous) !== JSON.stringify(receipt))
    throw new Error('Lattice input row changed within the render');
  if (!scope.rows.has(url) && scope.rows.size >= LATTICE_RETAINED_LINK_LIMIT)
    throw new Error('Lattice retained input receipt bound exceeded');
  scope.rows.set(url, structuredClone(receipt));
}

export function latticeBrowserInputCapture(
  snapshot: LatticeInputSnapshot,
  ownerURL: string,
  edges: LatticeLoadedLink[],
): LatticeBrowserInputCapture {
  if (!snapshot.retainLinks)
    throw new Error('Lattice retention was not requested');
  if (edges.length > LATTICE_RETAINED_LINK_LIMIT)
    throw new Error('Lattice retained link bound exceeded');
  const scope = scopes.get(snapshot);
  const inputs: LatticeIndexedSnapshotInput[] = [];
  for (const edge of edges) {
    // Foreign artifacts require the remote-input adapter, never a local DB join.
    if (
      !edge.sourceURL.startsWith(snapshot.realmURL) ||
      !edge.ownerURL.startsWith(snapshot.realmURL)
    )
      continue;
    const source = scope?.rows.get(edge.sourceURL);
    const owner =
      edge.ownerURL === ownerURL ? undefined : scope?.rows.get(edge.ownerURL);
    if (!source || (edge.ownerURL !== ownerURL && !owner))
      throw new Error(
        `Loaded link has no validated Lattice input receipt: ${edge.ownerURL} ${edge.fieldPath} -> ${edge.sourceURL}`,
      );
    inputs.push({
      ...source,
      fieldPath: edge.fieldPath,
      sourceURL: edge.sourceURL,
      validatedThrough: snapshot.generation,
      ...(owner
        ? {
            owner: {
              url: edge.ownerURL,
              rowVersion: owner.rowVersion,
              indexGeneration: owner.indexGeneration,
            },
          }
        : {}),
    });
  }
  return {
    version: 1,
    inputs,
    ...(inputs.length ? { authority: structuredClone(scope!.authority) } : {}),
  };
}
