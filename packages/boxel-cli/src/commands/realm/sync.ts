import type { Command } from 'commander';
import {
  RealmSyncBase,
  isProtectedFile,
  type SyncOptions,
} from '../../lib/realm-sync-base.ts';
import {
  CheckpointManager,
  type CheckpointChange,
} from '../../lib/checkpoint-manager.ts';
import type { ProfileManager } from '../../lib/profile-manager.ts';
import type { RealmAuthenticator } from '../../lib/realm-authenticator.ts';
import { resolveRealmAuthenticator } from '../../lib/auth-resolver.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import {
  type SyncManifest,
  computeFileHash,
  loadManifest,
  saveManifest,
  pathExists,
} from '../../lib/sync-manifest.ts';
import * as path from 'path';
import {
  FG_GREEN,
  FG_YELLOW,
  FG_RED,
  FG_CYAN,
  DIM,
  RESET,
} from '../../lib/colors.ts';
import {
  classifyLocal,
  classifyRemote,
  determineAction,
  resolveConflict,
  type FileClassification,
  type ConflictStrategy,
} from '../../lib/sync-logic.ts';

interface BiSyncOptions extends SyncOptions {
  preferLocal?: boolean;
  preferRemote?: boolean;
  preferNewest?: boolean;
  deleteSync?: boolean;
}

class RealmSyncer extends RealmSyncBase {
  hasError = false;
  pushedFiles: string[] = [];
  pulledFiles: string[] = [];
  remoteDeletedFiles: string[] = [];
  localDeletedFiles: string[] = [];
  skippedConflicts: string[] = [];
  // Top-level message from a failed /_atomic batch (e.g. "Atomic upload
  // failed: 500 Internal Server Error"). Surfaced in `SyncResult.error`
  // so callers don't have to scrape stderr to learn why the batch
  // failed.
  uploadFatalMessage?: string;
  private syncOptions: BiSyncOptions;

  constructor(syncOptions: BiSyncOptions, authenticator: RealmAuthenticator) {
    super(syncOptions, authenticator);
    this.syncOptions = syncOptions;
  }

  private get conflictStrategy(): ConflictStrategy | null {
    if (this.syncOptions.preferLocal) return 'prefer-local';
    if (this.syncOptions.preferRemote) return 'prefer-remote';
    if (this.syncOptions.preferNewest) return 'prefer-newest';
    return null;
  }

  async sync(): Promise<void> {
    console.log(
      `Starting sync between ${this.options.localDir} and ${this.options.realmUrl}`,
    );

    console.log('Testing realm access...');
    let remoteFileList: Map<string, boolean> | undefined;
    try {
      remoteFileList = await this.getRemoteFileList('');
    } catch (error) {
      console.error('Failed to access realm:', error);
      throw new Error(
        'Cannot proceed with sync: Authentication or access failed. ' +
          'Please check your credentials and realm permissions.',
      );
    }
    console.log('Realm access verified');

    // Phase 1: Gather state (single local traversal — derive localFiles from mtimes result)
    const [localFilesWithMtimes, remoteMtimes, manifest] = await Promise.all([
      this.getLocalFileListWithMtimes(),
      this.getRemoteMtimes(),
      loadManifest(this.options.localDir),
    ]);

    const localFiles = new Map<string, string>();
    for (const [rel, info] of localFilesWithMtimes) {
      localFiles.set(rel, info.path);
    }

    // Fall back to file listing when _mtimes endpoint is unavailable
    if (remoteMtimes.size === 0 && remoteFileList && remoteFileList.size > 0) {
      console.log(
        'Remote mtimes unavailable, falling back to file listing for remote detection',
      );
      for (const [filePath] of remoteFileList) {
        remoteMtimes.set(filePath, 0);
      }
    }

    console.log(`Found ${localFiles.size} local files`);
    console.log(`Found ${remoteMtimes.size} remote files`);

    if (manifest && manifest.realmUrl !== this.normalizedRealmUrl) {
      console.warn(
        `${FG_YELLOW}Warning:${RESET} Manifest realm URL (${manifest.realmUrl}) differs from target (${this.normalizedRealmUrl}). Treating as first sync.`,
      );
    }

    const effectiveManifest =
      manifest && manifest.realmUrl === this.normalizedRealmUrl
        ? manifest
        : null;

    // Compute local file hashes
    const localHashes = new Map<string, string>();
    await Promise.all(
      Array.from(localFiles.entries()).map(async ([rel, absPath]) => {
        if (!isProtectedFile(rel)) {
          localHashes.set(rel, await computeFileHash(absPath));
        }
      }),
    );

    // Phase 2: Classify each file
    const allPaths = new Set<string>();
    for (const p of localFiles.keys()) allPaths.add(p);
    for (const p of remoteMtimes.keys()) allPaths.add(p);
    if (effectiveManifest) {
      for (const p of Object.keys(effectiveManifest.files)) allPaths.add(p);
      if (effectiveManifest.remoteMtimes) {
        for (const p of Object.keys(effectiveManifest.remoteMtimes))
          allPaths.add(p);
      }
    }

    const classifications: FileClassification[] = [];

    for (const relativePath of allPaths) {
      if (isProtectedFile(relativePath)) continue;

      const localStatus = classifyLocal(
        relativePath,
        localHashes,
        effectiveManifest,
      );
      const remoteStatus = classifyRemote(
        relativePath,
        remoteMtimes,
        effectiveManifest,
      );

      const action = determineAction(
        localStatus,
        remoteStatus,
        this.syncOptions,
      );

      classifications.push({ relativePath, localStatus, remoteStatus, action });
    }

    // Phase 3: Summarize and resolve conflicts
    const toPush: string[] = [];
    const toPull: string[] = [];
    const toPushDelete: string[] = [];
    const toPullDelete: string[] = [];
    const conflicts: FileClassification[] = [];
    let noopCount = 0;

    for (const c of classifications) {
      switch (c.action) {
        case 'push':
          toPush.push(c.relativePath);
          break;
        case 'pull':
          toPull.push(c.relativePath);
          break;
        case 'push-delete':
          toPushDelete.push(c.relativePath);
          break;
        case 'pull-delete':
          toPullDelete.push(c.relativePath);
          break;
        case 'conflict':
          conflicts.push(c);
          break;
        case 'noop':
          noopCount++;
          break;
      }
    }

    // Resolve conflicts
    for (const c of conflicts) {
      const resolved = resolveConflict(
        c,
        localFilesWithMtimes,
        remoteMtimes,
        this.conflictStrategy,
      );
      switch (resolved) {
        case 'push':
          toPush.push(c.relativePath);
          break;
        case 'pull':
          toPull.push(c.relativePath);
          break;
        case 'push-delete':
          toPushDelete.push(c.relativePath);
          break;
        case 'pull-delete':
          toPullDelete.push(c.relativePath);
          break;
        case 'noop':
          // deleted on both sides
          break;
        default:
          this.skippedConflicts.push(c.relativePath);
          break;
      }
    }

    // Print summary
    console.log(`\n${DIM}Sync plan:${RESET}`);
    if (toPush.length > 0)
      console.log(`  ${FG_GREEN}↑ Push:${RESET} ${toPush.length} file(s)`);
    if (toPull.length > 0)
      console.log(`  ${FG_CYAN}↓ Pull:${RESET} ${toPull.length} file(s)`);
    if (toPushDelete.length > 0)
      console.log(
        `  ${FG_RED}↑ Delete remote:${RESET} ${toPushDelete.length} file(s)`,
      );
    if (toPullDelete.length > 0)
      console.log(
        `  ${FG_RED}↓ Delete local:${RESET} ${toPullDelete.length} file(s)`,
      );
    if (this.skippedConflicts.length > 0) {
      console.log(
        `  ${FG_YELLOW}⚠ Conflicts skipped:${RESET} ${this.skippedConflicts.length} file(s)`,
      );
      for (const p of this.skippedConflicts) {
        console.log(`    ${p}`);
      }
      console.log(
        `  ${DIM}Use --prefer-local, --prefer-remote, or --prefer-newest to resolve.${RESET}`,
      );
    }
    if (noopCount > 0)
      console.log(`  ${DIM}Unchanged: ${noopCount} file(s)${RESET}`);

    const totalOps =
      toPush.length + toPull.length + toPushDelete.length + toPullDelete.length;

    if (totalOps === 0) {
      console.log('\nEverything is up to date');
      if (
        !this.options.dryRun &&
        !effectiveManifest &&
        this.skippedConflicts.length === 0
      ) {
        // First sync with no changes needed - still write manifest
        await this.writeManifest(localHashes, remoteMtimes);
      }
      return;
    }

    // Phase 5: Execute operations (order: pulls, pushes, remote deletes, local deletes)
    // Downloads (pulls)
    if (toPull.length > 0) {
      console.log(`\nPulling ${toPull.length} file(s)...`);
      const results = await Promise.all(
        toPull.map((rel) =>
          this.remoteLimit(async () => {
            try {
              const localPath = path.join(this.options.localDir, rel);
              await this.downloadFile(rel, localPath);
              return rel;
            } catch (error) {
              this.hasError = true;
              console.error(`Error downloading ${rel}:`, error);
              return null;
            }
          }),
        ),
      );
      this.pulledFiles.push(...results.filter((f): f is string => f !== null));
    }

    // Uploads (pushes) via atomic
    if (toPush.length > 0) {
      console.log(`\nPushing ${toPush.length} file(s)...`);
      const filesToUpload = new Map<string, string>();
      for (const rel of toPush) {
        const absPath = localFiles.get(rel);
        if (absPath) filesToUpload.set(rel, absPath);
      }

      // Determine add vs update based on whether file exists in manifest or on remote
      const addPaths = new Set<string>();
      for (const rel of filesToUpload.keys()) {
        const inManifest = effectiveManifest?.files[rel] !== undefined;
        const existsOnRemote = remoteMtimes.has(rel);
        if (!inManifest && !existsOnRemote) {
          addPaths.add(rel);
        }
      }

      const result = await this.uploadFilesAtomic(filesToUpload, addPaths);
      // Record every file the server actually wrote, even when other
      // files in the same batch failed — see push.ts for the symmetric
      // reasoning.
      this.pushedFiles.push(...result.succeeded);
      if (result.error) {
        this.hasError = true;
        // Fold the per-file titles into the surfaced message so
        // SyncResult.error carries the server's JSON:API error
        // payload (e.g. "Write Error"), not just the HTTP status
        // line. Distinct titles only — repeated identical titles
        // (the common case for a top-level write failure) would
        // otherwise produce noisy duplicates. The summary line is
        // re-echoed by registerSyncCommand at the end of the run
        // via `Error: ${result.error}`, so we no longer also emit
        // the standalone status line inline — that would duplicate
        // it in CLI output. The per-file loop stays because it
        // carries path-level detail the summary aggregates away.
        let titles = Array.from(
          new Set(result.error.perFile.map((e) => e.title)),
        );
        this.uploadFatalMessage =
          titles.length > 0
            ? `${result.error.message} (${titles.join('; ')})`
            : result.error.message;
        for (const entry of result.error.perFile) {
          console.error(`  ${entry.path}: ${entry.title}`);
        }
      }
    }

    // Remote deletions
    if (toPushDelete.length > 0) {
      console.log(`\nDeleting ${toPushDelete.length} remote file(s)...`);
      const deleteResults = await Promise.all(
        toPushDelete.map((rel) =>
          this.remoteLimit(async () => {
            try {
              await this.deleteFile(rel);
              return rel;
            } catch (error) {
              this.hasError = true;
              console.error(`Error deleting remote ${rel}:`, error);
              return null;
            }
          }),
        ),
      );
      this.remoteDeletedFiles.push(
        ...deleteResults.filter((f): f is string => f !== null),
      );
    }

    // Local deletions
    if (toPullDelete.length > 0) {
      console.log(`\nDeleting ${toPullDelete.length} local file(s)...`);
      const localDeleteResults = await Promise.all(
        toPullDelete.map(async (rel) => {
          try {
            const localPath = localFiles.get(rel);
            if (localPath) {
              await this.deleteLocalFile(localPath);
              return rel;
            }
            return null;
          } catch (error) {
            this.hasError = true;
            console.error(`Error deleting local ${rel}:`, error);
            return null;
          }
        }),
      );
      this.localDeletedFiles.push(
        ...localDeleteResults.filter((f): f is string => f !== null),
      );
    }

    // Phase 6: Update manifest. Persist even on partial failure — we
    // only record hashes for files the server actually wrote
    // (pushedFiles + pulledFiles), so the manifest stays consistent
    // with the realm and the next sync won't re-attempt successful
    // files.
    if (!this.options.dryRun) {
      // Build updated hashes from prior manifest + current local files + executed ops.
      // Start with the previous manifest so that files deleted locally but not
      // propagated (no --delete) retain their entries and aren't re-pulled next sync.
      const updatedHashes = new Map<string, string>();
      if (effectiveManifest) {
        for (const [rel, hash] of Object.entries(effectiveManifest.files)) {
          updatedHashes.set(rel, hash);
        }
      }
      // Overlay current local file hashes (covers new, changed, and unchanged local files)
      for (const [rel, hash] of localHashes) {
        updatedHashes.set(rel, hash);
      }
      // Recompute hashes for pushed files (content may have been normalized)
      for (const rel of this.pushedFiles) {
        const absPath = localFiles.get(rel);
        if (absPath) {
          updatedHashes.set(rel, await computeFileHash(absPath));
        }
      }
      // Add hashes for pulled files (newly downloaded)
      for (const rel of this.pulledFiles) {
        const absPath = path.join(this.options.localDir, rel);
        updatedHashes.set(rel, await computeFileHash(absPath));
      }
      // Remove files that were actually deleted (propagated deletions only)
      for (const rel of this.remoteDeletedFiles) updatedHashes.delete(rel);
      for (const rel of this.localDeletedFiles) updatedHashes.delete(rel);

      // Refresh remote mtimes after pushes
      let freshMtimes = remoteMtimes;
      if (this.pushedFiles.length > 0 || this.remoteDeletedFiles.length > 0) {
        try {
          freshMtimes = await this.getRemoteMtimes();
        } catch {
          console.warn('Could not refresh remote mtimes after sync');
        }
      }

      await this.writeManifest(updatedHashes, freshMtimes);
    }

    // Phase 7: Checkpoint
    if (!this.options.dryRun) {
      const allChanges: CheckpointChange[] = [
        ...this.pushedFiles.map((f) => ({
          file: f,
          status: 'modified' as const,
        })),
        ...this.pulledFiles.map((f) => ({
          file: f,
          status: 'modified' as const,
        })),
        ...this.remoteDeletedFiles.map((f) => ({
          file: f,
          status: 'deleted' as const,
        })),
        ...this.localDeletedFiles.map((f) => ({
          file: f,
          status: 'deleted' as const,
        })),
      ];

      if (allChanges.length > 0) {
        const checkpointManager = new CheckpointManager(this.options.localDir);
        const checkpoint = await checkpointManager.createCheckpoint(
          'local',
          allChanges,
        );
        if (checkpoint) {
          const tag = checkpoint.isMajor ? '[MAJOR]' : '[minor]';
          console.log(
            `\nCheckpoint created: ${checkpoint.shortHash} ${tag} ${checkpoint.message}`,
          );
        }
      }
    }

    console.log('\nSync completed');
  }

  private async writeManifest(
    hashes: Map<string, string>,
    remoteMtimes: Map<string, number>,
  ): Promise<void> {
    const manifest: SyncManifest = {
      realmUrl: this.normalizedRealmUrl,
      files: {},
      remoteMtimes: {},
    };

    for (const [rel, hash] of hashes) {
      manifest.files[rel] = hash;
      const mtime = remoteMtimes.get(rel);
      if (mtime !== undefined && mtime !== 0) {
        manifest.remoteMtimes![rel] = mtime;
      }
    }

    if (
      manifest.remoteMtimes &&
      Object.keys(manifest.remoteMtimes).length === 0
    ) {
      delete manifest.remoteMtimes;
    }

    await saveManifest(this.options.localDir, manifest);
  }
}

export interface SyncCommandOptions {
  preferLocal?: boolean;
  preferRemote?: boolean;
  preferNewest?: boolean;
  delete?: boolean;
  dryRun?: boolean;
  /**
   * Append `?waitForIndex=true` to the `_atomic` upload so the
   * realm-server returns only after the indexer has processed the
   * batch. See `SyncOptions.waitForIndex` for the rationale.
   */
  waitForIndex?: boolean;
  profileManager?: ProfileManager;
  /**
   * Pre-resolved realm secret seed for administrative access. When set, the
   * CLI mints a JWT locally and skips Matrix login + /_server-session +
   * /_realm-auth. The `--realm-secret-seed` CLI flag is resolved via
   * `resolveRealmSecretSeed` (env var or interactive prompt) before being
   * passed here.
   */
  realmSecretSeed?: string;
  /**
   * @internal Test hook: supply an already-constructed authenticator.
   */
  authenticator?: RealmAuthenticator;
}

export interface SyncResult {
  pushed: string[];
  pulled: string[];
  remoteDeleted: string[];
  localDeleted: string[];
  skippedConflicts: string[];
  hasError: boolean;
  error?: string;
}

export function registerSyncCommand(realm: Command): Command {
  const syncCmd = realm
    .command('sync')
    .description(
      'Bidirectional sync between a local directory and a Boxel realm',
    )
    .argument('<local-dir>', 'The local directory to sync')
    .argument(
      '<realm-url>',
      'The URL of the target realm (e.g., https://app.boxel.ai/demo/)',
    )
    .option('--prefer-local', 'Resolve conflicts by keeping local version')
    .option('--prefer-remote', 'Resolve conflicts by keeping remote version')
    .option('--prefer-newest', 'Resolve conflicts by keeping newest version')
    .option('--delete', 'Sync deletions both ways')
    .option('--dry-run', 'Preview without making changes')
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)',
    )
    .action(
      async (
        localDir: string,
        realmUrl: string,
        options: {
          preferLocal?: boolean;
          preferRemote?: boolean;
          preferNewest?: boolean;
          delete?: boolean;
          dryRun?: boolean;
          realmSecretSeed?: boolean;
        },
      ) => {
        const realmSecretSeed = await resolveRealmSecretSeed(
          options.realmSecretSeed === true,
        );
        let result = await sync(localDir, realmUrl, {
          preferLocal: options.preferLocal,
          preferRemote: options.preferRemote,
          preferNewest: options.preferNewest,
          delete: options.delete,
          dryRun: options.dryRun,
          realmSecretSeed,
        });
        let hasPartialResults =
          (Array.isArray(result.pushed) && result.pushed.length > 0) ||
          (Array.isArray(result.pulled) && result.pulled.length > 0) ||
          (Array.isArray(result.remoteDeleted) &&
            result.remoteDeleted.length > 0) ||
          (Array.isArray(result.localDeleted) &&
            result.localDeleted.length > 0);
        if (result.error) {
          console.error(`Error: ${result.error}`);
          process.exit(hasPartialResults ? 2 : 1);
        }
        console.log('Sync completed successfully');
      },
    );
  return syncCmd;
}

/**
 * Programmatic bidirectional sync. Returns a structured result instead
 * of exiting the process, so callers (BoxelCLIClient, factory, tests)
 * can branch on outcomes. The CLI command registration above wraps this
 * and translates results into exit codes.
 */
export async function sync(
  localDir: string,
  realmUrl: string,
  options: SyncCommandOptions,
): Promise<SyncResult> {
  let authenticator: RealmAuthenticator;
  if (options.authenticator) {
    authenticator = options.authenticator;
  } else {
    const resolution = resolveRealmAuthenticator({
      realmUrl,
      realmSecretSeed: options.realmSecretSeed,
      profileManager: options.profileManager,
    });
    if (!resolution.ok) {
      return emptyResult({ error: resolution.error });
    }
    authenticator = resolution.authenticator;
  }

  const strategies = [
    options.preferLocal,
    options.preferRemote,
    options.preferNewest,
  ].filter(Boolean);
  if (strategies.length > 1) {
    return emptyResult({
      error:
        'Only one conflict strategy can be specified (--prefer-local, --prefer-remote, or --prefer-newest).',
    });
  }

  if (!(await pathExists(localDir))) {
    return emptyResult({
      error: `Local directory does not exist: ${localDir}`,
    });
  }

  let syncer: RealmSyncer | undefined;
  try {
    syncer = new RealmSyncer(
      {
        realmUrl,
        localDir,
        preferLocal: options.preferLocal,
        preferRemote: options.preferRemote,
        preferNewest: options.preferNewest,
        deleteSync: options.delete,
        dryRun: options.dryRun,
        waitForIndex: options.waitForIndex,
      },
      authenticator,
    );
    await syncer.sync();
  } catch (error) {
    return {
      pushed: syncer?.pushedFiles.slice().sort() ?? [],
      pulled: syncer?.pulledFiles.slice().sort() ?? [],
      remoteDeleted: syncer?.remoteDeletedFiles.slice().sort() ?? [],
      localDeleted: syncer?.localDeletedFiles.slice().sort() ?? [],
      skippedConflicts: syncer?.skippedConflicts.slice().sort() ?? [],
      hasError: true,
      error: `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    pushed: syncer.pushedFiles.slice().sort(),
    pulled: syncer.pulledFiles.slice().sort(),
    remoteDeleted: syncer.remoteDeletedFiles.slice().sort(),
    localDeleted: syncer.localDeletedFiles.slice().sort(),
    skippedConflicts: syncer.skippedConflicts.slice().sort(),
    hasError: syncer.hasError,
    error: syncer.hasError ? buildSyncErrorMessage(syncer) : undefined,
  };
}

function buildSyncErrorMessage(syncer: RealmSyncer): string {
  let summary = [
    `${syncer.pushedFiles.length} pushed`,
    `${syncer.pulledFiles.length} pulled`,
    `${syncer.remoteDeletedFiles.length} remote deleted`,
    `${syncer.localDeletedFiles.length} local deleted`,
    `${syncer.skippedConflicts.length} conflicts skipped`,
  ].join(', ');

  let base = `Sync completed with errors. ${summary}.`;
  if (syncer.uploadFatalMessage) {
    return `${base} ${syncer.uploadFatalMessage}`;
  }
  return base;
}
function emptyResult(partial: Pick<SyncResult, 'error'>): SyncResult {
  return {
    pushed: [],
    pulled: [],
    remoteDeleted: [],
    localDeleted: [],
    skippedConflicts: [],
    hasError: true,
    ...partial,
  };
}
