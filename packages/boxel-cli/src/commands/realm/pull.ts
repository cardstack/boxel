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
import * as fs from 'fs';
import * as path from 'path';

interface PullOptions extends SyncOptions {
  deleteLocal?: boolean;
}

class RealmPuller extends RealmSyncBase {
  hasError = false;

  constructor(
    private pullOptions: PullOptions,
    profileManager: ProfileManager,
  ) {
    super(pullOptions, profileManager);
  }

  async sync(): Promise<void> {
    console.log(
      `Starting pull from ${this.options.workspaceUrl} to ${this.options.localDir}`,
    );

    console.log('Testing workspace access...');
    try {
      await this.getRemoteFileList('');
    } catch (error) {
      console.error('Failed to access workspace:', error);
      throw new Error(
        'Cannot proceed with pull: Authentication or access failed. ' +
          'Please check your Matrix credentials and workspace permissions.',
      );
    }
    console.log('Workspace access verified');

    const remoteFiles = await this.getRemoteFileList();
    console.log(`Found ${remoteFiles.size} files in remote workspace`);

    const localFiles = await this.getLocalFileList();
    console.log(`Found ${localFiles.size} files in local directory`);

    if (!fs.existsSync(this.options.localDir)) {
      if (this.options.dryRun) {
        console.log(
          `[DRY RUN] Would create directory: ${this.options.localDir}`,
        );
      } else {
        fs.mkdirSync(this.options.localDir, { recursive: true });
        console.log(`Created directory: ${this.options.localDir}`);
      }
    }

    const downloadedFiles: string[] = [];
    for (const [relativePath] of remoteFiles) {
      try {
        const localPath = path.join(this.options.localDir, relativePath);
        await this.downloadFile(relativePath, localPath);
        downloadedFiles.push(relativePath);
      } catch (error) {
        this.hasError = true;
        console.error(`Error downloading ${relativePath}:`, error);
      }
    }

    if (this.pullOptions.deleteLocal) {
      const filesToDelete = new Set(localFiles.keys());
      for (const relativePath of remoteFiles.keys()) {
        filesToDelete.delete(relativePath);
      }

      if (filesToDelete.size > 0) {
        const checkpointManager = new CheckpointManager(this.options.localDir);
        const deleteChanges: CheckpointChange[] = Array.from(filesToDelete).map(
          (f) => ({
            file: f,
            status: 'deleted' as const,
          }),
        );
        const preDeleteCheckpoint = checkpointManager.createCheckpoint(
          'remote',
          deleteChanges,
          `Pre-delete checkpoint: ${filesToDelete.size} files not on server`,
        );
        if (preDeleteCheckpoint) {
          console.log(
            `\nCheckpoint created before deletion: ${preDeleteCheckpoint.shortHash}`,
          );
        }

        console.log(
          `\nDeleting ${filesToDelete.size} local files that don't exist in workspace...`,
        );

        for (const relativePath of filesToDelete) {
          try {
            const localPath = localFiles.get(relativePath);
            if (localPath) {
              await this.deleteLocalFile(localPath);
              console.log(`  Deleted: ${relativePath}`);
            }
          } catch (error) {
            this.hasError = true;
            console.error(`Error deleting local file ${relativePath}:`, error);
          }
        }
      }
    }

    if (!this.options.dryRun && downloadedFiles.length > 0) {
      const checkpointManager = new CheckpointManager(this.options.localDir);
      const pullChanges: CheckpointChange[] = downloadedFiles.map((f) => ({
        file: f,
        status: 'modified' as const,
      }));
      const checkpoint = checkpointManager.createCheckpoint(
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
      '<workspace-url>',
      'The URL of the source workspace (e.g., https://app.boxel.ai/demo/)',
    )
    .argument('<local-dir>', 'The local directory to sync files to')
    .option('--delete', 'Delete local files that do not exist in the workspace')
    .option('--dry-run', 'Show what would be done without making changes')
    .action(
      async (
        workspaceUrl: string,
        localDir: string,
        options: { delete?: boolean; dryRun?: boolean },
      ) => {
        await pullCommand(workspaceUrl, localDir, options);
      },
    );
}

export async function pullCommand(
  workspaceUrl: string,
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
        workspaceUrl,
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
