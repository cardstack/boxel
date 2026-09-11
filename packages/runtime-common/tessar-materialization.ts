import type { Query } from './query.ts';
import type { DBAdapter } from './db.ts';
import { query, param, type Querier } from './expression.ts';
import { CardError } from './error.ts';
import type { LooseCardResource } from './resource-types.ts';
import { indexingConcurrencyGroup } from './jobs/indexing.ts';

// Versioned provenance for the ordinary attributes/relationship payload. The
// writer supplies revisions; realm source files must never supply this stamp.
export interface TessarMaterialization {
  version: 1;
  state: 'pending' | 'ready';
  computedFields: string[];
  queryFields: string[];
  watches: Array<{ fieldPath: string; query: Query }>;
  inputGeneration: number;
  publishedGeneration?: number;
  definitionRevision?: string;
}

export interface TessarInputSnapshot {
  realmURL: string;
  generation: number;
}

export const TESSAR_INPUT_GENERATION_HEADER = 'x-boxel-tessar-input-generation';

export async function tessarHasMaterializations(
  db: DBAdapter,
  realms: string[],
): Promise<boolean> {
  for (let realm of realms) {
    let rows = await query(db, [
      'SELECT 1 FROM tessar_owners WHERE realm_url =',
      param(realm),
      'AND retired = FALSE LIMIT 1',
    ]);
    if (rows.length) return true;
  }
  return false;
}

export function tessarRequestedGeneration(
  request: Request,
): number | undefined {
  let value = request.headers.get(TESSAR_INPUT_GENERATION_HEADER);
  if (value === null) return undefined;
  let generation = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(generation)) {
    throw new CardError('Tessar requires a nonnegative input generation', {
      status: 400,
    });
  }
  return generation;
}

export async function assertTessarGeneration(
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
      'Tessar input revision changed; recompute the complete owner',
      { status: 409 },
    );
  }
}

// A prerender visit sets and clears this explicitly. Ordinary readers and
// source edits never opt into the indexed-input protocol via this helper.
export function currentTessarInputSnapshot(): TessarInputSnapshot | undefined {
  let globals = globalThis as unknown as {
    __boxelRenderContext?: boolean;
    __tessarInputSnapshot?: TessarInputSnapshot;
  };
  return globals.__boxelRenderContext === true
    ? globals.__tessarInputSnapshot
    : undefined;
}

export function tessarSnapshotFields(resource: LooseCardResource) {
  let stamp = resource.meta.tessar;
  if (!stamp) return undefined;
  if (
    stamp.version !== 1 ||
    stamp.state !== 'ready' ||
    !Number.isSafeInteger(stamp.publishedGeneration) ||
    !Number.isSafeInteger(stamp.inputGeneration) ||
    stamp.inputGeneration < 0 ||
    stamp.publishedGeneration! <= stamp.inputGeneration ||
    !stamp.definitionRevision ||
    !Array.isArray(stamp.computedFields) ||
    !Array.isArray(stamp.queryFields) ||
    (resource.meta.generation !== undefined &&
      resource.meta.generation !== stamp.publishedGeneration)
  ) {
    throw new CardError(
      'Tessar materialization is pending or has invalid provenance',
      { status: 409 },
    );
  }
  return {
    computedFields: stamp.computedFields,
    queryFields: stamp.queryFields,
  };
}

export async function tessarReadState(
  db: DBAdapter,
  realmURL: string,
  ownerURL: string,
  stamp: TessarMaterialization,
  opts?: { tessarInput?: boolean },
): Promise<'ready' | 'pending'> {
  // Source endpoints durably enqueue before acknowledging. Across replicas,
  // an unprocessed write is visible here even before its indexed old/new
  // documents exist for precise reverse matching. A revision-pinned worker
  // must ignore its own queue job while consuming already-ready feeders.
  if (db.kind === 'pg' && !opts?.tessarInput) {
    let pending = await query(db, [
      "SELECT 1 FROM jobs WHERE status = 'unfulfilled' AND concurrency_group =",
      param(indexingConcurrencyGroup(realmURL)),
      'LIMIT 1',
    ]);
    if (pending.length) return 'pending';
    let [latest] = await query(db, [
      'SELECT status FROM jobs WHERE concurrency_group =',
      param(indexingConcurrencyGroup(realmURL)),
      'ORDER BY id DESC LIMIT 1',
    ]);
    if (latest?.status === 'rejected')
      throw new CardError(
        'Tessar indexing failed; retry indexing before treating this view as current',
        { status: 503 },
      );
  }
  let [row] = await query(db, [
    'SELECT o.published_generation, o.dirty_generation, o.retired, o.definition_revision, r.loader_epoch FROM tessar_owners o JOIN realm_generations r ON r.realm_url = o.realm_url WHERE o.realm_url =',
    param(realmURL),
    'AND o.owner_url =',
    param(ownerURL),
  ]);
  return row &&
    !row.retired &&
    row.dirty_generation == null &&
    Number(row.published_generation) === stamp.publishedGeneration &&
    row.definition_revision === stamp.definitionRevision &&
    row.loader_epoch === stamp.definitionRevision &&
    stamp.state === 'ready'
    ? 'ready'
    : 'pending';
}
