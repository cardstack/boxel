import type { PgAdapter } from '@cardstack/postgres';
import { createHash } from 'node:crypto';
import {
  CachingDefinitionLookup,
  internalKeyFor,
  isResolvedCodeRef,
  maybeRelativeReference,
  type CodeRef,
  type Definition,
  type Realm,
  type ResolvedCodeRef,
  type ModuleRenderResponse,
  type Prerenderer,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import type { LatticeBxlWorker } from '../../lib/lattice-bxl-derivation.ts';
import type { LatticeDefinitionSnapshot } from '../../lib/lattice-card-data.ts';
import { createLatticeNativeCardIndexer } from '../../lib/lattice-native-card-indexer.ts';
import { LatticeMaterializationInputs } from '../../lib/lattice-materialization-inputs.ts';
import {
  createPostgresLatticeAdmission,
  latticeDefinitionDigest,
  type LatticeNativeRealmPolicy,
} from '../../lib/lattice-postgres-admission.ts';
import { openLatticeNativeWork } from '../../lib/lattice-native-work.ts';

async function captureDefinitions(
  refs: CodeRef[],
  network: VirtualNetwork,
  lookup: (ref: ResolvedCodeRef) => Promise<Definition>,
) {
  const snapshots = new Map<string, LatticeDefinitionSnapshot>();
  const key = (ref: CodeRef) => internalKeyFor(ref, undefined, network);
  async function capture(ref: CodeRef): Promise<void> {
    if (snapshots.has(key(ref))) return;
    if (!isResolvedCodeRef(ref))
      throw new Error('Fixture definition must be exported');
    const definition = await lookup(ref);
    snapshots.set(key(ref), {
      definition,
      revision: latticeDefinitionDigest(definition),
    });
    for (const field of Object.values(definition.fieldDefs)) {
      if (
        field.nativeCodec?.kind === 'compound' &&
        (['contains', 'containsMany', 'linksTo', 'linksToMany'].includes(
          field.type,
        ) ||
          field.query)
      )
        await capture(field.fieldOrCard);
    }
  }
  for (const ref of refs) await capture(ref);
  return snapshots;
}

// Parity only: capture actual Chrome definition metadata, then disconnect
// definition execution from the native candidate path. This is deliberately
// unable to publish; admission/transaction tests exercise the production seal.
export async function capturedNativeIndexer({
  db,
  network,
  realmURL,
  actor,
  auth,
  renderer,
  worker,
  refs,
}: {
  db: PgAdapter;
  network: VirtualNetwork;
  realmURL: string;
  actor: string;
  auth: string;
  renderer: Prerenderer;
  worker: LatticeBxlWorker;
  refs: CodeRef[];
}) {
  const modules = new Map<string, ModuleRenderResponse>();
  const key = (ref: CodeRef) => internalKeyFor(ref, undefined, network);
  const snapshots = await captureDefinitions(refs, network, async (ref) => {
    let module = modules.get(ref.module);
    if (!module) {
      const resolved = network.resolveURL(ref.module, realmURL);
      const url = network.mapURL(resolved, 'real-to-virtual') ?? resolved;
      module = await renderer.prerenderModule({
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: url.href,
        auth,
      });
      modules.set(ref.module, module);
    }
    const entry = Object.values(module.definitions).find(
      (entry) =>
        entry.type === 'definition' &&
        isResolvedCodeRef(entry.definition.codeRef) &&
        entry.definition.codeRef.name === ref.name,
    );
    if (!entry || entry.type !== 'definition')
      throw new Error(
        `Missing captured ${ref.name}: ${module.error?.error.message}`,
      );
    return entry.definition;
  });
  const snapshot = (ref: CodeRef) => {
    const found = snapshots.get(key(ref));
    if (!found) throw new Error(`Uncaptured native definition ${key(ref)}`);
    return found;
  };
  await db.execute(
    'INSERT INTO realm_metadata(url) VALUES($1) ON CONFLICT DO NOTHING',
    {
      bind: [realmURL],
    },
  );
  return createLatticeNativeCardIndexer({
    worker,
    admit: async (request) => ({
      root: snapshot(JSON.parse(request.sourceJSON).data.meta.adoptsFrom),
      lookup: async (ref) => snapshot(ref),
      resolve: (reference, relativeTo) =>
        network.resolveURL(reference, relativeTo).href,
      relative: (reference, id) =>
        reference.startsWith('@')
          ? reference
          : maybeRelativeReference(
              network.resolveURL(reference, id),
              network.toURL(id),
              new URL(realmURL),
            ),
      typeKey: key,
      deps: [realmURL + 'cards'],
      runtimeRevision: 'repository-captured-parity-fixture',
      inputActor: actor,
      assertCurrent: async () => {
        throw new Error('Parity candidates must not publish');
      },
    }),
    openInputs: (request) =>
      LatticeMaterializationInputs.open({
        db,
        network,
        realmURL,
        actor,
        generation: request.inputSnapshot!.generation,
        loaderEpoch: request.loaderEpoch,
        lookup: { lookupDefinition: async (ref) => snapshot(ref).definition },
      }),
  });
}

// Test-owned review of real cached definitions and real source bytes. Extracted
// from the two-store fixture; publication still uses production PostgreSQL
// admission and commit fences. This does not grant arbitrary authored code
// permission to execute, and is distinct from the read-only parity helper.
export async function publishedNativeIndexer({
  db,
  network,
  realm,
  actor,
  renderer,
  worker,
  refs,
  sourcePaths,
  createPrerenderAuth,
}: {
  db: PgAdapter;
  network: VirtualNetwork;
  realm: Realm;
  actor: string;
  renderer: Prerenderer;
  worker: LatticeBxlWorker;
  refs: CodeRef[];
  sourcePaths: string[];
  createPrerenderAuth: ConstructorParameters<typeof CachingDefinitionLookup>[3];
}) {
  const realmURL = realm.url;
  const sourceBytes = async (url: string) => {
    const response = await network.fetch(
      new Request(url, {
        headers: { Accept: 'application/vnd.card+source' },
      }),
    );
    if (!response.ok)
      throw new Error(
        `Missing reviewed fixture source: ${url} (${response.status})`,
      );
    return response.text();
  };
  for (const path of sourcePaths) {
    const bytes = await sourceBytes(realmURL + path);
    const hash = createHash('md5').update(bytes).digest('hex');
    await db.execute(
      `UPDATE realm_file_meta SET content_hash=$3,content_size=$4 WHERE realm_url=$1 AND file_path=$2 AND content_hash IS NULL`,
      { bind: [realmURL, path, hash, Buffer.byteLength(bytes)] },
    );
    const [receipt] = await db.execute(
      'SELECT content_hash=$3 AND content_size=$4 AS matches FROM realm_file_meta WHERE realm_url=$1 AND file_path=$2',
      { bind: [realmURL, path, hash, Buffer.byteLength(bytes)] },
    );
    if (!receipt?.matches)
      throw new Error(`Bootstrap source receipt differs: ${path}`);
  }
  const cache = new CachingDefinitionLookup(
    db,
    renderer,
    network,
    createPrerenderAuth,
  );
  const lookup = cache.forRealm(realm);
  const snapshots = await captureDefinitions(refs, network, (ref) =>
    lookup.lookupDefinition(ref),
  );
  const key = (ref: CodeRef) => internalKeyFor(ref, undefined, network);
  const roots = [
    ...new Map(
      refs.map((ref) => {
        if (!isResolvedCodeRef(ref))
          throw new Error('Fixture root must be exported');
        return [key(ref), ref] as const;
      }),
    ).values(),
  ];
  const policy: LatticeNativeRealmPolicy = {
    realmURL,
    actorUserId: actor,
    runtimeRevision: 'repository-published-fixture',
    roots,
    noScreenshotThumbnail: true,
    modules: [],
    definitions: [],
  };
  const captured = new Set<string>();
  const rows = await db.execute(
    'SELECT url,resolved_realm_url,cache_scope,auth_user_id,definitions FROM modules WHERE error_doc IS NULL',
  );
  for (const row of rows) {
    if (row.cache_scope !== 'public' && row.auth_user_id !== actor) continue;
    const entries = Object.entries(
      row.definitions as unknown as ModuleRenderResponse['definitions'],
    ).filter(
      ([, value]) =>
        value.type === 'definition' &&
        isResolvedCodeRef(value.definition.codeRef) &&
        snapshots.has(key(value.definition.codeRef)),
    );
    if (!entries.length) continue;
    const url = String(row.url),
      moduleRealm = String(row.resolved_realm_url);
    const sourceURL = url.endsWith('.gts') ? url : url + '.gts';
    const path = sourceURL.slice(moduleRealm.length);
    const bytes = await sourceBytes(sourceURL);
    const hash = createHash('md5').update(bytes).digest('hex');
    // Test support serves base sources; only their matching reviewed metadata
    // is owned by this fixture database, never a second source-write path.
    await db.execute(
      'INSERT INTO realm_metadata(url) VALUES($1) ON CONFLICT DO NOTHING',
      { bind: [moduleRealm] },
    );
    await db.execute(
      "INSERT INTO realm_user_permissions(realm_url,username,read,write,realm_owner) VALUES($1,'*',TRUE,FALSE,FALSE) ON CONFLICT DO NOTHING",
      { bind: [moduleRealm] },
    );
    await db.execute(
      'INSERT INTO realm_file_meta(realm_url,file_path,created_at,content_hash,content_size) VALUES($1,$2,1,$3,$4) ON CONFLICT(realm_url,file_path) DO NOTHING',
      { bind: [moduleRealm, path, hash, Buffer.byteLength(bytes)] },
    );
    policy.modules.push({
      url,
      realmURL: moduleRealm,
      cacheScope: row.cache_scope as 'public' | 'realm-auth',
      authUserId: String(row.auth_user_id),
      sourcePath: path,
      sourceMD5: hash,
    });
    for (const [cacheKey, entry] of entries) {
      if (
        entry.type !== 'definition' ||
        !isResolvedCodeRef(entry.definition.codeRef)
      )
        continue;
      const id = key(entry.definition.codeRef);
      if (captured.has(id))
        throw new Error(`Ambiguous reviewed fixture definition: ${id}`);
      const digest = latticeDefinitionDigest(entry.definition);
      if (snapshots.get(id)?.revision !== digest)
        throw new Error(`Fixture definition changed during capture: ${id}`);
      captured.add(id);
      policy.definitions.push({
        codeRef: entry.definition.codeRef,
        moduleURL: url,
        cacheKey,
        definitionSHA256: digest,
      });
    }
  }
  if (captured.size !== snapshots.size)
    throw new Error(
      'Fixture definition closure is not fully cached in an authorized scope',
    );
  return createLatticeNativeCardIndexer({
    worker,
    admit: createPostgresLatticeAdmission({
      db,
      network,
      policies: [policy],
      runtimeRevision: () => policy.runtimeRevision,
    }),
    openWork: (request, admission) =>
      openLatticeNativeWork(db, request, admission),
    openInputs: (request, admission, signal) =>
      LatticeMaterializationInputs.open({
        db,
        network,
        realmURL,
        actor: admission.inputActor!,
        generation: request.inputSnapshot!.generation,
        loaderEpoch: request.loaderEpoch,
        signal,
        lookup: {
          lookupDefinition: async (ref) =>
            (await admission.lookup(ref)).definition,
        },
      }),
  });
}
