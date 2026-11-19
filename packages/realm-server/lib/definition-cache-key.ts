import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';
import {
  DEFINITION_CACHE_VERSION,
  executableExtensions,
  logger,
  param,
} from '@cardstack/runtime-common';
import { TRANSPILE_VERSION } from '@cardstack/runtime-common/transpile';
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
// boot clears it.
//
// User-realm modules are not part of the key: a change to one invalidates
// its own rows at write time, and the rows of the modules that import it.
//
// A deployed host shell carries the commit it was built from, and so does a
// deployed image, so every deploy moves the key; what the table outlives is a
// restart within one deploy.
//
// A realm-server build older than the key clears and refills the table at
// boot without touching the stored key, so a later boot whose key matches
// keeps what that build wrote.

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
  // The commit the server was built from, when one is known (see
  // `resolveBuildSha`). Covers a change to the realm server or prerenderer
  // that moves neither the host shell nor a bootstrap module.
  buildSha?: string;
  // A digest of the bootstrap realms' module sources (see
  // `digestBootstrapRealmModules`), when the build has no image commit (see
  // `bootDefinitionCacheKeyInputs`).
  bootstrapModulesDigest?: string;
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
        inputs.bootstrapModulesDigest ?? null,
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

// The build commit folded into the key. A deployed image carries the commit
// it was built from as `BOXEL_COMMIT` (realm-server.Dockerfile). A server
// that isn't deployed uses the checkout's HEAD, so a dev server opted into
// keeping its definitions clears across a commit; the module digest covers
// its uncommitted edits to a bootstrap realm.
export function resolveBuildSha(
  env: Record<string, string | undefined>,
  deployed: boolean,
): string | undefined {
  if (env.BOXEL_COMMIT) {
    return env.BOXEL_COMMIT;
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

export interface BootDefinitionCacheKeySources {
  env: Record<string, string | undefined>;
  deployed: boolean;
  // The host shell (index.html) this server serves.
  getIndexHTML: () => Promise<string>;
  // The bootstrap realms' directories (`--path`).
  bootstrapRealmPaths: string[];
}

// The key inputs for this process. The bootstrap realms' module sources are
// read only when the build has no image commit. An image's commit pins the
// sources the start scripts copy from the image into bootstrap realms, and a
// realm synced through the realm API invalidates its own rows on each write;
// on an image the digest would only re-read every module over the shared
// disk at each boot and hook, and clear the whole table after any module
// write to a writable bootstrap realm.
export async function bootDefinitionCacheKeyInputs({
  env,
  deployed,
  getIndexHTML,
  bootstrapRealmPaths,
}: BootDefinitionCacheKeySources): Promise<DefinitionCacheKeyInputs> {
  let imageCommit = env.BOXEL_COMMIT || undefined;
  return {
    hostShellHash: createHash('md5')
      .update(await getIndexHTML())
      .digest('hex'),
    transpileVersion: TRANSPILE_VERSION,
    definitionCacheVersion: DEFINITION_CACHE_VERSION,
    buildSha: resolveBuildSha(env, deployed),
    bootstrapModulesDigest: imageCommit
      ? undefined
      : await digestBootstrapRealmModules(bootstrapRealmPaths),
  };
}

// What a boot does with the modules table.
//   - 'keep-if-unchanged': compare the boot key; keep the table on a match.
//   - 'clear': clear it unconditionally.
//   - 'skip': leave it alone entirely, error rows included.
export type DefinitionCacheStartupMode = 'keep-if-unchanged' | 'clear' | 'skip';

// Resolves the startup mode from the environment.
//   1. `REALM_SERVER_SKIP_MODULES_CACHE_CLEAR_ON_STARTUP=true` → 'skip'
//      (for harnesses that restore a known-good modules table).
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
  definitionLookup: {
    clearAllDefinitions(): Promise<void>;
    clearErrorDefinitions(): Promise<number>;
  };
  mode: DefinitionCacheStartupMode;
  // Computes the current key. Undefined, or a throw, means it could not be
  // computed, and the table is cleared.
  computeKey: () => Promise<string | undefined>;
  // Run from the post-deployment hook rather than at boot. A rolling deploy
  // keeps old-build tasks serving until the deploy is stable, so after a
  // deploy that changed the key they may have written rows derived under the
  // old inputs since the new tasks' boot cleared the table. The first check
  // after the key changed therefore clears once more; a deploy that left the
  // key alone keeps the table.
  afterDeployment?: boolean;
}

// Keeps the modules table across a restart when the boot key is unchanged,
// and clears it otherwise. Runs under a transaction-scoped advisory lock on a
// pinned connection, so concurrent checks against one database serialize:
// the first clears and stores the new key, and the ones behind it see the
// match. The key row is written in that transaction, so a waiting peer reads
// a new key only after the clear that goes with it, and the commit or
// rollback releases the lock whatever happens in between.
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
    await queryFn(['BEGIN']);
    await queryFn([
      `SELECT pg_advisory_xact_lock(`,
      param(DEFINITION_CACHE_KEY_LOCK_ID),
      `)`,
    ]);
    let rows = (await queryFn([
      `SELECT key, set_at, settled_set_at FROM definition_cache_key WHERE id = 1`,
    ])) as {
      key: string;
      set_at: string | number;
      settled_set_at: string | number | null;
    }[];
    let previous = rows[0];
    let previousKey = previous?.key;
    // The hook settles the key it saw: a later hook clears only when the key
    // changed again after that.
    let stampDeployment = async () => {
      if (afterDeployment) {
        await queryFn([
          `UPDATE definition_cache_key SET settled_set_at = set_at WHERE id = 1`,
        ]);
      }
    };
    let outcome: DefinitionCacheBootOutcome;
    if (
      key &&
      previousKey === key &&
      afterDeployment &&
      (previous.settled_set_at == null ||
        Number(previous.settled_set_at) !== Number(previous.set_at))
    ) {
      log.info(
        `the deploy changed the definition cache key (${key}); clearing the modules table once more after it`,
      );
      await definitionLookup.clearAllDefinitions();
      await stampDeployment();
      outcome = {
        outcome: 'cleared',
        key,
        previousKey,
        deployChangedKey: true,
      };
    } else if (key && previousKey === key) {
      // An error recorded under the previous process (a render timeout, a
      // prerenderer that was going away) is as likely to be about that
      // process as about the module, so a kept table drops its error rows and
      // the next lookup of each module derives it again. A single lookup
      // expires an error row after ERROR_CACHE_TTL_MS, but batch reads and
      // the dependency errors folded into a module's own error read error
      // rows at any age.
      let dropped = await definitionLookup.clearErrorDefinitions();
      await stampDeployment();
      log.info(
        `definition cache key unchanged (${key}); kept the modules table, dropped ${dropped} error row(s)`,
      );
      outcome = { outcome: 'kept', key, errorRowsDropped: dropped };
    } else {
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
          param(Date.now()),
          `) ON CONFLICT (id) DO UPDATE SET key = excluded.key, set_at = excluded.set_at`,
        ]);
        await stampDeployment();
      } else {
        // A clear without a key must not leave a stale key behind: a later
        // boot whose key happens to equal it would keep rows derived under
        // whatever this boot could not fingerprint.
        await queryFn([`DELETE FROM definition_cache_key WHERE id = 1`]);
      }
      outcome = { outcome: 'cleared', key, previousKey };
    }
    await queryFn(['COMMIT']);
    return outcome;
  });
}

// The boot check and the post-deployment hook's check for one process. The
// hook clears where the boot is told to skip: that opt-out keeps a restored
// table for the process's own boot, and a deploy still replaces what the
// previous build derived.
export function definitionCacheReconcilers(
  args: Omit<ReconcileDefinitionCacheArgs, 'afterDeployment'>,
): {
  onBoot: () => Promise<DefinitionCacheBootOutcome>;
  afterDeployment: () => Promise<DefinitionCacheBootOutcome>;
} {
  return {
    onBoot: () => reconcileDefinitionCacheOnBoot(args),
    afterDeployment: () =>
      reconcileDefinitionCacheOnBoot({
        ...args,
        mode: args.mode === 'skip' ? 'clear' : args.mode,
        afterDeployment: true,
      }),
  };
}
