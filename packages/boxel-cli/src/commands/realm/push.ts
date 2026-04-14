import type { Command } from 'commander';
import { RealmSyncBase, isProtectedFile, type SyncOptions } from '../../lib/realm-sync-base';
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
import * as crypto from 'crypto';

interface SyncManifest {
  workspaceUrl: string;
  files: Record<string, string>; // relativePath -> contentHash
}

function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
}

function loadManifest(localDir: string): SyncManifest | null {
  const manifestPath = path.join(localDir, '.boxel-sync.json');
  if (fs.existsSync(manifestPath)) {
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

function saveManifest(localDir: string, manifest: SyncManifest): void {
  const manifestPath = path.join(localDir, '.boxel-sync.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

interface PushOptions extends SyncOptions {
  deleteRemote?: boolean;
  force?: boolean;
}

class RealmPusher extends RealmSyncBase {
  hasError = false;

  constructor(
    private pushOptions: PushOptions,
    profileManager: ProfileManager,
  ) {
    super(pushOptions, profileManager);
  }

  async sync(): Promise<void> {
    console.log(
      `Starting push from ${this.options.localDir} to ${this.options.workspaceUrl}`,
    );

    console.log('Testing workspace access...');
    try {
      await this.getRemoteFileList('');
    } catch (error) {
      console.error('Failed to access workspace:', error);
      throw new Error(
        'Cannot proceed with push: Authentication or access failed. ' +
          'Please check your credentials and workspace permissions.',
      );
    }
    console.log('Workspace access verified');

    const localFiles = await this.getLocalFileList();
    console.log(`Found ${localFiles.size} files in local directory`);

    const manifest = loadManifest(this.options.localDir);
    const newManifest: SyncManifest = {
      workspaceUrl: this.options.workspaceUrl,
      files: {},
    };

    const filesToUpload: Map<string, string> = new Map();

    if (
      this.pushOptions.force ||
      !manifest ||
      manifest.workspaceUrl !== this.options.workspaceUrl
    ) {
      if (this.pushOptions.force) {
        console.log('Force mode: uploading all files');
      } else if (!manifest) {
        console.log('No sync manifest found, will upload all files');
      } else {
        console.log('Workspace URL changed, will upload all files');
      }
      for (const [relativePath, localPath] of localFiles) {
        if (isProtectedFile(relativePath)) continue;
        filesToUpload.set(relativePath, localPath);
      }
    } else {
      console.log('Checking for changed files...');
      let skipped = 0;

      for (const [relativePath, localPath] of localFiles) {
        if (isProtectedFile(relativePath)) {
          skipped++;
          continue;
        }
        const currentHash = computeFileHash(localPath);
        const previousHash = manifest.files[relativePath];

        if (previousHash !== currentHash) {
          filesToUpload.set(relativePath, localPath);
        } else {
          skipped++;
          newManifest.files[relativePath] = currentHash;
        }
      }

      if (skipped > 0) {
        console.log(`Skipping ${skipped} unchanged files`);
      }
    }

    if (filesToUpload.size === 0) {
      console.log('No files to upload - everything is up to date');
    } else {
      console.log(`Uploading ${filesToUpload.size} file(s)...`);

      for (const [relativePath, localPath] of filesToUpload) {
        try {
          await this.uploadFile(relativePath, localPath);
          newManifest.files[relativePath] = computeFileHash(localPath);
        } catch (error) {
          this.hasError = true;
          console.error(`Error uploading ${relativePath}:`, error);
        }
      }
    }

    if (this.pushOptions.deleteRemote) {
      const remoteFiles = await this.getRemoteFileList();
      const filesToDelete = new Set(remoteFiles.keys());

      for (const relativePath of filesToDelete) {
        if (isProtectedFile(relativePath)) {
          filesToDelete.delete(relativePath);
        }
      }

      for (const relativePath of localFiles.keys()) {
        filesToDelete.delete(relativePath);
      }

      if (filesToDelete.size > 0) {
        console.log(
          `Deleting ${filesToDelete.size} remote files that don't exist locally`,
        );

        for (const relativePath of filesToDelete) {
          try {
            await this.deleteFile(relativePath);
          } catch (error) {
            this.hasError = true;
            console.error(`Error deleting ${relativePath}:`, error);
          }
        }
      }
    }

    if (!this.options.dryRun) {
      saveManifest(this.options.localDir, newManifest);
    }

    if (!this.options.dryRun && filesToUpload.size > 0) {
      const checkpointManager = new CheckpointManager(this.options.localDir);
      const pushChanges: CheckpointChange[] = Array.from(
        filesToUpload.keys(),
      ).map((f) => ({
        file: f,
        status: 'modified' as const,
      }));
      const checkpoint = checkpointManager.createCheckpoint(
        'local',
        pushChanges,
      );
      if (checkpoint) {
        const tag = checkpoint.isMajor ? '[MAJOR]' : '[minor]';
        console.log(
          `\nCheckpoint created: ${checkpoint.shortHash} ${tag} ${checkpoint.message}`,
        );
      }
    }

    console.log('Push completed');
  }
}

export interface PushCommandOptions {
  delete?: boolean;
  dryRun?: boolean;
  force?: boolean;
  profileManager?: ProfileManager;
}

export function registerPushCommand(realm: Command): void {
  realm
    .command('push')
    .description('Push local files to a Boxel realm')
    .argument('<local-dir>', 'The local directory containing files to sync')
    .argument(
      '<workspace-url>',
      'The URL of the target workspace (e.g., https://app.boxel.ai/demo/)',
    )
    .option('--delete', 'Delete remote files that do not exist locally')
    .option('--dry-run', 'Show what would be done without making changes')
    .option('--force', 'Upload all files, even if unchanged')
    .action(
      async (
        localDir: string,
        workspaceUrl: string,
        options: { delete?: boolean; dryRun?: boolean; force?: boolean },
      ) => {
        await pushCommand(localDir, workspaceUrl, options);
      },
    );
}

export async function pushCommand(
  localDir: string,
  workspaceUrl: string,
  options: PushCommandOptions,
): Promise<void> {
  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    console.error(
      'Error: no active profile. Run `boxel profile add` to create one.',
    );
    process.exit(1);
  }

  if (!fs.existsSync(localDir)) {
    console.error(`Local directory does not exist: ${localDir}`);
    process.exit(1);
  }

  try {
    const pusher = new RealmPusher(
      {
        workspaceUrl,
        localDir,
        deleteRemote: options.delete,
        dryRun: options.dryRun,
        force: options.force,
      },
      pm,
    );

    await pusher.sync();

    if (pusher.hasError) {
      console.log('Push did not complete successfully. View logs for details');
      process.exit(2);
    } else {
      console.log('Push completed successfully');
    }
  } catch (error) {
    console.error('Push failed:', error);
    process.exit(1);
  }
}
