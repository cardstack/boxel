import type { Command } from 'commander';
import { RealmSyncBase, type SyncOptions } from '../../lib/realm-sync-base';
import {
  CheckpointManager,
  type CheckpointChange,
} from '../../lib/checkpoint-manager';
import {
  getProfileManager,
  type ProfileManager,
} from '../../lib/profile-manager';
import * as fs from 'fs/promises';
import * as path from 'path';

interface PullOptions extends SyncOptions {
  deleteLocal?: boolean;
}

class RealmPuller extends RealmSyncBase {
  hasError = false;
  downloadedFiles: string[] = [];

  constructor(
    private pullOptions: PullOptions,
    profileManager: ProfileManager,
  ) {
    super(pullOptions, profileManager);
  }

  async sync(): Promise<void> {
    console.log(
      `Starting pull from ${this.options.realmUrl} to ${this.options.localDir}`,
    );

    console.log('Testing realm access...');
    try {
      await this.getRemoteFileList('');
    } catch (error) {
      console.error('Failed to access realm:', error);
      throw new Error(
        'Cannot proceed with pull: Authentication or access failed. ' +
          'Please check your Matrix credentials and realm permissions.',
      );
    }
    console.log('Realm access verified');

    const [remoteFiles, localFiles] = await Promise.all([
      this.getRemoteFileList(),
      this.getLocalFileList(),
    ]);
    console.log(`Found ${remoteFiles.size} files in remote realm`);
    console.log(`Found ${localFiles.size} files in local directory`);

    if (this.options.dryRun) {
      try {
        await fs.access(this.options.localDir);
      } catch {
        console.log(
          `[DRY RUN] Would create directory: ${this.options.localDir}`,
        );
      }
    } else {
      await fs.mkdir(this.options.localDir, { recursive: true });
    }

    const filesToDelete = new Set<string>();
    if (this.pullOptions.deleteLocal) {
      for (const relativePath of localFiles.keys()) {
        if (!remoteFiles.has(relativePath)) {
          filesToDelete.add(relativePath);
        }
      }
    }

    const checkpointManager = new CheckpointManager(this.options.localDir);

    if (filesToDelete.size > 0 && !this.options.dryRun) {
      const deleteChanges: CheckpointChange[] = Array.from(filesToDelete).map(
        (f) => ({
          file: f,
          status: 'deleted' as const,
        }),
      );
      const preDeleteCheckpoint = await checkpointManager.createCheckpoint(
        'remote',
        deleteChanges,
        `Pre-delete checkpoint: ${filesToDelete.size} files not on server`,
      );
      if (preDeleteCheckpoint) {
        console.log(
          `\nCheckpoint created before deletion: ${preDeleteCheckpoint.shortHash}`,
        );
      }
    }

    const downloadResults = await Promise.all(
      Array.from(remoteFiles.keys()).map((relativePath) =>
        this.remoteLimit(async () => {
          try {
            const localPath = path.join(this.options.localDir, relativePath);
            await this.downloadFile(relativePath, localPath);
            return relativePath;
          } catch (error) {
            this.hasError = true;
            console.error(`Error downloading ${relativePath}:`, error);
            return null;
          }
        }),
      ),
    );
    this.downloadedFiles = downloadResults.filter(
      (f): f is string => f !== null,
    );

    let deletedFiles: string[] = [];
    if (filesToDelete.size > 0) {
      console.log(
        `\nDeleting ${filesToDelete.size} local files that don't exist in realm...`,
      );

      const deleteResults = await Promise.all(
        Array.from(filesToDelete).map(async (relativePath) => {
          try {
            const localPath = localFiles.get(relativePath);
            if (localPath) {
              await this.deleteLocalFile(localPath);
              console.log(`  Deleted: ${relativePath}`);
              return relativePath;
            }
            return null;
          } catch (error) {
            this.hasError = true;
            console.error(`Error deleting local file ${relativePath}:`, error);
            return null;
          }
        }),
      );
      deletedFiles = deleteResults.filter((f): f is string => f !== null);
    }

    if (
      !this.options.dryRun &&
      this.downloadedFiles.length + deletedFiles.length > 0
    ) {
      const pullChanges: CheckpointChange[] = [
        ...this.downloadedFiles.map((f) => ({
          file: f,
          status: 'modified' as const,
        })),
        ...deletedFiles.map((f) => ({
          file: f,
          status: 'deleted' as const,
        })),
      ];
      const checkpoint = await checkpointManager.createCheckpoint(
        'remote',
        pullChanges,
      );
      if (checkpoint) {
        const tag = checkpoint.isMajor ? '[MAJOR]' : '[minor]';
        console.log(
          `\nCheckpoint created: ${checkpoint.shortHash} ${tag} ${checkpoint.message}`,
        );
      }
    }

    console.log('Pull completed');
  }
}

export interface PullCommandOptions {
  delete?: boolean;
  dryRun?: boolean;
  profileManager?: ProfileManager;
}

export function registerPullCommand(realm: Command): void {
  realm
    .command('pull')
    .description('Pull files from a Boxel realm to a local directory')
    .argument(
      '<realm-url>',
      'The URL of the source realm (e.g., https://app.boxel.ai/demo/)',
    )
    .argument('<local-dir>', 'The local directory to sync files to')
    .option('--delete', 'Delete local files that do not exist in the realm')
    .option('--dry-run', 'Show what would be done without making changes')
    .action(
      async (
        realmUrl: string,
        localDir: string,
        options: { delete?: boolean; dryRun?: boolean },
      ) => {
        await pullCommand(realmUrl, localDir, options);
      },
    );
}

export async function pullCommand(
  realmUrl: string,
  localDir: string,
  options: PullCommandOptions,
): Promise<void> {
  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    console.error(
      'Error: no active profile. Run `boxel profile add` to create one.',
    );
    process.exit(1);
  }

  try {
    const puller = new RealmPuller(
      {
        realmUrl,
        localDir,
        deleteLocal: options.delete,
        dryRun: options.dryRun,
      },
      pm,
    );

    await puller.sync();

    if (puller.hasError) {
      console.log('Pull did not complete successfully. View logs for details');
      process.exit(2);
    } else {
      console.log('Pull completed successfully');
    }
  } catch (error) {
    console.error('Pull failed:', error);
    process.exit(1);
  }
}

export async function pull(
  realmUrl: string,
  localDir: string,
  options: PullCommandOptions,
): Promise<{ files: string[]; error?: string }> {
  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      files: [],
      error: 'No active profile. Run `boxel profile add` to create one.',
    };
  }

  try {
    const puller = new RealmPuller(
      {
        realmUrl,
        localDir,
        deleteLocal: options.delete,
      },
      pm,
    );

    await puller.sync();

    if (puller.hasError) {
      return {
        files: puller.downloadedFiles.sort(),
        error:
          'Pull completed with errors. Some files may not have been downloaded.',
      };
    }

    return { files: puller.downloadedFiles.sort() };
  } catch (error) {
    return {
      files: [],
      error: `Pull failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
