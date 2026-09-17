import type { Query } from './query.ts';
import type { DBAdapter } from './db.ts';
import { query, param, type Querier } from './expression.ts';
import { CardError } from './error.ts';
import type { LooseCardResource } from './resource-types.ts';
import type { SingleCardDocument } from './document-types.ts';
import type { SerializedError } from './error.ts';
import { indexingConcurrencyGroup } from './jobs/indexing.ts';
import { latticeOwnerDefinitionCurrent } from './lattice-code-reference.ts';

// Versioned provenance for the ordinary attributes/relationship payload. The
// writer supplies revisions; realm source files must never supply this stamp.
export interface PublicationReceipt {
  version: 1;
  state: 'pending' | 'ready';
  computedFields: string[];
  queryFields: string[];
  watches: Array<{ fieldPath: string; query: Query }>;
  validatedThrough: number;
  outputRevision?: number;
  // The earliest `freshUntil` grain over the owner's computed fields (an ISO
  // instant): the owner need not be re-derived before it. Registered on the
  // owner row at a ready publication (`lattice_owners.settle_until`). Only a
  // producer that evaluates grains (the native worker) supplies it; the
  // browser, which recomputes live, does not.
  freshUntil?: string;
  // The earliest `staleAfter` bound over the owner's computed fields, as a
  // window in seconds from the clock the programs read: once dirty, the owner
  // must be re-derived within it even while its inputs keep changing.
  // Registered as `lattice_owners.stale_within`; the registry arms
  // `stale_after` when the owner becomes dirty (and again at a stale
  // publication, which leaves it dirty). Native producer only.
  staleWithin?: number;
  // The publication came from a stale attempt: one that ran past its
  // deadline, over feeders' last published bodies and ahead of pending source
  // work. It is a valid value at its input generation, but the owner keeps
  // its obligation so the ordinary path re-derives it when the stream quiets.
  stale?: true;
  // Per watch field path, the fields of a matching input card the owner's
  // programs read (read-path change detection). A watch without an entry
  // invalidates on any change of a matching row; with one, only when a row
  // enters or leaves the match or one of these fields changes. Kept beside
  // `watches`, not on them, so the prepared native queries still equal the
  // manifest. Only a producer that records reads (the native worker) sets it.
  readPaths?: Record<string, string[]>;
  // Inventory for a complete applied body, never authorization or freshness.
  have?: string;
  definitionRevision?: string;
  // Read-time availability, independent of freshness. Only a completed
  // indexed publication can set this; discovery's empty output cannot.
  hasPublishedSnapshot?: boolean;
}

export interface LatticeInputSnapshot {
  realmURL: string;
  generation: number;
  // Explicitly installed by an enabled writer, not inferred from card metadata.
  retainLinks?: true;
  loaderEpoch?: string;
  // The visit is a stale attempt (see PublicationReceipt.stale): dirty feeders
  // are read at their last published body and source work does not supersede.
  stale?: true;
}

export const LATTICE_INPUT_GENERATION_HEADER =
  'x-boxel-lattice-input-generation';
export const MAX_LATTICE_INPUT_BATCH_SIZE = 64;
export type LatticeInputResult = {
  url: string;
  receipt?: import('./lattice-browser-inputs.ts').LatticeInputRowReceipt;
} & (
  | {
      document: SingleCardDocument;
      headers: Record<string, string>;
      token?: string;
    }
  | { reuse: true; token: string }
  | { error: SerializedError }
);

export function latticeInputURLs(payload: unknown, realmURL: string): URL[] {
  let urls = (payload as { urls?: unknown } | null)?.urls;
  if (
    !Array.isArray(urls) ||
    urls.length === 0 ||
    urls.length > MAX_LATTICE_INPUT_BATCH_SIZE
  ) {
    throw new CardError('Lattice input reads require 1–64 card URLs', {
      status: 400,
    });
  }
  let paths = new Set<string>();
  return urls.flatMap((value) => {
    if (typeof value !== 'string' || value.length > 4096) {
      throw new CardError('Invalid Lattice input card URL', { status: 400 });
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new CardError('Invalid Lattice input card URL', { status: 400 });
    }
    if (
      !url.href.startsWith(realmURL) ||
      url.search ||
      url.hash ||
      url.pathname.endsWith('/') ||
      url.pathname.slice(new URL(realmURL).pathname.length).startsWith('_')
    ) {
      throw new CardError('Lattice input cards must be in the owner realm', {
        status: 400,
      });
    }
    url.pathname = url.pathname.replace(/\.json$/, '');
    if (paths.has(url.href)) return [];
    paths.add(url.href);
    return [url];
  });
}

// Only the small, request-specific envelope is serialized at read time.
// attributesJSON is valid JSON encoded by the publication transaction, never
// source text or a caller-supplied fragment. Materialized documents have no
// included graph; their relationships remain in the envelope.
export function latticeStoredDocumentBody(
  resource: LooseCardResource,
  attributesJSON: string,
): string {
  let envelope = JSON.stringify({ ...resource, attributes: undefined });
  return `{"data":${envelope.slice(0, -1)},"attributes":${attributesJSON}}}`;
}

export async function latticeHasOwner(
  db: DBAdapter,
  realmURL: string,
  ownerURL: string,
): Promise<boolean> {
  return Boolean(
    (
      await query(db, [
        'SELECT 1 FROM lattice_owners WHERE realm_url =',
        param(realmURL),
        'AND owner_url =',
        param(ownerURL),
        'AND retired = FALSE LIMIT 1',
      ])
    ).length,
  );
}

export async function latticeHasMaterializations(
  db: DBAdapter,
  realms: string[],
): Promise<boolean> {
  for (let realm of realms) {
    let rows = await query(db, [
      'SELECT 1 FROM lattice_owners WHERE realm_url =',
      param(realm),
      'AND retired = FALSE LIMIT 1',
    ]);
    if (rows.length) return true;
  }
  return false;
}

export function latticeRequestedGeneration(
  request: Request,
): number | undefined {
  let value = request.headers.get(LATTICE_INPUT_GENERATION_HEADER);
  if (value === null) return undefined;
  let generation = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(generation)) {
    throw new CardError('Lattice requires a nonnegative input generation', {
      status: 400,
    });
  }
  return generation;
}

export async function assertLatticeGeneration(
  db: DBAdapter,
  realmURL: string,
  expected: number,
  tx?: Querier,
): Promise<void> {
  let execute: Querier = tx ?? ((expression) => query(db, expression));
  let [row] = await execute([
    'SELECT current_generation FROM realm_generations WHERE realm_url =',
    param(realmURL),
  ]);
  if (Number(row?.current_generation ?? 0) !== expected) {
    throw new CardError(
      'Lattice input revision changed; recompute the complete owner',
      { status: 409 },
    );
  }
}

// A prerender visit sets and clears this explicitly. Ordinary readers and
// source edits never opt into the indexed-input protocol via this helper.
export function currentLatticeInputSnapshot():
  | LatticeInputSnapshot
  | undefined {
  let globals = globalThis as unknown as {
    __boxelRenderContext?: boolean;
    __latticeInputSnapshot?: LatticeInputSnapshot;
  };
  return globals.__boxelRenderContext === true
    ? globals.__latticeInputSnapshot
    : undefined;
}

export function latticeSnapshotFields(
  resource: LooseCardResource,
  opts?: { allowPending?: boolean },
) {
  let stamp = resource.meta.publication;
  if (!stamp) return undefined;
  if (
    stamp.version !== 1 ||
    (stamp.state !== 'ready' &&
      !(opts?.allowPending && stamp.state === 'pending')) ||
    !Number.isSafeInteger(stamp.outputRevision) ||
    !Number.isSafeInteger(stamp.validatedThrough) ||
    stamp.validatedThrough < 0 ||
    stamp.outputRevision! < 1 ||
    !stamp.definitionRevision ||
    !Array.isArray(stamp.computedFields) ||
    !Array.isArray(stamp.queryFields) ||
    (resource.meta.generation !== undefined &&
      resource.meta.generation !== stamp.outputRevision)
  ) {
    throw new CardError(
      'Lattice materialization is pending or has invalid provenance',
      { status: 409 },
    );
  }
  return {
    computedFields: stamp.computedFields,
    queryFields: stamp.queryFields,
    ...(stamp.state === 'pending'
      ? { scope: { active: true, pending: true } }
      : {}),
  };
}

export async function latticeReadState(
  db: DBAdapter,
  realmURL: string,
  ownerURL: string,
  stamp: PublicationReceipt,
  opts?: { latticeInput?: boolean },
): Promise<'ready' | 'pending'> {
  // This durable checkpoint closes the source-commit/secondary-claim gap.
  // It also gates revision-pinned feeder reads until exact matching catches up.
  if (
    (
      await query(db, [
        'SELECT 1 FROM lattice_pending_generations WHERE realm_url =',
        param(realmURL),
        'LIMIT 1',
      ])
    ).length
  )
    return 'pending';
  // Source endpoints durably enqueue before acknowledging. Across replicas,
  // an unprocessed write is visible here even before its indexed old/new
  // documents exist for precise reverse matching. A revision-pinned worker
  // must ignore its own queue job while consuming already-ready feeders.
  if (db.kind === 'pg' && !opts?.latticeInput) {
    let pending = await query(db, [
      "SELECT 1 FROM jobs WHERE status = 'unfulfilled' AND job_type <> 'lattice-materialize' AND concurrency_group =",
      param(indexingConcurrencyGroup(realmURL)),
      'LIMIT 1',
    ]);
    if (pending.length) return 'pending';
    let [latest] = await query(db, [
      "SELECT status FROM jobs WHERE job_type <> 'lattice-materialize' AND concurrency_group =",
      param(indexingConcurrencyGroup(realmURL)),
      'ORDER BY id DESC LIMIT 1',
    ]);
    if (latest?.status === 'rejected')
      throw new CardError(
        'Lattice indexing failed; retry indexing before treating this view as current',
        { status: 503 },
      );
  }
  let [row] = await query(db, [
    'SELECT o.published_generation, o.dirty_generation, o.retired, o.definition_revision,',
    ...latticeOwnerDefinitionCurrent(
      ['o.realm_url'],
      ['o.owner_url'],
      ['r.loader_epoch'],
      ['o.definition_revision'],
    ),
    'AS code_current FROM lattice_owners o JOIN realm_generations r ON r.realm_url = o.realm_url WHERE o.realm_url =',
    param(realmURL),
    'AND o.owner_url =',
    param(ownerURL),
  ]);
  return row &&
    !row.retired &&
    row.dirty_generation == null &&
    Number(row.published_generation) === stamp.outputRevision &&
    row.definition_revision === stamp.definitionRevision &&
    Boolean(row.code_current) &&
    stamp.state === 'ready'
    ? 'ready'
    : 'pending';
}
