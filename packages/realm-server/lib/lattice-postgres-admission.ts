import type { LatticeGtsAnalysis } from '@cardstack/runtime-common/lattice-gts-analysis-contract';
import { prepareLatticeJsonSource } from './lattice-json-source.ts';
import { createHash } from 'node:crypto';
import { baseRealm } from '@cardstack/runtime-common';
import stringify from 'safe-stable-stringify';
import {
  internalKeyFor,
  maybeRelativeReference,
  RealmPaths,
  type CodeRef,
  type DBAdapter,
  type ResolvedCodeRef,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  param,
  query,
  type Querier,
} from '@cardstack/runtime-common/expression';
import type { Definition } from '@cardstack/runtime-common/definitions';
import type {
  LatticeNativeCardIndexRequest,
  LatticeNativeFileIndexRequest,
} from '@cardstack/runtime-common/lattice-native-index';
import type { LatticeNativeFileAdmission } from './lattice-native-file.ts';
import type { LatticeNativeCardAdmission } from './lattice-native-card-indexer.ts';
import {
  readLatticeCodeAdmission,
  type LatticeCodeAdmission,
} from './lattice-code-admission.ts';

export interface LatticeReviewedModule {
  url: string;
  realmURL: string;
  cacheScope: 'public' | 'realm-auth';
  authUserId: string;
  sourcePath: string;
  // The existing realm_file_meta hash, pinned by the definition review. This
  // identifies source bytes; it is not a signature or an authorization grant.
  sourceMD5: string;
  dataRevision?: LatticeGtsAnalysis['dataRevision'];
}

export interface LatticeReviewedDefinition {
  codeRef: ResolvedCodeRef;
  moduleURL: string;
  cacheKey: string;
  definitionSHA256: string;
}

export interface LatticeNativeRealmPolicy {
  realmURL: string;
  actorUserId: string;
  runtimeRevision: string;
  roots: ResolvedCodeRef[];
  // Enables linked classification as an additional card admission requirement.
  // Bootstrap source closures must also appear in the reviewed modules. This
  // never replaces semantic review with a static-analysis permission grant.
  codeLinking?: {
    trustedModules: Array<{
      moduleURL: string;
      exports: string[];
      moduleURLs: string[];
    }>;
  };
  // Reviewed implementations of the trusted shared extractor. The resolved
  // file type must match; arbitrary FileDef code continues through the browser.
  fileExtractors?: Array<{
    codeRef: ResolvedCodeRef;
    kind: 'base-json' | 'base-gts';
    // Explicit reviewed implementation closure for file-only work. The file
    // being analyzed must not depend on its previous application module cache.
    moduleURLs?: string[];
  }>;
  // A process-installed, authorized review policy, not authored card data.
  // Include every module affecting constructors/defaults/computations; do not
  // infer this set by traversing presentation imports, CSS or icon resources.
  modules: LatticeReviewedModule[];
  definitions: LatticeReviewedDefinition[];
  // First admitted definitions have no screenshot-derived thumbnail fallback.
  // A later provider must include that representation's metadata in its receipt.
  noScreenshotThumbnail: true;
}

export function latticeDefinitionDigest(definition: Definition): string {
  return createHash('sha256').update(stringify(definition)!).digest('hex');
}

const md5 = (value: string) => createHash('md5').update(value).digest('hex');
const moduleKey = (module: LatticeReviewedModule) =>
  JSON.stringify([
    module.realmURL,
    module.cacheScope,
    module.authUserId,
    module.url,
  ]);

interface FileReceipt {
  realm_url: string;
  file_path: string;
  version: string;
  content_hash: string;
  content_size: number;
  source_fingerprint?: unknown;
}
interface ModuleReceipt {
  realm_url: string;
  url: string;
  cache_scope: string;
  auth_user_id: string;
  version: string;
}
interface PermissionReceipt {
  realm_url: string;
  username: string;
  version: string;
  metadata_version: string | null;
  bootstrap_version: string | null;
}

// No browser, GTS evaluation, remote visibility probe or cache populate. The
// caller installs scopes it is authorized to read. A missing/unreviewed cache
// entry declines native indexing; a changed admitted receipt rejects commit.
interface LatticeAdmissionOptions {
  db: DBAdapter;
  network: VirtualNetwork;
  policies: LatticeNativeRealmPolicy[];
  runtimeRevision(): string;
}

export function createPostgresLatticeAdmission(
  options: LatticeAdmissionOptions,
) {
  return createPostgresAdmission(options, 'card');
}

export function createPostgresLatticeFileAdmission(
  options: LatticeAdmissionOptions,
) {
  const admit = createPostgresAdmission(options, 'file');
  return (request: LatticeNativeFileIndexRequest) => {
    const { source, ...identity } = request;
    return admit({ ...identity, sourceJSON: source });
  };
}

function createPostgresAdmission(
  { db, network, policies, runtimeRevision }: LatticeAdmissionOptions,
  mode: 'card' | 'file',
): (
  request: LatticeNativeCardIndexRequest,
) => Promise<LatticeNativeCardAdmission | undefined> {
  if (db.kind !== 'pg') throw new Error('Native admission requires PostgreSQL');
  // Freeze the policy by value so an operator cannot mutate a pending receipt's
  // review in place. A changed review installs a new provider.
  const reviewed = structuredClone(policies);
  const cache = new Map<
    string,
    { version: string; definition: Definition; digest: string }
  >();
  const locked = new WeakMap<Querier, Set<string>>();
  // Definitions name base modules by the `@cardstack/base/` alias while a
  // file's FileDef reference (resolveFileDefCodeRef) carries the canonical
  // base realm URL; the worker's network does not equate the two.
  const canonicalModule = (module: string) =>
    module.startsWith('@cardstack/base/')
      ? baseRealm.url + module.slice('@cardstack/base/'.length)
      : module;
  const sameRef = (a: CodeRef, b: CodeRef) =>
    'module' in a &&
    'module' in b &&
    a.name === b.name &&
    network.toRealURLHref(
      network.resolveURL(canonicalModule(a.module), undefined).href,
    ) ===
      network.toRealURLHref(
        network.resolveURL(canonicalModule(b.module), undefined).href,
      );

  async function readFile(
    realmURL: string,
    path: string,
    fingerprintURL?: string,
  ): Promise<FileReceipt | undefined> {
    const [row] = await query(
      db,
      [
        'SELECT f.realm_url,f.file_path,f.xmin::text AS version,f.content_hash,f.content_size',
        ...(fingerprintURL
          ? [", i.pristine_doc->'meta'->'latticeSource' AS source_fingerprint"]
          : []),
        'FROM realm_file_meta f',
        ...(fingerprintURL
          ? [
              'LEFT JOIN boxel_index i ON i.realm_url=f.realm_url AND i.url =',
              param(fingerprintURL),
              "AND i.type='file' AND i.is_deleted IS NOT TRUE AND i.error_doc IS NULL",
            ]
          : []),
        'WHERE f.realm_url =',
        param(realmURL),
        'AND f.file_path =',
        param(path),
      ],
      { source_fingerprint: 'JSON' },
    );
    if (!row?.content_hash || row.content_size == null) {
      if (process.env.LATTICE_NATIVE_ADMISSION_DEBUG)
        console.warn(
          `native admission refused ${realmURL}${path}: no content hash in realm_file_meta (file never written through the realm)`,
        );
      return undefined;
    }
    return {
      ...row,
      content_size: Number(row.content_size),
    } as unknown as FileReceipt;
  }

  async function permission(
    realmURL: string,
    username: string,
  ): Promise<PermissionReceipt | undefined> {
    const [row] = await query(db, [
      // Source realms need archive metadata. Bootstrap realms may lack it;
      // their registry kind prohibits archive and is locked at publication.
      `SELECT p.realm_url,p.username,p.xmin::text AS version,
         r.xmin::text AS metadata_version,b.xmin::text AS bootstrap_version
       FROM realm_user_permissions p
       LEFT JOIN realm_metadata r ON r.url=p.realm_url
       LEFT JOIN realm_registry b ON b.url=p.realm_url AND b.kind='bootstrap' AND r.url IS NULL
       WHERE p.realm_url =`,
      param(realmURL),
      'AND p.username =',
      param(username),
      'AND p.read = TRUE AND r.archived_at IS NULL AND (r.url IS NOT NULL OR b.url IS NOT NULL)',
    ]);
    return row as unknown as PermissionReceipt | undefined;
  }

  async function checkPermissions(
    tx: Querier,
    receipts: PermissionReceipt[],
    checked: Set<string>,
  ) {
    const pending = receipts.filter(
      (row) => !checked.has('permission:' + JSON.stringify(row)),
    );
    if (!pending.length) return;
    const metadata = pending.filter((row) => row.metadata_version !== null);
    const bootstrap = pending.filter((row) => row.bootstrap_version !== null);
    // Separate inner joins let PostgreSQL lock the actual authority row;
    // FOR SHARE cannot lock the nullable side of an outer join.
    const rows = metadata.length
      ? await tx([
          `SELECT p.realm_url,p.username,p.xmin::text AS version,r.xmin::text AS metadata_version,NULL::text AS bootstrap_version FROM realm_user_permissions p
       JOIN realm_metadata r ON r.url=p.realm_url
       JOIN jsonb_to_recordset(`,
          param(JSON.stringify(metadata)),
          `::jsonb) AS e(realm_url text,username text) ON p.realm_url=e.realm_url AND p.username=e.username
       WHERE p.read = TRUE AND r.archived_at IS NULL
       ORDER BY p.realm_url,p.username FOR SHARE OF p,r`,
        ])
      : [];
    if (bootstrap.length)
      rows.push(
        ...(await tx([
          `SELECT p.realm_url,p.username,p.xmin::text AS version,
         NULL::text AS metadata_version,r.xmin::text AS bootstrap_version
       FROM realm_user_permissions p JOIN realm_registry r ON r.url=p.realm_url
       JOIN jsonb_to_recordset(`,
          param(JSON.stringify(bootstrap)),
          `::jsonb) AS e(realm_url text,username text) ON p.realm_url=e.realm_url AND p.username=e.username
       WHERE p.read = TRUE AND r.kind='bootstrap'
         AND NOT EXISTS (SELECT 1 FROM realm_metadata m WHERE m.url=r.url)
       ORDER BY p.realm_url,p.username FOR SHARE OF p,r`,
        ])),
      );
    if (
      rows.length !== pending.length ||
      pending.some(
        (expected) =>
          !rows.some(
            (actual) =>
              actual.realm_url === expected.realm_url &&
              actual.username === expected.username &&
              actual.version === expected.version &&
              actual.metadata_version === expected.metadata_version &&
              actual.bootstrap_version === expected.bootstrap_version,
          ),
      )
    )
      throw new Error('Native read permission changed before publication');
    for (const row of pending) checked.add('permission:' + JSON.stringify(row));
  }

  async function checkFiles(
    tx: Querier,
    receipts: FileReceipt[],
    checked: Set<string>,
  ) {
    const pending = [
      ...new Map(receipts.map((row) => [JSON.stringify(row), row])).values(),
    ].filter((row) => !checked.has('file:' + JSON.stringify(row)));
    if (!pending.length) return;
    const rows = await tx([
      `SELECT f.realm_url,f.file_path,f.xmin::text AS version,f.content_hash,f.content_size
       FROM realm_file_meta f JOIN jsonb_to_recordset(`,
      param(JSON.stringify(pending)),
      `::jsonb) AS e(realm_url text,file_path text)
       ON f.realm_url=e.realm_url AND f.file_path=e.file_path
       ORDER BY f.realm_url,f.file_path FOR SHARE OF f`,
    ]);
    if (
      rows.length !== pending.length ||
      pending.some(
        (expected) =>
          !rows.some(
            (actual) =>
              actual.realm_url === expected.realm_url &&
              actual.file_path === expected.file_path &&
              actual.version === expected.version &&
              actual.content_hash === expected.content_hash &&
              Number(actual.content_size) === expected.content_size,
          ),
      )
    ) {
      throw new Error(
        'Native source or reviewed code changed before publication',
      );
    }
    for (const row of pending) checked.add('file:' + JSON.stringify(row));
  }

  async function checkModules(
    tx: Querier,
    receipts: ModuleReceipt[],
    checked: Set<string>,
  ) {
    const pending = [
      ...new Map(receipts.map((row) => [JSON.stringify(row), row])).values(),
    ].filter((row) => !checked.has('module:' + JSON.stringify(row)));
    if (!pending.length) return;
    const rows = await tx([
      `SELECT m.resolved_realm_url AS realm_url,m.url,m.cache_scope,m.auth_user_id,m.xmin::text AS version
       FROM modules m JOIN jsonb_to_recordset(`,
      param(JSON.stringify(pending)),
      `::jsonb) AS e(realm_url text,url text,cache_scope text,auth_user_id text)
       ON m.resolved_realm_url=e.realm_url AND m.url_hash=md5(e.url) AND m.url=e.url
         AND m.cache_scope=e.cache_scope AND m.auth_user_id=e.auth_user_id
       WHERE m.error_doc IS NULL
       ORDER BY m.resolved_realm_url,m.cache_scope,m.auth_user_id,m.url FOR SHARE OF m`,
    ]);
    if (
      rows.length !== pending.length ||
      pending.some(
        (expected) =>
          !rows.some(
            (actual) =>
              actual.realm_url === expected.realm_url &&
              actual.url === expected.url &&
              actual.cache_scope === expected.cache_scope &&
              actual.auth_user_id === expected.auth_user_id &&
              actual.version === expected.version,
          ),
      )
    ) {
      throw new Error('Native definition cache changed before publication');
    }
    for (const row of pending) checked.add('module:' + JSON.stringify(row));
  }

  // Construct the commit closure in a separate scope. Sharing the admission
  // scope with lookup closures can retain definition graphs until batch commit.
  function publicationCheck({
    requestIdentity,
    sourceSHA256,
    expectedDefinitions,
    expectedLoaderEpoch,
    permissions,
    files,
    modules,
    codeCheck,
    allowGenerationAdvance,
  }: {
    requestIdentity: Pick<
      LatticeNativeCardIndexRequest,
      'url' | 'realmURL' | 'generation' | 'loaderEpoch'
    >;
    sourceSHA256: string;
    expectedLoaderEpoch: string;
    expectedDefinitions: Array<{ codeRef: CodeRef; revision: string }>;
    permissions: PermissionReceipt[];
    files: FileReceipt[];
    modules: ModuleReceipt[];
    codeCheck?: (tx: Querier) => Promise<void>;
    allowGenerationAdvance: boolean;
  }): LatticeNativeCardAdmission['assertCurrent'] {
    return async (tx, receipt) => {
      if (
        receipt.sourceHash !== sourceSHA256 ||
        receipt.request.url !== requestIdentity.url ||
        receipt.request.realmURL !== requestIdentity.realmURL ||
        receipt.request.generation !== requestIdentity.generation ||
        receipt.request.loaderEpoch !== requestIdentity.loaderEpoch ||
        receipt.runtimeRevision !== runtimeRevision() ||
        receipt.definitions.some(
          (actual) =>
            !expectedDefinitions.some(
              (expected) =>
                sameRef(actual.codeRef, expected.codeRef) &&
                actual.revision === expected.revision,
            ),
        )
      )
        throw new Error(
          'Native computation receipt no longer matches its review',
        );
      await codeCheck?.(tx);
      let checked = locked.get(tx);
      if (!checked) {
        checked = new Set();
        locked.set(tx, checked);
      }
      await checkPermissions(tx, permissions, checked);
      const realmKey = JSON.stringify([
        requestIdentity.realmURL,
        receipt.request.generation,
        receipt.request.loaderEpoch,
        expectedLoaderEpoch,
        allowGenerationAdvance,
      ]);
      if (!checked.has(realmKey)) {
        const [current] = await tx([
          'SELECT current_generation,loader_epoch FROM realm_generations WHERE realm_url =',
          param(requestIdentity.realmURL),
          'FOR SHARE',
        ]);
        if (
          !current ||
          (allowGenerationAdvance
            ? Number(current.current_generation) <
              receipt.request.generation - 1
            : Number(current.current_generation) !==
              receipt.request.generation - 1) ||
          current.loader_epoch !== expectedLoaderEpoch
        )
          throw new Error('Native realm generation changed before publication');
        checked.add(realmKey);
      }
      await checkFiles(tx, files, checked);
      await checkModules(tx, modules, checked);
    };
  }

  return async (request) => {
    // Every gate below refuses silently (Chrome fallback). With
    // LATTICE_NATIVE_ADMISSION_DEBUG set, name the gate that refused.
    const refuse = (gate: string) => {
      if (process.env.LATTICE_NATIVE_ADMISSION_DEBUG)
        console.warn(`native admission refused ${request.url}: ${gate}`);
      return undefined;
    };
    let policy = reviewed.find((item) => item.realmURL === request.realmURL);
    if (
      !policy ||
      policy.noScreenshotThumbnail !== true ||
      policy.runtimeRevision !== runtimeRevision()
    )
      return refuse('line 391');
    if (Buffer.byteLength(request.sourceJSON) > 1_048_576)
      return refuse('line 392');
    let rootRef: ResolvedCodeRef;
    if (mode === 'card') {
      let source;
      try {
        source = JSON.parse(request.sourceJSON);
      } catch {
        return refuse('line 399');
      }
      const adopted = source?.data?.meta?.adoptsFrom;
      if (
        typeof adopted?.module !== 'string' ||
        typeof adopted.name !== 'string'
      )
        return refuse('line 406');
      rootRef = {
        module: network.resolveURL(adopted.module, request.url).href,
        name: adopted.name,
      } as ResolvedCodeRef;
      if (!policy.roots.some((ref) => sameRef(ref, rootRef)))
        return refuse('line 411');
    } else {
      if (!request.fileDefCodeRef || request.inputSnapshot)
        return refuse('line 413');
      const extractor = policy.fileExtractors?.find(
        (item) =>
          item.kind === 'base-gts' &&
          sameRef(item.codeRef, request.fileDefCodeRef!),
      );
      if (!extractor?.moduleURLs?.length || !request.url.endsWith('.gts'))
        return refuse('line 420');
      if (
        new Set(extractor.moduleURLs).size !== extractor.moduleURLs.length ||
        extractor.moduleURLs.some(
          (url) => !policy!.modules.some((item) => item.url === url),
        )
      )
        return refuse('line 427');
      // This closure reviews the trusted FileDef implementation only. Changes
      // to the analyzed application source do not withdraw analysis eligibility.
      policy = {
        ...policy,
        modules: policy.modules.filter((item) =>
          extractor.moduleURLs!.includes(item.url),
        ),
        definitions: policy.definitions.filter((item) =>
          extractor.moduleURLs!.includes(item.moduleURL),
        ),
      };
      rootRef = request.fileDefCodeRef;
    }
    let codeCheck: LatticeCodeAdmission | undefined;
    if (mode === 'card' && policy.codeLinking) {
      const definition = policy.definitions.find((item) =>
        sameRef(item.codeRef, rootRef),
      );
      const module = policy.modules.find(
        (item) => item.url === definition?.moduleURL,
      );
      // Cross-realm roots retain the browser path until code authority can be
      // shared explicitly between the consumer and defining realm policies.
      if (!module || module.realmURL !== policy.realmURL)
        return refuse('line 451');
      codeCheck = await readLatticeCodeAdmission(
        db,
        policy,
        new RealmPaths(new URL(module.realmURL)).fileURL(module.sourcePath)
          .href,
        rootRef.name,
      );
      if (!codeCheck) return refuse('line 459');
    }
    // Review-size bound: the Nucleus copy realm reviews 58 modules / 128
    // definitions for six native roots (was 32 / 128).
    if (policy.modules.length > 256 || policy.definitions.length > 1024)
      return refuse('line 462');
    const path = new RealmPaths(new URL(policy.realmURL), network).local(
      new URL(request.url),
    );
    const actor = await permission(policy.realmURL, policy.actorUserId);
    if (!actor) return refuse('line 467');
    const permissions = new Map([
      [JSON.stringify([actor.realm_url, actor.username]), actor],
    ]);
    const sourceReceipt = await readFile(
      policy.realmURL,
      path,
      mode === 'card' && request.inputSnapshot ? request.url : undefined,
    );
    const preparedSource =
      mode === 'card' && sourceReceipt
        ? prepareLatticeJsonSource(
            request.sourceJSON,
            sourceReceipt,
            sourceReceipt.source_fingerprint,
          )
        : undefined;
    if (
      !sourceReceipt ||
      (mode === 'card'
        ? !preparedSource
        : sourceReceipt.content_hash !== md5(request.sourceJSON) ||
          sourceReceipt.content_size !== Buffer.byteLength(request.sourceJSON))
    )
      return refuse(
        `source bytes differ from realm_file_meta (stored ${sourceReceipt?.content_hash}/${sourceReceipt?.content_size}, read ${md5(request.sourceJSON)}/${Buffer.byteLength(request.sourceJSON)})`,
      );
    const [realm] = await query(db, [
      'SELECT current_generation,loader_epoch FROM realm_generations WHERE realm_url =',
      param(policy.realmURL),
    ]);
    if (
      !realm ||
      Number(realm.current_generation) !== request.generation - 1 ||
      typeof realm.loader_epoch !== 'string' ||
      (mode === 'card' && realm.loader_epoch !== request.loaderEpoch)
    )
      return refuse('line 488');

    const files: FileReceipt[] = [sourceReceipt];
    const modules: ModuleReceipt[] = [];
    const definitions = new Map<
      string,
      { definition: Definition; revision: string }
    >();
    if (
      policy.modules.some(
        (module) =>
          !module.sourceMD5 ||
          (module.cacheScope === 'public'
            ? module.authUserId !== ''
            : module.cacheScope !== 'realm-auth' ||
              module.authUserId !== policy.actorUserId),
      )
    )
      return refuse('line 506');
    // Read all reviewed code receipts together, without selecting any JSON
    // columns. A per-module round trip dominated the warm BATS admission cost.
    const moduleRows = await query(db, [
      `SELECT m.url,m.resolved_realm_url AS realm_url,m.cache_scope,m.auth_user_id,
         m.xmin::text AS version,f.file_path,f.xmin::text AS file_version,
         f.content_hash,f.content_size,p.username,p.xmin::text AS permission_version,
         r.xmin::text AS metadata_version,b.xmin::text AS bootstrap_version
       FROM jsonb_to_recordset(`,
      param(
        JSON.stringify(
          policy.modules.map((module) => ({
            url: module.url,
            realm_url: module.realmURL,
            cache_scope: module.cacheScope,
            auth_user_id: module.authUserId,
            file_path: module.sourcePath,
            content_hash:
              codeCheck?.moduleHashes.get(module.url) ?? module.sourceMD5,
            username: module.cacheScope === 'public' ? '*' : module.authUserId,
          })),
        ),
      ),
      `::jsonb) AS e(url text,realm_url text,cache_scope text,auth_user_id text,
         file_path text,content_hash text,username text)
       JOIN modules m ON m.url_hash=md5(e.url) AND m.url=e.url
         AND m.resolved_realm_url=e.realm_url AND m.cache_scope=e.cache_scope AND m.auth_user_id=e.auth_user_id
       JOIN realm_file_meta f ON f.realm_url=e.realm_url AND f.file_path=e.file_path
         AND f.content_hash=e.content_hash AND f.content_size IS NOT NULL
       JOIN realm_user_permissions p ON p.realm_url=e.realm_url AND p.username=e.username AND p.read=TRUE
       LEFT JOIN realm_metadata r ON r.url=e.realm_url
       LEFT JOIN realm_registry b ON b.url=e.realm_url AND b.kind='bootstrap' AND r.url IS NULL
       WHERE m.error_doc IS NULL AND r.archived_at IS NULL
         AND (r.url IS NOT NULL OR b.url IS NOT NULL)`,
    ]);
    if (moduleRows.length !== policy.modules.length)
      return refuse(
        'reviewed module source, cache, read grant or realm authority is missing or changed',
      );
    for (const module of policy.modules) {
      const row = moduleRows.find(
        (row) =>
          row.url === module.url &&
          row.realm_url === module.realmURL &&
          row.cache_scope === module.cacheScope &&
          row.auth_user_id === module.authUserId &&
          row.file_path === module.sourcePath,
      );
      if (!row || typeof row.version !== 'string') return refuse('line 548');
      const grant: PermissionReceipt = {
        realm_url: module.realmURL,
        username: String(row.username),
        version: String(row.permission_version),
        metadata_version:
          row.metadata_version == null ? null : String(row.metadata_version),
        bootstrap_version:
          row.bootstrap_version == null ? null : String(row.bootstrap_version),
      };
      permissions.set(JSON.stringify([grant.realm_url, grant.username]), grant);
      files.push({
        realm_url: module.realmURL,
        file_path: module.sourcePath,
        version: String(row.file_version),
        content_hash: String(row.content_hash),
        content_size: Number(row.content_size),
      });
      const predicate = [
        'resolved_realm_url =',
        param(module.realmURL),
        'AND cache_scope =',
        param(module.cacheScope),
        'AND auth_user_id =',
        param(module.authUserId),
        'AND url_hash =',
        param(md5(module.url)),
        'AND url =',
        param(module.url),
        'AND error_doc IS NULL',
      ];
      const version = row.version;
      modules.push({
        realm_url: module.realmURL,
        url: module.url,
        cache_scope: module.cacheScope,
        auth_user_id: module.authUserId,
        version,
      });
      for (const def of policy.definitions.filter(
        (def) => def.moduleURL === module.url,
      )) {
        const key = moduleKey(module) + ':' + def.cacheKey;
        let cached = cache.get(key);
        if (!cached || cached.version !== version) {
          // Project one definition and bound it in SQL before the pg driver
          // sees JSON. No SELECT * or whole-module definition graph per card.
          const [payload] = await query(
            db,
            [
              'SELECT definitions ->',
              param(def.cacheKey),
              'AS entry FROM modules WHERE',
              ...predicate,
              'AND xmin::text =',
              param(version),
              'AND octet_length((definitions ->',
              param(def.cacheKey),
              ')::text) <= 1048576',
            ],
            { entry: 'JSON' },
          );
          const entry = payload?.entry as
            | { type?: string; definition?: Definition }
            | undefined;
          if (
            entry?.type !== 'definition' ||
            !entry.definition ||
            !sameRef(entry.definition.codeRef, def.codeRef)
          )
            return refuse('line 615');
          cached = {
            version,
            definition: entry.definition,
            digest: latticeDefinitionDigest(entry.definition),
          };
          if (cache.size >= 128) cache.delete(cache.keys().next().value!);
          cache.set(key, cached);
        }
        if (cached.digest !== def.definitionSHA256) return refuse('line 624');
        definitions.set(key, {
          definition: cached.definition,
          revision: def.definitionSHA256,
        });
      }
    }
    // A `fieldOf` reference (a field typed by another definition's field, as
    // an inline enum field is) resolves through that holder's reviewed
    // definition; `ancestorOf` is not admitted (no reviewed definition names
    // its parent).
    const findDefinition = (
      ref: CodeRef,
      depth = 0,
    ):
      | (typeof definitions extends Map<string, infer V> ? V : never)
      | undefined => {
      if (depth > 8) return undefined;
      if ('type' in ref && ref.type === 'fieldOf') {
        const holder = findDefinition(ref.card, depth + 1);
        const key = holder?.definition.fields[ref.field];
        const field = key ? holder!.definition.fieldDefs[key] : undefined;
        return field ? findDefinition(field.fieldOrCard, depth + 1) : undefined;
      }
      return [...definitions.values()].find((item) =>
        sameRef(item.definition.codeRef, ref),
      );
    };
    const root = findDefinition(rootRef);
    if (!root) return refuse('line 636');
    let file: LatticeNativeFileAdmission | undefined;
    const extractor =
      !request.inputSnapshot && request.fileDefCodeRef
        ? policy.fileExtractors?.find(
            (item) =>
              item.kind === (mode === 'file' ? 'base-gts' : 'base-json') &&
              sameRef(item.codeRef, request.fileDefCodeRef!),
          )
        : undefined;
    if (!extractor && process.env.LATTICE_NATIVE_ADMISSION_DEBUG)
      console.warn(
        `native file admission for ${request.url}: no ${mode === 'file' ? 'base-gts' : 'base-json'} extractor for ${JSON.stringify(request.fileDefCodeRef)} (inputSnapshot=${Boolean(request.inputSnapshot)})`,
      );
    if (extractor) {
      const snapshot = findDefinition(extractor.codeRef);
      const metadata = snapshot?.definition.nativeFileIndex;
      const reviewedDefinition = policy.definitions.find((item) =>
        sameRef(item.codeRef, extractor.codeRef),
      );
      const module = policy.modules.find(
        (item) => item.url === reviewedDefinition?.moduleURL,
      );
      const receipt = module && modules.find((item) => item.url === module.url);
      if (process.env.LATTICE_NATIVE_ADMISSION_DEBUG)
        console.warn(
          `native file admission for ${request.url}: extractor=${extractor.kind} snapshot=${snapshot?.definition.type} metadata=${Boolean(metadata)} icon=${Boolean(metadata?.staticIcon?.svg)} types=${metadata?.types.length} names=${metadata?.displayNames.length} module=${Boolean(module)} receipt=${Boolean(receipt)}`,
        );
      if (
        snapshot?.definition.type === 'file-def' &&
        metadata &&
        (mode === 'file' || metadata.staticIcon?.svg) &&
        metadata.types.length &&
        metadata.displayNames.length &&
        module &&
        receipt
      ) {
        // Reuse the ordinary module's dependency list, including its icon,
        // without traversing definitions or loading code. xmin binds this list
        // to the exact module revision checked in the publication transaction.
        const [row] = await query(
          db,
          [
            'SELECT deps FROM modules WHERE octet_length(deps::text) <= 1048576 AND url =',
            param(module.url),
            'AND resolved_realm_url =',
            param(module.realmURL),
            'AND cache_scope =',
            param(module.cacheScope),
            'AND auth_user_id =',
            param(module.authUserId),
            'AND xmin::text =',
            param(receipt.version),
          ],
          { deps: 'JSON' },
        );
        if (
          Array.isArray(row?.deps) &&
          row.deps.every((dep: unknown) => typeof dep === 'string')
        ) {
          file = {
            kind: extractor.kind,
            snapshot,
            contentHash: sourceReceipt.content_hash,
            contentSize: sourceReceipt.content_size,
            deps: [
              ...new Set([
                request.fileDefCodeRef!.module,
                ...row.deps,
                network.resolveURL('@cardstack/base/file-api', undefined).href,
              ]),
            ],
          };
        }
      }
    }
    const expectedDefinitions = [...definitions.values()].map((item) => ({
      codeRef: item.definition.codeRef,
      revision: item.revision,
    }));
    const sourceSHA256 =
      preparedSource?.fingerprint.digest ??
      createHash('sha256').update(request.sourceJSON).digest('hex');
    const requestIdentity = {
      url: request.url,
      realmURL: request.realmURL,
      generation: request.generation,
      loaderEpoch: request.loaderEpoch,
    };
    return {
      root,
      ...(preparedSource ? { preparedSource } : {}),
      lookup: async (ref) => {
        const found = findDefinition(ref);
        if (!found)
          throw new Error(
            `Contained definition is outside native review: ${'module' in ref ? `${ref.module}/${ref.name}` : JSON.stringify(ref)}`,
          );
        return found;
      },
      resolve: (ref, base) => network.resolveURL(ref, base).href,
      relative: (ref, id) =>
        ref.startsWith('@')
          ? ref
          : maybeRelativeReference(
              network.resolveURL(ref, id),
              network.toURL(id),
              new URL(policy.realmURL),
            ),
      typeKey: (ref) => internalKeyFor(ref, undefined, network),
      deps: network.unresolveURLs(policy.modules.map((module) => module.url)),
      runtimeRevision: policy.runtimeRevision,
      inputActor: policy.actorUserId,
      ...(codeCheck?.coversReview
        ? { codeReference: codeCheck.reference }
        : {}),
      ...(file ? { file } : {}),
      assertCurrent: publicationCheck({
        requestIdentity,
        // Source indexing is fenced by exact file/module receipts. A stale
        // computation also keeps its input frame and dirty obligation; only
        // ordinary computations require an unchanged realm clock.
        allowGenerationAdvance:
          !request.inputSnapshot || Boolean(request.inputSnapshot.stale),
        sourceSHA256,
        expectedDefinitions,
        // A GTS edit mints the output epoch before it is committed. Analysis
        // reads source bytes, so it fences the existing epoch without requiring
        // the future epoch to be published already. Card execution is unchanged.
        expectedLoaderEpoch: realm.loader_epoch as string,
        permissions: [...permissions.values()],
        files,
        modules,
        codeCheck,
      }),
    };
  };
}
