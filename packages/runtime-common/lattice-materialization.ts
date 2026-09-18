import type { LatticeProjectionWhere } from './definitions.ts';
import type { Query } from './query.ts';
import type { DBAdapter } from './db.ts';
import { query, param, type Querier } from './expression.ts';
import { CardError } from './error.ts';
import type { LooseCardResource } from './resource-types.ts';
import type { SingleCardDocument } from './document-types.ts';
import type { SerializedError } from './error.ts';
import {
  indexingConcurrencyGroup,
  SOURCE_INDEX_JOB_TYPES_SQL,
} from './jobs/indexing.ts';
import { latticeOwnerDefinitionCurrent } from './lattice-code-reference.ts';

// Versioned provenance for the ordinary attributes/relationship payload. The
// writer supplies revisions; realm source files must never supply this stamp.
export interface PublicationReceipt {
  version: 1;
  state: 'pending' | 'ready';
  computedFields: string[];
  queryFields: string[];
  // Native source-only primitives, independent of computed input progress.
  // Unknown/legacy producers omit this and retain conservative readiness.
  sourceFields?: Record<string, 'string' | 'strings'>;
  watches: Array<{ fieldPath: string; query: Query }>;
  validatedThrough: number;
  outputRevision?: number;
  // The earliest `freshUntil` grain over the owner's computed fields (an ISO
  // instant): the owner need not be re-derived before it. Registered on the
  // owner row at a ready publication (`lattice_owners.settle_until`). Only a
  // producer that evaluates grains (the native worker) supplies it; the
  // browser, which recomputes live, does not.
  freshUntil?: string;
  // The same hold as a window in seconds from the render: the registry arms
  // `settle_until` from the publication's own clock (`now() + freshWithin`),
  // so a hold shorter than the swap that publishes it still holds. When both
  // are present the window wins.
  freshWithin?: number;
  // The earliest `staleAfter` bound over the owner's computed fields, as a
  // window in seconds from the clock the programs read: once dirty, the owner
  // must be re-derived within it even while its inputs keep changing.
  // Registered as `lattice_owners.stale_within`; the registry arms
  // `stale_after` when the owner becomes dirty (and again at a stale
  // publication, which leaves it dirty). Native producer only.
  staleWithin?: number | null;
  livenessTier?: import('./lattice-liveness.ts').LatticeLivenessTier;
  // The publication came from a stale attempt: one that ran past its
  // deadline, over feeders' last published bodies and ahead of pending source
  // work. It is a valid value at its input generation, but the owner keeps
  // its obligation so the ordinary path re-derives it when the stream quiets.
  stale?: true;
  // Per watch field path, the projection predicate the owner read its
  // query results through (LatticeDataProjection.where, `$this.` resolved):
  // the watch compares the same slice of a changed row, so a change outside
  // it does not dirty the owner. Native producer only.
  projections?: Record<string, LatticeProjectionWhere>;
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

// Private index-owned provenance for a derivation committed with its source.
// Separate from `publication`: this has no secondary owner or query watches.
// Only the enabled serving seam converts it into a client snapshot receipt.
export interface IndexedComputationReceipt {
  version: 1;
  computedFields: string[];
  outputRevision: number;
  definitionRevision: string;
  loaderEpoch: string;
  codeReference?: import('./lattice-code-reference.ts').LatticeCodeReference;
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
  // An owner registered by discovery and not yet published has a stamp with
  // no output behind it. Where pending is allowed (display), it deserializes
  // as a pending instance -- computed fields absent, `publicationState`
  // pending -- rather than failing every card that links to it.
  if (
    opts?.allowPending &&
    stamp.version === 1 &&
    stamp.state === 'pending' &&
    stamp.outputRevision === undefined
  ) {
    return {
      computedFields: Array.isArray(stamp.computedFields)
        ? stamp.computedFields
        : [],
      queryFields: Array.isArray(stamp.queryFields) ? stamp.queryFields : [],
      scope: { active: true, pending: true },
    };
  }
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

// Request-scoped only: a later request must observe new jobs and routing work.
export type LatticeReadContext = Map<
  string,
  Promise<{
    matchingPending: boolean;
    sourcePending: boolean;
    sourceFailed: boolean;
  }>
>;

async function realmReadState(
  db: DBAdapter,
  realmURL: string,
  latticeInput: boolean,
) {
  const [row] = await query(db, [
    'SELECT EXISTS (SELECT 1 FROM lattice_pending_generations WHERE realm_url =',
    param(realmURL),
    ') AS matching_pending',
    ...(db.kind === 'pg' && !latticeInput
      ? [
          `, EXISTS (SELECT 1 FROM jobs WHERE status='unfulfilled' AND job_type IN ${SOURCE_INDEX_JOB_TYPES_SQL} AND concurrency_group=`,
          param(indexingConcurrencyGroup(realmURL)),
          ') AS source_pending,',
          `(SELECT status FROM jobs WHERE job_type IN ${SOURCE_INDEX_JOB_TYPES_SQL} AND concurrency_group=`,
          param(indexingConcurrencyGroup(realmURL)),
          'ORDER BY id DESC LIMIT 1) AS latest_status',
        ]
      : []),
  ]);
  return {
    matchingPending: Boolean(row.matching_pending),
    sourcePending: Boolean(row.source_pending),
    sourceFailed: row.latest_status === 'rejected',
  };
}

export async function latticeReadState(
  db: DBAdapter,
  realmURL: string,
  ownerURL: string,
  stamp: PublicationReceipt,
  opts?: {
    latticeInput?: boolean;
    indexedComputation?: IndexedComputationReceipt;
    latticeReadContext?: LatticeReadContext;
  },
): Promise<'ready' | 'pending'> {
  // Queue state is a conservative barrier before source rows are available
  // for precise matching. Share that realm-scoped probe across this response,
  // never across requests, rather than repeating it for each included owner.
  const key = JSON.stringify([realmURL, Boolean(opts?.latticeInput)]);
  let state = opts?.latticeReadContext?.get(key);
  if (!state) {
    state = realmReadState(db, realmURL, Boolean(opts?.latticeInput));
    opts?.latticeReadContext?.set(key, state);
  }
  const realm = await state;
  if (
    (!opts?.indexedComputation && realm.matchingPending) ||
    realm.sourcePending
  )
    return 'pending';
  if (realm.sourceFailed)
    throw new CardError(
      'Lattice indexing failed; retry indexing before treating this view as current',
      { status: 503 },
    );
  if (opts?.indexedComputation) {
    const proof = opts.indexedComputation;
    // Primary indexing already committed the source and computed value as one
    // guarded batch. Secondary routing/owners cannot make this output pending.
    const [code] = await query(
      db,
      proof.codeReference && db.kind === 'pg'
        ? [
            'SELECT lattice_code_reference_current(',
            param(JSON.stringify(proof.codeReference)),
            '::jsonb) AS current',
          ]
        : [
            'SELECT loader_epoch =',
            param(proof.loaderEpoch),
            'AS current FROM realm_generations WHERE realm_url =',
            param(realmURL),
          ],
    );
    return proof.version === 1 && code?.current === true ? 'ready' : 'pending';
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

// A conservative response-cache boundary for ordinary roots that can embed
// materialized cards. A settled realm revision covers nested publications;
// during routing/recomputation we serve fresh state without retaining a body.
export async function latticeCardCacheRevision(
  db: DBAdapter,
  realmURL: string,
): Promise<string | undefined> {
  const [row] = await query(db, [
    'SELECT g.current_generation,g.loader_epoch FROM realm_generations g WHERE g.realm_url=',
    param(realmURL),
    `AND NOT EXISTS (SELECT 1 FROM lattice_pending_generations p WHERE p.realm_url=g.realm_url)
     AND NOT EXISTS (SELECT 1 FROM lattice_owners o WHERE o.realm_url=g.realm_url AND NOT o.retired AND o.dirty_generation IS NOT NULL)`,
    ...(db.kind === 'pg'
      ? [
          `AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.concurrency_group=`,
          param(indexingConcurrencyGroup(realmURL)),
          `AND j.job_type IN ${SOURCE_INDEX_JOB_TYPES_SQL} AND j.status='unfulfilled')
       AND NOT EXISTS (SELECT 1 FROM lattice_code_artifacts c WHERE c.realm_url=g.realm_url AND c.dirty)
       AND NOT EXISTS (SELECT 1 FROM lattice_owner_code b WHERE b.realm_url=g.realm_url AND NOT lattice_code_reference_current(b.reference))
       AND COALESCE((SELECT j.status FROM jobs j WHERE j.concurrency_group=`,
          param(indexingConcurrencyGroup(realmURL)),
          `AND j.job_type IN ${SOURCE_INDEX_JOB_TYPES_SQL} ORDER BY j.id DESC LIMIT 1),'resolved') <> 'rejected'`,
        ]
      : []),
  ]);
  return row
    ? JSON.stringify([row.current_generation, row.loader_epoch])
    : undefined;
}
