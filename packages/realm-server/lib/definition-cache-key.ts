import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';
import { executableExtensions, logger, param } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';

const log = logger('realm-server:definition-cache-key');

// The boot key decides whether the modules table (cached definitions) can
// outlive a restart. Definitions are derived by running a module in the host
// app, so a cached row is still right after a restart exactly when nothing
// that went into deriving it changed: the host app that ran it, the
// transpiler that compiled it, the shape of a definition, the server build,
// and the bootstrap realms' modules that every user module ultimately
// imports. The key is a digest over those inputs; a boot whose key matches
// the stored one keeps the table (dropping only error rows), and any other
// boot clears it, as every boot used to.
//
// User-realm modules are not part of the key: a change to one invalidates
// its own rows at write time, and the rows of the modules that import it.

// Constant, arbitrarily chosen, stable across deployments. Serializes the
// compare-and-clear between processes booting against the same database, so
// a peer never reads the new key before the clear that goes with it ran.
export const DEFINITION_CACHE_KEY_LOCK_ID = 7331012;

export interface DefinitionCacheKeyInputs {
  // A digest of the host shell (index.html) the realm server serves. Deployed
  // host builds fingerprint their assets, so a new host build moves it.
  hostShellHash: string;
  transpileVersion: number;
  definitionCacheVersion: number;
  // A deploy-supplied identifier of the server build, when one is set. Covers
  // a change to the realm server or prerenderer that moves neither the host
  // shell nor a bootstrap module.
  buildSha?: string;
  // A digest of the bootstrap realms' module sources (see
  // `digestBootstrapRealmModules`).
  bootstrapModulesDigest: string;
}

export function computeDefinitionCacheKey(
  inputs: DefinitionCacheKeyInputs,
): string {
  return createHash('md5')
    .update(
      JSON.stringify([
        inputs.hostShellHash,
        inputs.transpileVersion,
        inputs.definitionCacheVersion,
        inputs.buildSha ?? null,
        inputs.bootstrapModulesDigest,
      ]),
    )
    .digest('hex');
}

// A digest of every executable file in the given realm directories, by path
// and content. Content rather than mtime: an image build or a fresh checkout
// rewrites every mtime without changing what any module does.
export async function digestBootstrapRealmModules(
  realmPaths: string[],
): Promise<string> {
  let hash = createHash('md5');
  for (let [index, realmPath] of realmPaths.entries()) {
    hash.update(`realm:${index}\0`);
    let files = await executableFilesUnder(realmPath);
    for (let file of files) {
      hash.update(`${relative(realmPath, file)}\0`);
      hash.update(
        createHash('md5')
          .update(await readFile(file))
          .digest('hex'),
      );
      hash.update('\0');
    }
  }
  return hash.digest('hex');
}

async function executableFilesUnder(root: string): Promise<string[]> {
  let found: string[] = [];
  let walk = async (dir: string) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e: any) {
      if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') {
        return;
      }
      throw e;
    }
    for (let entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }
      let full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (
        entry.isFile() &&
        executableExtensions.some((ext) => entry.name.endsWith(ext))
      ) {
        found.push(full);
      }
    }
  };
  await walk(root);
  return found.sort();
}

// What a boot does with the modules table.
//   - 'keep-if-unchanged': compare the boot key; keep the table on a match.
//   - 'clear': clear it unconditionally (the behavior before the boot key).
//   - 'skip': leave it alone entirely, error rows included.
export type DefinitionCacheStartupMode = 'keep-if-unchanged' | 'clear' | 'skip';

// Resolves the startup mode from the environment.
//   1. `REALM_SERVER_SKIP_MODULES_CACHE_CLEAR_ON_STARTUP=true` → 'skip'
//      (the existing opt-out, used by harnesses that restore a known-good
//      modules table).
//   2. `REALM_SERVER_DEFINITION_CACHE_ON_STARTUP`, when it names a mode.
//   3. Otherwise 'keep-if-unchanged' on a deployed server URL and 'clear'
//      elsewhere: a dev host shell is served unfingerprinted, so a host
//      rebuild need not move its hash, and a dev server keeps clearing.
export function definitionCacheStartupMode(
  env: Record<string, string | undefined>,
  deployed: boolean,
): DefinitionCacheStartupMode {
  if (env.REALM_SERVER_SKIP_MODULES_CACHE_CLEAR_ON_STARTUP === 'true') {
    return 'skip';
  }
  let explicit = env.REALM_SERVER_DEFINITION_CACHE_ON_STARTUP;
  if (
    explicit === 'keep-if-unchanged' ||
    explicit === 'clear' ||
    explicit === 'skip'
  ) {
    return explicit;
  }
  if (explicit) {
    log.warn(
      `ignoring unknown REALM_SERVER_DEFINITION_CACHE_ON_STARTUP=${explicit}`,
    );
  }
  return deployed ? 'keep-if-unchanged' : 'clear';
}

// The build identifier folded into the key: the deploy-supplied
// `REALM_SERVER_BUILD_SHA` when set; on a server that isn't deployed, the
// checkout's HEAD, so a dev server opted into keeping its definitions still
// clears across a commit.
export function resolveBuildSha(
  env: Record<string, string | undefined>,
  deployed: boolean,
): string | undefined {
  if (env.REALM_SERVER_BUILD_SHA) {
    return env.REALM_SERVER_BUILD_SHA;
  }
  if (deployed) {
    return undefined;
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

export type DefinitionCacheBootOutcome =
  | { outcome: 'kept'; key: string; errorRowsDropped: number }
  | {
      outcome: 'cleared';
      key: string | undefined;
      previousKey?: string;
      // Set when the key was unchanged and the clear was the deploy's: see
      // `afterDeployment`.
      deployChangedKey?: true;
    }
  | { outcome: 'skipped' };

export interface ReconcileDefinitionCacheArgs {
  dbAdapter: PgAdapter;
  definitionLookup: { clearAllDefinitions(): Promise<void> };
  mode: DefinitionCacheStartupMode;
  // Computes the current key. Undefined, or a throw, means it could not be
  // computed, and the table is cleared, as before the boot key.
  computeKey: () => Promise<string | undefined>;
  // Run from the post-deployment hook rather than at boot. A rolling deploy
  // keeps old-build tasks serving until the deploy is stable, so after a
  // deploy that changed the key they may have written rows derived under the
  // old inputs since the new tasks' boot cleared the table. The first check
  // after the key changed therefore clears once more, as the hook always
  // did; a deploy that left the key alone keeps the table.
  afterDeployment?: boolean;
}

// Keeps the modules table across a restart when the boot key is unchanged,
// and clears it otherwise. Runs under a session advisory lock on a pinned
// connection, so concurrent boots against one database serialize: the first
// clears and stores the new key, and the ones behind it see the match.
export async function reconcileDefinitionCacheOnBoot({
  dbAdapter,
  definitionLookup,
  mode,
  computeKey,
  afterDeployment,
}: ReconcileDefinitionCacheArgs): Promise<DefinitionCacheBootOutcome> {
  if (mode === 'skip') {
    log.info('leaving the modules table as is (opted out via env)');
    return { outcome: 'skipped' };
  }
  let key: string | undefined;
  if (mode === 'keep-if-unchanged') {
    try {
      key = await computeKey();
    } catch (e: any) {
      log.warn(
        `could not compute the definition cache key; clearing: ${e?.message ?? e}`,
      );
    }
  }
  return await dbAdapter.withConnection(async (queryFn) => {
    await queryFn([
      `SELECT pg_advisory_lock(`,
      param(DEFINITION_CACHE_KEY_LOCK_ID),
      `)`,
    ]);
    try {
      let rows = (await queryFn([
        `SELECT key, set_at, settled_set_at FROM definition_cache_key WHERE id = 1`,
      ])) as {
        key: string;
        set_at: string | number;
        settled_set_at: string | number | null;
      }[];
      let previous = rows[0];
      let previousKey = previous?.key;
      let now = Date.now();
      // The hook settles the key it saw: a later hook clears only when the
      // key changed again after that.
      let stampDeployment = async () => {
        if (afterDeployment) {
          await queryFn([
            `UPDATE definition_cache_key SET settled_set_at = set_at WHERE id = 1`,
          ]);
        }
      };
      if (key && previousKey === key) {
        if (
          afterDeployment &&
          (previous.settled_set_at == null ||
            Number(previous.settled_set_at) !== Number(previous.set_at))
        ) {
          log.info(
            `the deploy changed the definition cache key (${key}); clearing the modules table once more after it`,
          );
          await definitionLookup.clearAllDefinitions();
          await stampDeployment();
          return {
            outcome: 'cleared' as const,
            key,
            previousKey,
            deployChangedKey: true as const,
          };
        }
        // A boot is the one moment an error row can be retried without a
        // request paying for it, and an error recorded under the previous
        // process (a render timeout, a prerenderer that was going away) is
        // as likely to be about that process as about the module.
        let dropped = (await queryFn([
          `DELETE FROM modules WHERE error_doc IS NOT NULL RETURNING url`,
        ])) as { url: string }[];
        await stampDeployment();
        log.info(
          `definition cache key unchanged (${key}); kept the modules table, dropped ${dropped.length} error row(s)`,
        );
        return {
          outcome: 'kept' as const,
          key,
          errorRowsDropped: dropped.length,
        };
      }
      log.info(
        key
          ? `definition cache key changed (${previousKey ?? 'none'} → ${key}); clearing the modules table`
          : 'clearing the modules table',
      );
      await definitionLookup.clearAllDefinitions();
      if (key) {
        await queryFn([
          `INSERT INTO definition_cache_key (id, key, set_at) VALUES (1,`,
          param(key),
          `,`,
          param(now),
          `) ON CONFLICT (id) DO UPDATE SET key = excluded.key, set_at = excluded.set_at`,
        ]);
        await stampDeployment();
      } else {
        // A clear without a key must not leave a stale key behind: a later
        // boot whose key happens to equal it would keep rows derived under
        // whatever this boot could not fingerprint.
        await queryFn([`DELETE FROM definition_cache_key WHERE id = 1`]);
      }
      return { outcome: 'cleared' as const, key, previousKey };
    } finally {
      try {
        await queryFn([
          `SELECT pg_advisory_unlock(`,
          param(DEFINITION_CACHE_KEY_LOCK_ID),
          `)`,
        ]);
      } catch (err: unknown) {
        log.warn(
          `failed to release the definition cache key advisory lock: ${String(err)}`,
        );
      }
    }
  });
}
