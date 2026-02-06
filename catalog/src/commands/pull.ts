import { RealmSyncBase, validateMatrixEnvVars, type SyncOptions } from '../lib/realm-sync-base.js';
import { CheckpointManager, type CheckpointChange } from '../lib/checkpoint-manager.js';
import * as fs from 'fs';
import * as path from 'path';

interface PullOptions extends SyncOptions {
  deleteLocal?: boolean;
}

class RealmPuller extends RealmSyncBase {
  hasError = false;

  constructor(
    private pullOptions: PullOptions,
    matrixUrl: string,
    username: string,
    password: string,
  ) {
    super(pullOptions, matrixUrl, username, password);
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

    // Create local directory if it doesn't exist
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

    // Download remote files
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

    // Delete local files that don't exist remotely (if requested)
    if (this.pullOptions.deleteLocal) {
      const filesToDelete = new Set(localFiles.keys());
      for (const relativePath of remoteFiles.keys()) {
        filesToDelete.delete(relativePath);
      }

      if (filesToDelete.size > 0) {
        // Create checkpoint BEFORE deleting so we can recover
        const checkpointManager = new CheckpointManager(this.options.localDir);
        const deleteChanges: CheckpointChange[] = Array.from(filesToDelete).map(f => ({
          file: f,
          status: 'deleted' as const,
        }));
        const preDeleteCheckpoint = checkpointManager.createCheckpoint('remote', deleteChanges,
          `Pre-delete checkpoint: ${filesToDelete.size} files not on server`);
        if (preDeleteCheckpoint) {
          console.log(`\n📍 Checkpoint created before deletion: ${preDeleteCheckpoint.shortHash}`);
        }

        console.log(`\nDeleting ${filesToDelete.size} local files that don't exist in workspace...`);

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

    // Create checkpoint for pulled files
    if (!this.options.dryRun && downloadedFiles.length > 0) {
      const checkpointManager = new CheckpointManager(this.options.localDir);
      const pullChanges: CheckpointChange[] = downloadedFiles.map(f => ({
        file: f,
        status: 'modified' as const,
      }));
      const checkpoint = checkpointManager.createCheckpoint('remote', pullChanges);
      if (checkpoint) {
        const tag = checkpoint.isMajor ? '[MAJOR]' : '[minor]';
        console.log(`\n📍 Checkpoint created: ${checkpoint.shortHash} ${tag} ${checkpoint.message}`);
      }
    }

    console.log('Pull completed');
  }
}

export interface PullCommandOptions {
  delete?: boolean;
  dryRun?: boolean;
}

export async function pullCommand(
  workspaceUrl: string,
  localDir: string,
  options: PullCommandOptions,
): Promise<void> {
  const { matrixUrl, username, password } =
    await validateMatrixEnvVars(workspaceUrl);

  try {
    const puller = new RealmPuller(
      {
        workspaceUrl,
        localDir,
        deleteLocal: options.delete,
        dryRun: options.dryRun,
      },
      matrixUrl,
      username,
      password,
    );

    await puller.initialize();
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
