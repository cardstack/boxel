import { readFile, stat } from 'node:fs/promises';
import type { DBAdapter, VirtualNetwork } from '@cardstack/runtime-common';
import { LatticeBxlWorker } from './lattice-bxl-derivation.ts';
import { LatticeMaterializationInputs } from './lattice-materialization-inputs.ts';
import { openLatticeNativeWork } from './lattice-native-work.ts';
import type { PgAdapter } from '@cardstack/postgres';
import { createLatticeNativeFileIndexer } from './lattice-native-file.ts';
import { createLatticeNativeCardIndexer } from './lattice-native-card-indexer.ts';
import { createLatticeCodeWorker } from './lattice-code-worker.ts';
import { registerLatticeCodePolicies } from './lattice-code-admission.ts';
import {
  createPostgresLatticeAdmission,
  createPostgresLatticeFileAdmission,
  type LatticeNativeRealmPolicy,
} from './lattice-postgres-admission.ts';

// The review file is process configuration supplied by the operator, like the
// worker's other capabilities. Its contents must never come from a card write.
export async function createLatticeNativeWorker({
  db,
  network,
  reviewFile,
  runtimeRevision,
}: {
  db: DBAdapter;
  network: VirtualNetwork;
  reviewFile: string;
  runtimeRevision: string | undefined;
}) {
  if (!runtimeRevision)
    throw new Error('Native worker requires a runtime revision');
  const info = await stat(reviewFile);
  if (!info.isFile() || info.size > 1_048_576)
    throw new Error('Native review must be a file of at most 1 MiB');
  const bytes = await readFile(reviewFile);
  if (bytes.length > 1_048_576) throw new Error('Native review exceeds 1 MiB');
  const policies: LatticeNativeRealmPolicy[] = JSON.parse(
    bytes.toString('utf8'),
  );
  if (
    !Array.isArray(policies) ||
    !policies.length ||
    policies.length > 32 ||
    policies.some(
      (policy) => !policy || policy.runtimeRevision !== runtimeRevision,
    )
  )
    throw new Error(
      'Native review must list matching, versioned realm policies',
    );
  await registerLatticeCodePolicies(db, policies);
  if (process.env.LATTICE_NATIVE_ADMISSION_DEBUG)
    console.warn(
      `native worker: ${policies.length} policy(ies), ${policies.map((p) => `${p.realmURL} ${p.modules.length} modules ${p.definitions.length} definitions ${p.roots.length} roots`).join('; ')}`,
    );
  const admit = createPostgresLatticeAdmission({
    db,
    network,
    policies,
    runtimeRevision: () => runtimeRevision,
  });
  const worker = new LatticeBxlWorker();
  return {
    codeLinker: createLatticeCodeWorker({
      db,
      network,
      policies,
      runtimeRevision: () => runtimeRevision,
    }),
    fileIndexer: createLatticeNativeFileIndexer({
      admit: createPostgresLatticeFileAdmission({
        db,
        network,
        policies,
        runtimeRevision: () => runtimeRevision,
      }),
    }),
    indexer: createLatticeNativeCardIndexer({
      worker,
      admit,
      // Declared-link projections for source indexing read the current index
      // rows of the same realm, which is what the browser producer's loader
      // also serves; a missing or failed row reads as null.
      readLinks: async (request, _admission, urls) => {
        const { query, param, textArrayParam } =
          await import('@cardstack/runtime-common/expression');
        const rows = await query(db, [
          'SELECT url, generation, pristine_doc FROM boxel_index WHERE realm_url =',
          param(request.realmURL),
          "AND type = 'instance' AND is_deleted IS NOT TRUE AND has_error IS NOT TRUE AND pristine_doc IS NOT NULL AND url = ANY(",
          textArrayParam(urls),
          '::text[])',
        ]);
        const byUrl = new Map(rows.map((row) => [String(row.url), row]));
        return urls.map((url) => {
          const row = byUrl.get(url);
          return row
            ? {
                url,
                generation: Number(row.generation),
                resource: row.pristine_doc as any,
              }
            : { url, generation: 0, resource: null };
        });
      },
      openWork: (request, admission) => {
        if (db.kind !== 'pg' || !('subscribe' in db))
          throw new Error(
            'Native query cancellation needs PostgreSQL notifications',
          );
        return openLatticeNativeWork(db as PgAdapter, request, admission);
      },
      openInputs: async (request, admission, signal) => {
        if (!admission.inputActor || !request.inputSnapshot)
          throw new Error('Missing native query input authority');
        return LatticeMaterializationInputs.open({
          db,
          network,
          realmURL: request.realmURL,
          actor: admission.inputActor,
          generation: request.inputSnapshot.generation,
          loaderEpoch: request.loaderEpoch,
          signal,
          lookup: {
            lookupDefinition: async (ref) =>
              (await admission.lookup(ref)).definition,
          },
        });
      },
    }),
    close: () => worker.close(),
  };
}
