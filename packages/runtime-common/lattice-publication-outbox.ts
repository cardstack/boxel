import { v4 as uuidv4 } from '@lukeed/uuid';
import { param, type Querier } from './expression.ts';
import type { LatticeRenderAuthority } from './lattice-render-authority.ts';

export const LATTICE_PUBLICATION_CHANNEL = 'lattice_publications';

export interface LatticePublicationEvent {
  eventName: 'prerender_html' | 'index';
  indexType?: 'incremental';
  realmURL: string;
  invalidations: string[];
  generation: number;
  publicationId: string;
}

// This must run on the artifact publisher's pinned transaction. A notice holds
// identity/version metadata only; receiving it is a hint to read current data,
// never permission to install the old publication as the current value.
export async function recordLatticePublication(
  tx: Querier,
  authority: Pick<
    LatticeRenderAuthority,
    'realmURL' | 'ownerURL' | 'realmGeneration'
  >,
  eventName: LatticePublicationEvent['eventName'] = 'prerender_html',
): Promise<string> {
  return recordLatticePublications(
    tx,
    {
      realmURL: authority.realmURL,
      ownerURLs: [authority.ownerURL],
      realmGeneration: authority.realmGeneration,
    },
    eventName,
  );
}

// One commit produces one durable notice, regardless of its number of owners.
// owner_url remains a representative identity for diagnostics; payload contains
// the complete audience-visible set.
export async function recordLatticePublications(
  tx: Querier,
  authority: { realmURL: string; ownerURLs: string[]; realmGeneration: number },
  eventName: LatticePublicationEvent['eventName'] = 'index',
): Promise<string> {
  if (!authority.ownerURLs.length) throw new Error('Empty Lattice publication');
  let id = uuidv4();
  let event: LatticePublicationEvent = {
    eventName,
    ...(eventName === 'index' ? { indexType: 'incremental' as const } : {}),
    realmURL: authority.realmURL,
    invalidations: [...new Set(authority.ownerURLs)],
    generation: authority.realmGeneration,
    publicationId: id,
  };
  await tx([
    'INSERT INTO lattice_publication_events (id, realm_url, owner_url, payload) VALUES (',
    param(id),
    ',',
    param(authority.realmURL),
    ',',
    param(authority.ownerURLs[0]),
    ',',
    param(JSON.stringify(event)),
    ')',
  ]);
  // Match the existing realm-event audience. Demand-based subscriptions can
  // narrow this later; an absent or future session catches up through reads.
  await tx([
    `INSERT INTO lattice_publication_deliveries (publication_id, user_id, room_id)
     SELECT`,
    param(id),
    `, u.matrix_user_id, u.session_room_id FROM users u
     WHERE u.session_room_id IS NOT NULL AND (
       EXISTS (SELECT 1 FROM realm_user_permissions p WHERE p.realm_url =`,
    param(authority.realmURL),
    `AND p.username = u.matrix_user_id AND (p.read = TRUE OR p.write = TRUE))
       OR EXISTS (SELECT 1 FROM realm_user_permissions p WHERE p.realm_url =`,
    param(authority.realmURL),
    `AND p.username = '*' AND p.read = TRUE))`,
  ]);
  await tx([`NOTIFY ${LATTICE_PUBLICATION_CHANNEL}`]);
  if (eventName === 'index') {
    // Cache eviction shares the publication commit too. A worker can exit
    // before its task-level best-effort notification runs.
    await tx([
      "SELECT pg_notify('realm_index_updated',",
      param(authority.realmURL),
      ')',
    ]);
  }
  return id;
}
