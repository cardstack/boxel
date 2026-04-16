import type { Command } from 'commander';
import {
  RealmSyncBase,
  isProtectedFile,
  type SyncOptions,
} from '../../lib/realm-sync-base';
import {
  CheckpointManager,
  type CheckpointChange,
} from '../../lib/checkpoint-manager';
import {
  getProfileManager,
  type ProfileManager,
} from '../../lib/profile-manager';
import {
  type SyncManifest,
  computeFileHash,
  loadManifest,
  saveManifest,
  pathExists,
} from '../../lib/sync-manifest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { FG_GREEN, FG_YELLOW, FG_RED, FG_CYAN, DIM, RESET } from '../../lib/colors';

type SideStatus = 'unchanged' | 'changed' | 'added' | 'deleted';
type SyncAction =
  | 'push'
  | 'pull'
  | 'push-delete'
  | 'pull-delete'
  | 'conflict'
  | 'noop';

interface FileClassification {
  relativePath: string;
  localStatus: SideStatus;
  remoteStatus: SideStatus;
  action: SyncAction;
}

type ConflictStrategy = 'prefer-local' | 'prefer-remote' | 'prefer-newest';

interface BiSyncOptions extends SyncOptions {
  preferLocal?: boolean;
  preferRemote?: boolean;
  preferNewest?: boolean;
  deleteSync?: boolean;
}

class RealmSyncer extends RealmSyncBase {
  hasError = false;

  constructor(
    private syncOptions: BiSyncOptions,
    profileManager: ProfileManager,
  ) {
    super(syncOptions, profileManager);
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
    try {
      await this.getRemoteFileList('');
    } catch (error) {
      console.error('Failed to access realm:', error);
      throw new Error(
        'Cannot proceed with sync: Authentication or access failed. ' +
          'Please check your Matrix credentials and realm permissions.',
      );
    }
    console.log('Realm access verified');

    // Phase 1: Gather state
    const [localFiles, localFilesWithMtimes, remoteMtimes, manifest] =
      await Promise.all([
        this.getLocalFileList(),
        this.getLocalFileListWithMtimes(),
        this.getRemoteMtimes(),
        loadManifest(this.options.localDir),
      ]);

    console.log(`Found ${localFiles.size} local files`);
    console.log(`Found ${remoteMtimes.size} remote files`);

    if (
      manifest &&
      manifest.realmUrl !== this.normalizedRealmUrl
    ) {
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

      const localStatus = this.classifyLocal(
        relativePath,
        localHashes,
        effectiveManifest,
      );
      const remoteStatus = this.classifyRemote(
        relativePath,
        remoteMtimes,
        effectiveManifest,
      );

      const action = this.determineAction(
        localStatus,
        remoteStatus,
        relativePath,
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
    const skippedConflicts: string[] = [];
    for (const c of conflicts) {
      const resolved = this.resolveConflict(c, localFilesWithMtimes, remoteMtimes);
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
          skippedConflicts.push(c.relativePath);
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
    if (skippedConflicts.length > 0) {
      console.log(
        `  ${FG_YELLOW}⚠ Conflicts skipped:${RESET} ${skippedConflicts.length} file(s)`,
      );
      for (const p of skippedConflicts) {
        console.log(`    ${p}`);
      }
      console.log(
        `  ${DIM}Use --prefer-local, --prefer-remote, or --prefer-newest to resolve.${RESET}`,
      );
    }
    if (noopCount > 0)
      console.log(`  ${DIM}Unchanged: ${noopCount} file(s)${RESET}`);

    const totalOps =
      toPush.length +
      toPull.length +
      toPushDelete.length +
      toPullDelete.length;

    if (totalOps === 0) {
      console.log('\nEverything is up to date');
      if (!this.options.dryRun && !effectiveManifest) {
        // First sync with no changes needed - still write manifest
        await this.writeManifest(localHashes, remoteMtimes);
      }
      return;
    }

    // Phase 5: Execute operations (order: pulls, pushes, remote deletes, local deletes)
    const pulledFiles: string[] = [];
    const pushedFiles: string[] = [];
    const remoteDeletedFiles: string[] = [];
    const localDeletedFiles: string[] = [];

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
      pulledFiles.push(...results.filter((f): f is string => f !== null));
    }

    // Uploads (pushes) via atomic
    if (toPush.length > 0) {
      console.log(`\nPushing ${toPush.length} file(s)...`);
      const filesToUpload = new Map<string, string>();
      for (const rel of toPush) {
        const absPath = localFiles.get(rel);
        if (absPath) filesToUpload.set(rel, absPath);
      }

      // Determine add vs update based on whether file exists in manifest
      const addPaths = new Set<string>();
      for (const rel of filesToUpload.keys()) {
        if (!effectiveManifest || effectiveManifest.files[rel] === undefined) {
          addPaths.add(rel);
        }
      }

      const result = await this.uploadFilesAtomic(filesToUpload, addPaths);
      if (result.error) {
        this.hasError = true;
        console.error(result.error.message);
        for (const entry of result.error.perFile) {
          console.error(`  ${entry.path}: ${entry.title}`);
        }
      } else {
        pushedFiles.push(...result.succeeded);
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
      remoteDeletedFiles.push(
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
      localDeletedFiles.push(
        ...localDeleteResults.filter((f): f is string => f !== null),
      );
    }

    // Phase 6: Update manifest
    if (!this.options.dryRun && !this.hasError) {
      // Recompute hashes for pulled files and update manifest
      const updatedHashes = new Map(localHashes);
      for (const rel of pushedFiles) {
        const absPath = localFiles.get(rel);
        if (absPath) {
          updatedHashes.set(rel, await computeFileHash(absPath));
        }
      }
      for (const rel of pulledFiles) {
        const absPath = path.join(this.options.localDir, rel);
        updatedHashes.set(rel, await computeFileHash(absPath));
      }
      // Remove deleted files
      for (const rel of remoteDeletedFiles) updatedHashes.delete(rel);
      for (const rel of localDeletedFiles) updatedHashes.delete(rel);

      // Refresh remote mtimes after pushes
      let freshMtimes = remoteMtimes;
      if (pushedFiles.length > 0 || remoteDeletedFiles.length > 0) {
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
        ...pushedFiles.map((f) => ({
          file: f,
          status: 'modified' as const,
        })),
        ...pulledFiles.map((f) => ({
          file: f,
          status: 'modified' as const,
        })),
        ...remoteDeletedFiles.map((f) => ({
          file: f,
          status: 'deleted' as const,
        })),
        ...localDeletedFiles.map((f) => ({
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

  private classifyLocal(
    relativePath: string,
    localHashes: Map<string, string>,
    manifest: SyncManifest | null,
  ): SideStatus {
    const hasLocal = localHashes.has(relativePath);
    const inManifest = manifest?.files[relativePath] !== undefined;

    if (hasLocal && inManifest) {
      return localHashes.get(relativePath) === manifest!.files[relativePath]
        ? 'unchanged'
        : 'changed';
    }
    if (hasLocal && !inManifest) return 'added';
    if (!hasLocal && inManifest) return 'deleted';
    // Not local, not in manifest — this file only exists remotely
    return 'unchanged'; // not relevant on local side
  }

  private classifyRemote(
    relativePath: string,
    remoteMtimes: Map<string, number>,
    manifest: SyncManifest | null,
  ): SideStatus {
    const hasRemote = remoteMtimes.has(relativePath);
    const inManifest = manifest?.remoteMtimes?.[relativePath] !== undefined;

    if (hasRemote && inManifest) {
      return remoteMtimes.get(relativePath) ===
        manifest!.remoteMtimes![relativePath]
        ? 'unchanged'
        : 'changed';
    }
    if (hasRemote && !inManifest) return 'added';
    if (!hasRemote && inManifest) return 'deleted';
    // Not remote, not in manifest — only exists locally
    return 'unchanged'; // not relevant on remote side
  }

  private determineAction(
    local: SideStatus,
    remote: SideStatus,
    _relativePath: string,
  ): SyncAction {
    // Both unchanged
    if (local === 'unchanged' && remote === 'unchanged') return 'noop';

    // One side changed, other unchanged
    if (local === 'changed' && remote === 'unchanged') return 'push';
    if (local === 'unchanged' && remote === 'changed') return 'pull';

    // One side added, other doesn't exist
    if (local === 'added' && remote === 'unchanged') return 'push';
    if (local === 'unchanged' && remote === 'added') return 'pull';

    // Both changed or both added — conflict
    if (
      (local === 'changed' && remote === 'changed') ||
      (local === 'added' && remote === 'added')
    ) {
      return 'conflict';
    }

    // Deletions
    if (local === 'deleted' && remote === 'unchanged') {
      return this.syncOptions.deleteSync || this.syncOptions.preferLocal
        ? 'push-delete'
        : 'noop';
    }
    if (local === 'unchanged' && remote === 'deleted') {
      return this.syncOptions.deleteSync || this.syncOptions.preferRemote
        ? 'pull-delete'
        : 'noop';
    }

    // Delete vs change conflicts
    if (local === 'deleted' && remote === 'changed') return 'conflict';
    if (local === 'changed' && remote === 'deleted') return 'conflict';

    // Both deleted
    if (local === 'deleted' && remote === 'deleted') return 'noop';

    // Added vs deleted (shouldn't normally happen but handle gracefully)
    if (local === 'added' && remote === 'deleted') return 'push';
    if (local === 'deleted' && remote === 'added') return 'pull';

    return 'noop';
  }

  private resolveConflict(
    classification: FileClassification,
    localFilesWithMtimes: Map<string, { path: string; mtime: number }>,
    remoteMtimes: Map<string, number>,
  ): SyncAction | null {
    const strategy = this.conflictStrategy;
    const { localStatus, remoteStatus, relativePath } = classification;

    if (!strategy) return null; // skip — no strategy

    switch (strategy) {
      case 'prefer-local':
        if (localStatus === 'deleted') return 'push-delete';
        return 'push';

      case 'prefer-remote':
        if (remoteStatus === 'deleted') return 'pull-delete';
        return 'pull';

      case 'prefer-newest': {
        // For delete-vs-change, the change always wins
        if (localStatus === 'deleted' && remoteStatus === 'changed')
          return 'pull';
        if (localStatus === 'changed' && remoteStatus === 'deleted')
          return 'push';

        const localInfo = localFilesWithMtimes.get(relativePath);
        const remoteMtime = remoteMtimes.get(relativePath);

        if (localInfo && remoteMtime !== undefined) {
          // Remote mtimes are in seconds (epoch), local mtimes are in ms
          return localInfo.mtime > remoteMtime * 1000 ? 'push' : 'pull';
        }
        // If we can't compare, prefer local (it's what the user has)
        return 'push';
      }
    }
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
      if (mtime !== undefined) {
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
  profileManager?: ProfileManager;
}

export function registerSyncCommand(realm: Command): void {
  realm
    .command('sync')
    .description('Bidirectional sync between a local directory and a Boxel realm')
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
        },
      ) => {
        await syncCommand(localDir, realmUrl, options);
      },
    );
}

export async function syncCommand(
  localDir: string,
  realmUrl: string,
  options: SyncCommandOptions,
): Promise<void> {
  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    console.error(
      'Error: no active profile. Run `boxel profile add` to create one.',
    );
    process.exit(1);
  }

  // Validate mutually exclusive strategies
  const strategies = [
    options.preferLocal,
    options.preferRemote,
    options.preferNewest,
  ].filter(Boolean);
  if (strategies.length > 1) {
    console.error(
      'Error: only one conflict strategy can be specified (--prefer-local, --prefer-remote, or --prefer-newest)',
    );
    process.exit(1);
  }

  if (!(await pathExists(localDir))) {
    console.error(`Local directory does not exist: ${localDir}`);
    process.exit(1);
  }

  try {
    const syncer = new RealmSyncer(
      {
        realmUrl,
        localDir,
        preferLocal: options.preferLocal,
        preferRemote: options.preferRemote,
        preferNewest: options.preferNewest,
        deleteSync: options.delete,
        dryRun: options.dryRun,
      },
      pm,
    );

    await syncer.sync();

    if (syncer.hasError) {
      console.log('Sync did not complete successfully. View logs for details');
      process.exit(2);
    } else {
      console.log('Sync completed successfully');
    }
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  }
}
