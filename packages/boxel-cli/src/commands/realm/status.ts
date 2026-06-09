import type { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  RealmSyncBase,
  isProtectedFile,
  type SyncOptions,
} from '../../lib/realm-sync-base.ts';
import {
  classifyLocal,
  classifyRemote,
  type SideStatus,
} from '../../lib/sync-logic.ts';
import {
  computeFileHash,
  isValidManifest,
  loadManifest,
  saveManifest,
  pathExists,
  type SyncManifest,
} from '../../lib/sync-manifest.ts';
import type { ProfileManager } from '../../lib/profile-manager.ts';
import type { RealmAuthenticator } from '../../lib/realm-authenticator.ts';
import { resolveRealmAuthenticator } from '../../lib/auth-resolver.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import {
  FG_GREEN,
  FG_YELLOW,
  FG_CYAN,
  FG_RED,
  DIM,
  RESET,
} from '../../lib/colors.ts';

export type StatusFileState =
  | 'new-remote'
  | 'modified-remote'
  | 'new-local'
  | 'modified-local'
  | 'conflict'
  | 'deleted-local'
  | 'deleted-remote';

export interface StatusEntry {
  file: string;
  status: StatusFileState;
}

export interface StatusResult {
  localDir: string;
  realmUrl: string;
  manifestMtime?: number;
  changes: StatusEntry[];
  pulled: string[];
  inSync: boolean;
  hasError: boolean;
  error?: string;
}

export interface StatusAllEntry extends StatusResult {
  skipped?: 'no-manifest' | 'malformed' | 'fetch-failed';
}

export interface StatusAllResult {
  rootDir: string;
  workspaces: StatusAllEntry[];
  hasError: boolean;
  error?: string;
}

export interface StatusCommandOptions {
  pull?: boolean;
  all?: boolean;
  profileManager?: ProfileManager;
  realmSecretSeed?: string;
  authenticator?: RealmAuthenticator;
}

interface StatusInspectorOptions extends SyncOptions {
  pull?: boolean;
}

const ALL_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.boxel-history',
  '.cache',
  '.vscode',
  'dist',
  'build',
  'tmp',
]);

const DEFAULT_MAX_DEPTH = 6;

function mapSideStatusToUserStatus(
  local: SideStatus,
  remote: SideStatus,
): StatusFileState | null {
  if (local === 'unchanged' && remote === 'unchanged') return null;
  if (local === 'deleted' && remote === 'deleted') return null;

  if (local === 'unchanged' && remote === 'added') return 'new-remote';
  if (local === 'unchanged' && remote === 'changed') return 'modified-remote';
  if (local === 'unchanged' && remote === 'deleted') return 'deleted-remote';

  if (local === 'added' && remote === 'unchanged') return 'new-local';
  if (local === 'changed' && remote === 'unchanged') return 'modified-local';
  if (local === 'deleted' && remote === 'unchanged') return 'deleted-local';

  if (local === 'changed' && remote === 'changed') return 'conflict';
  if (local === 'added' && remote === 'added') return 'conflict';
  if (local === 'changed' && remote === 'added') return 'conflict';
  if (local === 'added' && remote === 'changed') return 'conflict';
  if (local === 'changed' && remote === 'deleted') return 'conflict';
  if (local === 'deleted' && remote === 'changed') return 'conflict';

  // Defensive cross-states (unlikely in practice)
  if (local === 'added' && remote === 'deleted') return 'new-local';
  if (local === 'deleted' && remote === 'added') return 'new-remote';

  return null;
}

class RealmStatusInspector extends RealmSyncBase {
  changes: StatusEntry[] = [];
  pulled: string[] = [];
  hasError = false;
  error?: string;
  remoteMtimes: Map<string, number> = new Map();
  private statusOptions: StatusInspectorOptions;
  private loadedManifest: SyncManifest;

  constructor(
    statusOptions: StatusInspectorOptions,
    loadedManifest: SyncManifest,
    authenticator: RealmAuthenticator,
  ) {
    super(statusOptions, authenticator);
    this.statusOptions = statusOptions;
    this.loadedManifest = loadedManifest;
  }

  async sync(): Promise<void> {
    let localFilesWithMtimes;
    let remoteFileList: Map<string, boolean> | undefined;
    try {
      [localFilesWithMtimes, this.remoteMtimes, remoteFileList] =
        await Promise.all([
          this.getLocalFileListWithMtimes(),
          this.getRemoteMtimes(),
          this.getRemoteFileList(),
        ]);
    } catch (err) {
      this.hasError = true;
      this.error =
        err instanceof Error
          ? `Failed to fetch realm state: ${err.message}`
          : `Failed to fetch realm state: ${String(err)}`;
      return;
    }

    // Fall back to directory listing when `_mtimes` is unavailable, so
    // remote-existing files don't get classified as `deleted-remote`.
    // Mirrors `sync.ts`. The placeholder mtime (0) lands them in
    // `classifyRemote`'s "known in manifest.files → changed" branch,
    // which we render as `modified-remote` — noisy but visible, vs.
    // silently misreporting deletions.
    if (
      remoteFileList &&
      this.remoteMtimes.size === 0 &&
      remoteFileList.size > 0
    ) {
      for (const [filePath] of remoteFileList) {
        this.remoteMtimes.set(filePath, 0);
      }
    }

    const localFiles = new Map<string, string>();
    for (const [rel, info] of localFilesWithMtimes) {
      localFiles.set(rel, info.path);
    }

    const localHashes = new Map<string, string>();
    await Promise.all(
      Array.from(localFiles.entries()).map(async ([rel, absPath]) => {
        if (!isProtectedFile(rel)) {
          localHashes.set(rel, await computeFileHash(absPath));
        }
      }),
    );

    const allPaths = new Set<string>();
    for (const p of localFiles.keys()) allPaths.add(p);
    for (const p of this.remoteMtimes.keys()) allPaths.add(p);
    for (const p of Object.keys(this.loadedManifest.files)) allPaths.add(p);
    if (this.loadedManifest.remoteMtimes) {
      for (const p of Object.keys(this.loadedManifest.remoteMtimes))
        allPaths.add(p);
    }

    for (const relativePath of allPaths) {
      if (isProtectedFile(relativePath)) continue;
      const localStatus = classifyLocal(
        relativePath,
        localHashes,
        this.loadedManifest,
      );
      const remoteStatus = classifyRemote(
        relativePath,
        this.remoteMtimes,
        this.loadedManifest,
      );
      const userStatus = mapSideStatusToUserStatus(localStatus, remoteStatus);
      if (userStatus !== null) {
        this.changes.push({ file: relativePath, status: userStatus });
      }
    }
    this.changes.sort((a, b) => a.file.localeCompare(b.file));

    if (this.statusOptions.pull) {
      await this.performSafePull();
    }
  }

  private async performSafePull(): Promise<void> {
    const safe = this.changes.filter(
      (c) => c.status === 'new-remote' || c.status === 'modified-remote',
    );
    if (safe.length === 0) {
      return;
    }

    const failures: Array<{ file: string; message: string }> = [];
    for (const change of safe) {
      const localPath = path.join(this.options.localDir, change.file);
      try {
        await this.downloadFile(change.file, localPath);
        this.pulled.push(change.file);
        const newHash = await computeFileHash(localPath);
        this.loadedManifest.files[change.file] = newHash;
        const mtime = this.remoteMtimes.get(change.file);
        if (mtime !== undefined) {
          this.loadedManifest.remoteMtimes =
            this.loadedManifest.remoteMtimes ?? {};
          this.loadedManifest.remoteMtimes[change.file] = mtime;
        }
      } catch (err) {
        this.hasError = true;
        const msg = err instanceof Error ? err.message : String(err);
        failures.push({ file: change.file, message: msg });
        console.error(`  ${FG_RED}✗ ${change.file}${RESET} (${msg})`);
      }
    }

    if (failures.length > 0) {
      this.error = `Failed to pull ${failures.length} file(s): ${failures
        .map((f) => `${f.file} (${f.message})`)
        .join('; ')}`;
    }

    if (this.pulled.length > 0) {
      await saveManifest(this.options.localDir, this.loadedManifest);
    }
  }
}

export async function status(
  localDir: string,
  options: StatusCommandOptions,
): Promise<StatusResult> {
  const baseResult: StatusResult = {
    localDir,
    realmUrl: '',
    changes: [],
    pulled: [],
    inSync: false,
    hasError: false,
  };

  const manifestPath = path.join(localDir, '.boxel-sync.json');
  if (!(await pathExists(manifestPath))) {
    return {
      ...baseResult,
      hasError: true,
      error: `No .boxel-sync.json found in ${localDir}. Run: boxel realm sync ${localDir} <realm-url>`,
    };
  }

  const manifest = await loadManifest(localDir);
  if (!manifest) {
    return {
      ...baseResult,
      hasError: true,
      error: `Malformed .boxel-sync.json in ${localDir}`,
    };
  }

  let manifestMtime: number | undefined;
  try {
    manifestMtime = (await fs.stat(manifestPath)).mtimeMs;
  } catch {
    // best-effort only
  }

  let authenticator: RealmAuthenticator;
  if (options.authenticator) {
    authenticator = options.authenticator;
  } else {
    const resolution = resolveRealmAuthenticator({
      realmUrl: manifest.realmUrl,
      realmSecretSeed: options.realmSecretSeed,
      profileManager: options.profileManager,
    });
    if (!resolution.ok) {
      return {
        ...baseResult,
        realmUrl: manifest.realmUrl,
        manifestMtime,
        hasError: true,
        error: resolution.error,
      };
    }
    authenticator = resolution.authenticator;
  }

  const inspector = new RealmStatusInspector(
    {
      realmUrl: manifest.realmUrl,
      localDir,
      pull: options.pull,
    },
    manifest,
    authenticator,
  );
  await inspector.sync();

  return {
    localDir,
    realmUrl: manifest.realmUrl,
    manifestMtime,
    changes: inspector.changes,
    pulled: inspector.pulled.slice().sort(),
    inSync: !inspector.hasError && inspector.changes.length === 0,
    hasError: inspector.hasError,
    error: inspector.error,
  };
}

async function findSyncDirs(root: string, maxDepth: number): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: import('fs').Dirent[];
    try {
      entries = (await fs.readdir(dir, {
        withFileTypes: true,
      })) as import('fs').Dirent[];
    } catch {
      return;
    }

    const hasManifest = entries.some(
      (e) => e.isFile() && e.name === '.boxel-sync.json',
    );
    if (hasManifest) {
      found.push(dir);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (ALL_IGNORED_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), depth + 1);
    }
  }

  await walk(root, 0);
  found.sort();
  return found;
}

export async function statusAll(
  rootDir: string,
  options: StatusCommandOptions,
): Promise<StatusAllResult> {
  if (options.pull) {
    return {
      rootDir,
      workspaces: [],
      hasError: true,
      error: 'Cannot use --pull with --all',
    };
  }

  const envDepth = process.env.BOXEL_STATUS_ALL_MAX_DEPTH;
  const parsedDepth = envDepth !== undefined ? Number(envDepth) : NaN;
  const maxDepth =
    Number.isFinite(parsedDepth) && parsedDepth >= 0
      ? parsedDepth
      : DEFAULT_MAX_DEPTH;
  const dirs = await findSyncDirs(rootDir, maxDepth);

  const workspaces: StatusAllEntry[] = [];
  let hasError = false;

  for (const dir of dirs) {
    const manifestPath = path.join(dir, '.boxel-sync.json');
    let rawContent: string;
    try {
      rawContent = await fs.readFile(manifestPath, 'utf8');
    } catch {
      workspaces.push({
        localDir: dir,
        realmUrl: '',
        changes: [],
        pulled: [],
        inSync: false,
        hasError: true,
        skipped: 'no-manifest',
      });
      hasError = true;
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      parsed = undefined;
    }
    if (!isValidManifest(parsed)) {
      workspaces.push({
        localDir: dir,
        realmUrl: '',
        changes: [],
        pulled: [],
        inSync: false,
        hasError: true,
        skipped: 'malformed',
      });
      hasError = true;
      continue;
    }

    const result = await status(dir, {
      profileManager: options.profileManager,
      realmSecretSeed: options.realmSecretSeed,
      authenticator: options.authenticator,
    });
    const entry: StatusAllEntry = { ...result };
    if (result.hasError) {
      entry.skipped = 'fetch-failed';
      hasError = true;
    }
    workspaces.push(entry);
  }

  return { rootDir, workspaces, hasError };
}

function renderStatus(result: StatusResult): void {
  if (result.hasError && result.error) {
    console.error(`${FG_RED}Error:${RESET} ${result.error}`);
    return;
  }

  console.log(`Realm: ${result.realmUrl}`);
  console.log(`Local: ${result.localDir}`);
  if (result.manifestMtime) {
    console.log(
      `${DIM}Manifest updated:${RESET} ${new Date(result.manifestMtime).toISOString()}`,
    );
  }
  console.log('');

  if (result.changes.length === 0) {
    console.log(`${FG_GREEN}✓ In sync${RESET}`);
    return;
  }

  const buckets: Record<StatusFileState, string[]> = {
    'new-remote': [],
    'modified-remote': [],
    'new-local': [],
    'modified-local': [],
    conflict: [],
    'deleted-local': [],
    'deleted-remote': [],
  };
  for (const c of result.changes) buckets[c.status].push(c.file);

  if (buckets['new-remote'].length > 0) {
    console.log(
      `${FG_CYAN}↓ New on remote (${buckets['new-remote'].length}):${RESET}`,
    );
    for (const f of buckets['new-remote']) console.log(`   + ${f}`);
    console.log('');
  }
  if (buckets['modified-remote'].length > 0) {
    console.log(
      `${FG_CYAN}↓ Modified on remote (${buckets['modified-remote'].length}):${RESET}`,
    );
    for (const f of buckets['modified-remote']) console.log(`   ~ ${f}`);
    console.log('');
  }
  if (buckets['new-local'].length > 0) {
    console.log(
      `${FG_GREEN}↑ New locally (${buckets['new-local'].length}):${RESET}`,
    );
    for (const f of buckets['new-local']) console.log(`   + ${f}`);
    console.log('');
  }
  if (buckets['modified-local'].length > 0) {
    console.log(
      `${FG_GREEN}↑ Modified locally (${buckets['modified-local'].length}):${RESET}`,
    );
    for (const f of buckets['modified-local']) console.log(`   ~ ${f}`);
    console.log('');
  }
  if (buckets.conflict.length > 0) {
    console.log(
      `${FG_YELLOW}⚠ Conflicts (${buckets.conflict.length}):${RESET}`,
    );
    for (const f of buckets.conflict) console.log(`   ! ${f}`);
    console.log('');
  }
  if (buckets['deleted-local'].length > 0) {
    console.log(
      `${FG_RED}- Deleted locally (${buckets['deleted-local'].length}):${RESET}`,
    );
    for (const f of buckets['deleted-local']) console.log(`   - ${f}`);
    console.log('');
  }
  if (buckets['deleted-remote'].length > 0) {
    console.log(
      `${FG_RED}- Deleted on remote (${buckets['deleted-remote'].length}):${RESET}`,
    );
    for (const f of buckets['deleted-remote']) console.log(`   - ${f}`);
    console.log('');
  }

  if (result.pulled.length > 0) {
    console.log(`${FG_CYAN}Pulled ${result.pulled.length} file(s):${RESET}`);
    for (const f of result.pulled) console.log(`   ✓ ${f}`);
  }
}

function renderStatusAll(result: StatusAllResult): void {
  if (result.error) {
    console.error(`${FG_RED}Error:${RESET} ${result.error}`);
    return;
  }
  if (result.workspaces.length === 0) {
    console.log(
      `No .boxel-sync.json directories found under ${result.rootDir}.`,
    );
    return;
  }
  for (const ws of result.workspaces) {
    if (ws.skipped) {
      console.log(`${FG_YELLOW}${ws.localDir}${RESET}  [${ws.skipped}]`);
      if (ws.error) console.log(`   ${DIM}${ws.error}${RESET}`);
      console.log('');
      continue;
    }
    const counts = {
      newRemote: 0,
      modRemote: 0,
      newLocal: 0,
      modLocal: 0,
      conflict: 0,
      delLocal: 0,
      delRemote: 0,
    };
    for (const c of ws.changes) {
      if (c.status === 'new-remote') counts.newRemote++;
      else if (c.status === 'modified-remote') counts.modRemote++;
      else if (c.status === 'new-local') counts.newLocal++;
      else if (c.status === 'modified-local') counts.modLocal++;
      else if (c.status === 'conflict') counts.conflict++;
      else if (c.status === 'deleted-local') counts.delLocal++;
      else if (c.status === 'deleted-remote') counts.delRemote++;
    }
    console.log(`${ws.localDir}  ${DIM}${ws.realmUrl}${RESET}`);
    if (ws.inSync) {
      console.log(`   ${FG_GREEN}✓ in sync${RESET}`);
    } else {
      const parts: string[] = [];
      if (counts.newRemote > 0)
        parts.push(`${FG_CYAN}↓+${counts.newRemote}${RESET}`);
      if (counts.modRemote > 0)
        parts.push(`${FG_CYAN}↓~${counts.modRemote}${RESET}`);
      if (counts.newLocal > 0)
        parts.push(`${FG_GREEN}↑+${counts.newLocal}${RESET}`);
      if (counts.modLocal > 0)
        parts.push(`${FG_GREEN}↑~${counts.modLocal}${RESET}`);
      if (counts.conflict > 0)
        parts.push(`${FG_YELLOW}⚠${counts.conflict}${RESET}`);
      if (counts.delLocal > 0)
        parts.push(`${FG_RED}-L${counts.delLocal}${RESET}`);
      if (counts.delRemote > 0)
        parts.push(`${FG_RED}-R${counts.delRemote}${RESET}`);
      console.log(`   ${parts.join('  ')}`);
    }
    console.log('');
  }
}

export function registerStatusCommand(sync: Command): void {
  sync
    .command('status')
    .aliases(['st'])
    .description('Show pending changes between a local sync dir and its realm')
    .argument(
      '[local-dir]',
      'Local sync directory (defaults to current working directory)',
    )
    .option('--pull', 'Download safe remote changes and update manifest')
    .option(
      '--all',
      'Recursively report all .boxel-sync.json dirs under the current directory',
    )
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)',
    )
    .action(
      async (
        localDir: string | undefined,
        options: {
          pull?: boolean;
          all?: boolean;
          realmSecretSeed?: boolean;
        },
      ) => {
        const realmSecretSeed = await resolveRealmSecretSeed(
          options.realmSecretSeed === true,
        );

        if (options.all) {
          if (options.pull) {
            console.error(
              `${FG_RED}Error:${RESET} Cannot use --pull with --all`,
            );
            process.exit(1);
          }
          const result = await statusAll(localDir ?? process.cwd(), {
            all: true,
            realmSecretSeed,
          });
          renderStatusAll(result);
          if (result.hasError) {
            process.exit(2);
          }
          return;
        }

        const result = await status(localDir ?? process.cwd(), {
          pull: options.pull,
          realmSecretSeed,
        });
        renderStatus(result);
        if (result.hasError) {
          // Missing/malformed manifest = config error (1).
          // Pull-with-partial-failures = partial error (2).
          process.exit(result.pulled.length > 0 ? 2 : 1);
        }
      },
    );
}
