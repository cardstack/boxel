import { createHash } from 'node:crypto';
import {
  RealmPaths,
  type DBAdapter,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  param,
  query,
  textArrayParam,
  type Querier,
} from '@cardstack/runtime-common/expression';
import {
  linkLatticeGtsDefinition,
  type LatticeGtsLinkInput,
  type LatticeGtsCodeReceipt,
} from '@cardstack/runtime-common/lattice-gts-link';
import type { LatticeGtsAnalysis } from '@cardstack/runtime-common/lattice-gts-analysis-contract';
import {
  LATTICE_GTS_ANALYZER_REVISION,
  LATTICE_GTS_DATA_REVISION_ALGORITHM,
} from '@cardstack/runtime-common/lattice-gts-analysis-contract';
import type { LatticeCodeLinker } from '@cardstack/runtime-common/jobs/lattice-code';
import type { LatticeNativeRealmPolicy } from './lattice-postgres-admission.ts';
import { assertLatticeCodePolicy } from './lattice-code-admission.ts';
import { enqueueLattice } from '@cardstack/runtime-common/jobs/lattice';

interface Scope {
  realm: string;
  file: string;
  path: string;
  key: string;
  username: string;
  permission: string;
  metadata: string;
  source: string | null;
  index: string | null;
  hash: string | null;
  size: number | null;
}

class Superseded extends Error {}
class UnavailableCode extends Error {}

// Installed only in the separate Node worker process. Source bytes stay behind
// the realm API; this processor reads only already-published file analysis.
export function createLatticeCodeWorker({
  db,
  network,
  policies,
  runtimeRevision,
}: {
  db: DBAdapter;
  network: VirtualNetwork;
  policies: LatticeNativeRealmPolicy[];
  runtimeRevision(): string;
}): LatticeCodeLinker {
  const reviewed = structuredClone(policies);
  return async ({ realmURL, realmUsername }) => {
    if (db.kind !== 'pg') throw new Error('Code linking requires PostgreSQL');
    const policy = reviewed.find((item) => item.realmURL === realmURL);
    if (!policy || policy.runtimeRevision !== runtimeRevision())
      throw new Error('Code linking requires a current realm processor policy');
    await assertLatticeCodePolicy(
      (expression) => query(db, expression),
      policy,
    );
    const work = await query(db, [
      'SELECT file_url,work_version FROM lattice_code_artifacts WHERE realm_url=',
      param(realmURL),
      'AND realm_username=',
      param(realmUsername),
      'AND dirty=TRUE ORDER BY file_url LIMIT 16',
    ]);
    let published = 0,
      superseded = 0;
    for (const item of work) {
      const fileURL = String(item.file_url);
      const version = String(item.work_version);
      const scope = new Map<string, Scope>();
      const cache = new Map<string, LatticeGtsLinkInput | undefined>();
      const keys = new Set<string>();
      let totalBytes = 0;
      const identity = [
        'realm_url=',
        param(realmURL),
        'AND file_url=',
        param(fileURL),
        'AND realm_username=',
        param(realmUsername),
        'AND work_version=',
        param(version),
        'AND dirty=TRUE',
      ];

      // Subscribe before reading a dependency. This also fences missing rows:
      // an insertion between final checks and commit increments work_version.
      const subscribe = async (key: string) => {
        if (keys.has(key)) return;
        if (keys.size >= 128)
          throw new Error('Code dependency subscription budget exceeded');
        const changed = await query(db, [
          `UPDATE lattice_code_artifacts SET dependency_keys=CASE WHEN dependency_keys ?`,
          param(key),
          `THEN dependency_keys ELSE dependency_keys || jsonb_build_array(`,
          param(key),
          '::text) END WHERE',
          ...identity,
          'RETURNING work_version',
        ]);
        if (!changed.length)
          throw new Superseded('Code obligation changed before input capture');
        keys.add(key);
      };

      const readFile = async (url: string, needsAnalysis = true) => {
        const [realm] = await query(db, [
          'SELECT url FROM realm_metadata WHERE left(',
          param(url),
          ',length(url))=url ORDER BY length(url) DESC LIMIT 1',
        ]);
        if (!realm)
          throw new UnavailableCode(
            `No indexed realm for code dependency ${url}`,
          );
        const targetRealm = String(realm.url);
        const path = new RealmPaths(new URL(targetRealm)).local(new URL(url));
        const [keyRow] = await query(db, [
          'SELECT lattice_code_file_key(',
          param(targetRealm),
          ',',
          param(path),
          ') AS key',
        ]);
        const key = String(keyRow.key);
        await subscribe(key);
        const [row] = await query(
          db,
          [
            `SELECT p.username,p.xmin::text AS permission,r.xmin::text AS metadata,
            f.xmin::text AS source,i.xmin::text AS index,f.content_hash AS hash,f.content_size AS size,
            i.has_error,i.is_deleted,`,
            ...(needsAnalysis
              ? [
                  `CASE WHEN octet_length((i.pristine_doc->'attributes'->'latticeAnalysis')::text)<=1048576
             THEN i.pristine_doc->'attributes'->'latticeAnalysis' END AS analysis,
             octet_length((i.pristine_doc->'attributes'->'latticeAnalysis')::text) AS bytes`,
                ]
              : ['NULL AS analysis,0 AS bytes']),
            `FROM realm_metadata r JOIN realm_user_permissions p ON p.realm_url=r.url
           LEFT JOIN realm_file_meta f ON f.realm_url=r.url AND f.file_path=`,
            param(path),
            `LEFT JOIN boxel_index i ON i.realm_url=r.url AND i.url=`,
            param(url),
            `AND i.type='file'
           WHERE r.url=`,
            param(targetRealm),
            `AND r.archived_at IS NULL AND p.read=TRUE
           AND p.username IN (`,
            param(policy!.actorUserId),
            `,'*')
           ORDER BY (p.username=`,
            param(policy!.actorUserId),
            ') DESC LIMIT 1',
          ],
          { analysis: 'JSON' },
        );
        if (!row)
          throw new UnavailableCode(`No authorized code dependency ${url}`);
        const stamp: Scope = {
          realm: targetRealm,
          file: url,
          path,
          key,
          username: String(row.username),
          permission: String(row.permission),
          metadata: String(row.metadata),
          source: row.source == null ? null : String(row.source),
          index: row.index == null ? null : String(row.index),
          hash: row.hash == null ? null : String(row.hash),
          size: row.size == null ? null : Number(row.size),
        };
        const previous = scope.get(url);
        if (previous && JSON.stringify(previous) !== JSON.stringify(stamp))
          throw new Superseded('Code input changed during linking');
        scope.set(url, stamp);
        totalBytes += Number(row.bytes ?? 0);
        if (Number(row.bytes ?? 0) > 1_048_576 || totalBytes > 8_388_608)
          throw new Error('Code artifact input exceeds its byte budget');
        return {
          stamp,
          analysis:
            row.has_error || row.is_deleted
              ? undefined
              : (row.analysis as unknown as LatticeGtsAnalysis | undefined),
        };
      };

      const readAvailable = async (
        module: string,
        relativeTo: string,
      ): Promise<LatticeGtsLinkInput | undefined> => {
        if (module === '@cardstack/bxl')
          return {
            kind: 'trusted',
            fileId: '@cardstack/bxl',
            revision: policy!.runtimeRevision,
            exports: ['bxl', 'expression', 'expr'],
          };
        // Database identities use the realm URL, not its private HTTP transport.
        const moduleURL = network.resolveURL(module, relativeTo).href;
        const url = /\.(gts|ts|js|gjs)$/.test(moduleURL)
          ? moduleURL
          : `${moduleURL}.gts`;
        if (cache.has(url)) return cache.get(url);
        const bootstrap = policy!.codeLinking?.trustedModules.find(
          (candidate) =>
            network
              .resolveURL(candidate.moduleURL, undefined)
              .href.replace(/\.gts$/, '') === moduleURL.replace(/\.gts$/, ''),
        );
        let input: LatticeGtsLinkInput | undefined;
        if (bootstrap) {
          if (!bootstrap.moduleURLs.length || bootstrap.moduleURLs.length > 32)
            throw new Error(
              'Trusted code needs a bounded implementation closure',
            );
          const stamps: string[] = [];
          for (const ref of bootstrap.moduleURLs) {
            const expected = policy!.modules.find(
              (candidate) => candidate.url === ref,
            );
            if (!expected) throw new Error('Unreviewed bootstrap dependency');
            const sourceURL = new RealmPaths(
              new URL(expected.realmURL),
            ).fileURL(expected.sourcePath).href;
            const { stamp, analysis } = await readFile(
              sourceURL,
              Boolean(expected.dataRevision),
            );
            if (expected.dataRevision) {
              // This is a bounded reviewed data module, not permission to run
              // its JavaScript. Every exported declaration must be declarative;
              // source freshness remains independently fenced by checkCodeScope.
              if (
                expected.dataRevision.algorithm !==
                  LATTICE_GTS_DATA_REVISION_ALGORITHM ||
                analysis?.analyzerRevision !== LATTICE_GTS_ANALYZER_REVISION ||
                analysis.state !== 'analyzed' ||
                analysis.fileId !== sourceURL ||
                analysis.sourceRevision.digest !== stamp.hash ||
                analysis.dataRevision?.algorithm !==
                  expected.dataRevision.algorithm ||
                analysis.dataRevision?.digest !==
                  expected.dataRevision.digest ||
                !analysis.exports.length ||
                analysis.diagnostics.length ||
                [...analysis.exports, ...analysis.localDefinitions].some(
                  (item) => item.indexing !== 'requires-linking',
                ) ||
                (sourceURL === url &&
                  bootstrap.exports.some(
                    (name) =>
                      !analysis.exports.some((item) => item.name === name),
                  ))
              )
                return undefined;
              stamps.push(JSON.stringify([sourceURL, expected.dataRevision]));
            } else {
              if (stamp.hash !== expected.sourceMD5)
                throw new Error('Bootstrap source changed');
              stamps.push(JSON.stringify([sourceURL, stamp.hash]));
            }
          }
          // Include the exported implementation itself, not only helpers.
          if (!scope.has(url))
            throw new Error('Bootstrap closure omits its exported source');
          input = {
            kind: 'trusted',
            fileId: url,
            exports: bootstrap.exports,
            revision: createHash('sha256')
              .update(JSON.stringify([policy!.runtimeRevision, stamps.sort()]))
              .digest('hex'),
          };
        } else {
          const { stamp, analysis } = await readFile(url);
          if (
            analysis &&
            stamp.hash &&
            stamp.size != null &&
            stamp.size <= 1_048_576
          ) {
            if (analysis.fileId !== url)
              throw new Error('Analysis belongs to a different file identity');
            input = {
              kind: 'source',
              analysis,
              currentSourceRevision: {
                algorithm: 'boxel-content-hash-utf8-v1',
                digest: stamp.hash,
              },
            };
          }
        }
        cache.set(url, input);
        return input;
      };

      const read = async (module: string, relativeTo: string) => {
        try {
          return await readAvailable(module, relativeTo);
        } catch (error) {
          // An external or inaccessible import is a normal inability to prove
          // Node eligibility. Persist the linker's blocked result and continue
          // other files; do not fail the whole lane on one unsupported card.
          if (error instanceof UnavailableCode) return undefined;
          throw error;
        }
      };

      try {
        // Root authority itself is required to publish any artifact at all.
        const root = await readAvailable(fileURL, fileURL);
        const exports: Record<string, LatticeGtsCodeReceipt> =
          Object.create(null);
        if (root) {
          // Named exports first; star-only barrels are linked on demand by
          // consumers. Do not load every exported card just to list a barrel.
          for (const name of root.kind === 'source'
            ? root.analysis.exports.map((item) => item.name)
            : root.exports) {
            exports[name] = await linkLatticeGtsDefinition({
              root,
              name,
              runtimeRevision: policy.runtimeRevision,
              read,
            });
          }
        }
        const receipt = JSON.stringify({
          version: 1,
          fileId: fileURL,
          state:
            root?.kind === 'source'
              ? root.analysis.state
              : root
                ? 'analyzed'
                : 'blocked',
          exports,
        });
        if (Buffer.byteLength(receipt) > 1_048_576)
          throw new Error('Linked code output exceeds 1 MiB');
        await db.withWriteLock(`lattice:index:${realmURL}`, async (tx) => {
          if (!tx) throw new Error('Code publication requires a transaction');
          if (policy.runtimeRevision !== runtimeRevision())
            throw new Superseded('Code runtime changed');
          await assertLatticeCodePolicy(tx, policy);
          await checkCodeScope(tx, [...scope.values()]);
          const written = await tx([
            'UPDATE lattice_code_artifacts SET receipt=',
            param(receipt),
            '::jsonb,runtime_revision=',
            param(policy.runtimeRevision),
            ',actor_user_id=',
            param(policy.actorUserId),
            ',scope=',
            param(JSON.stringify([...scope.values()])),
            '::jsonb',
            ',dependency_keys=',
            param(JSON.stringify([...keys].sort())),
            '::jsonb,dirty=FALSE WHERE',
            ...identity,
            'RETURNING file_url',
          ]);
          if (!written.length)
            throw new Superseded('Code publication lost its obligation');
          // Code changes in another realm may not produce a source-index
          // event here. Reconcile direct card consumers in this secondary lane.
          // Equal fingerprints preserve their published data and need no job.
          const affected = await tx([
            `UPDATE lattice_owners o SET dirty_generation=GREATEST(COALESCE(o.dirty_generation,0),g.current_generation)
             FROM lattice_owner_code b,realm_generations g
             WHERE o.realm_url=b.realm_url AND o.owner_url=b.owner_url AND g.realm_url=o.realm_url
               AND NOT o.retired AND b.realm_url=`,
            param(realmURL),
            "AND b.reference->>'fileURL'=",
            param(fileURL),
            'AND NOT lattice_code_reference_current(b.reference) RETURNING o.owner_url',
          ]);
          // Their query watches were derived from the superseded definition,
          // and may name fields it no longer has. Drop them with the value;
          // each owner re-registers from current code when it publishes, and
          // needs no routing meanwhile because it is already dirty.
          if (affected.length)
            await tx([
              'DELETE FROM lattice_query_watches WHERE realm_url=',
              param(realmURL),
              'AND owner_url = ANY(',
              textArrayParam(affected.map((row) => String(row.owner_url))),
              '::text[])',
            ]);
          const waiting = affected.length
            ? affected
            : await tx([
                `SELECT 1 FROM lattice_owners o JOIN lattice_owner_code b ON b.realm_url=o.realm_url AND b.owner_url=o.owner_url
             WHERE o.realm_url=`,
                param(realmURL),
                "AND b.reference->>'fileURL'=",
                param(fileURL),
                'AND NOT o.retired AND o.dirty_generation IS NOT NULL LIMIT 1',
              ]);
          if (waiting.length) await enqueueLattice(tx, realmURL, realmUsername);
          await tx(['NOTIFY lattice_code']);
        });
        published++;
      } catch (error) {
        if (!(error instanceof Superseded)) throw error;
        superseded++;
      }
    }
    // A bounded turn leaves further work durable. An input change queued its
    // own successor; this also covers the 16-file turn boundary.
    if (work.length === 16 || superseded)
      await query(db, [
        'SELECT lattice_enqueue_code_link(',
        param(realmURL),
        ',',
        param(realmUsername),
        ')',
      ]);
    return { published, superseded, processorPid: process.pid };
  };
}

async function checkCodeScope(tx: Querier, scopes: Scope[]) {
  // Match the existing publication lock order: grants, source bytes, then
  // derived index rows. Missing rows are protected by the prior subscription
  // and the final work_version CAS, including concurrent insertion.
  for (const scope of [...scopes].sort((a, b) =>
    a.file.localeCompare(b.file),
  )) {
    const [grant] = await tx([
      `SELECT p.xmin::text AS permission,r.xmin::text AS metadata FROM realm_user_permissions p
       JOIN realm_metadata r ON r.url=p.realm_url WHERE p.realm_url=`,
      param(scope.realm),
      'AND p.username=',
      param(scope.username),
      'AND p.read=TRUE AND r.archived_at IS NULL FOR SHARE OF p,r',
    ]);
    if (
      grant?.permission !== scope.permission ||
      grant?.metadata !== scope.metadata
    )
      throw new Superseded('Code read authority changed');
    const [file] = await tx([
      'SELECT xmin::text AS version FROM realm_file_meta WHERE realm_url=',
      param(scope.realm),
      'AND file_path=',
      param(scope.path),
      'FOR SHARE',
    ]);
    const [index] = await tx([
      'SELECT xmin::text AS version FROM boxel_index WHERE realm_url=',
      param(scope.realm),
      'AND url=',
      param(scope.file),
      "AND type='file' FOR SHARE",
    ]);
    if (
      (file?.version ?? null) !== scope.source ||
      (index?.version ?? null) !== scope.index
    )
      throw new Superseded(
        'Code source or analysis changed before publication',
      );
  }
}
