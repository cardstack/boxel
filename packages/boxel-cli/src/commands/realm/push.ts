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
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

interface SyncManifest {
  realmUrl: string;
  files: Record<string, string>; // relativePath -> contentHash
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function computeFileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
}

async function loadManifest(localDir: string): Promise<SyncManifest | null> {
  const manifestPath = path.join(localDir, '.boxel-sync.json');
  try {
    const content = await fs.readFile(manifestPath, 'utf8');
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function saveManifest(
  localDir: string,
  manifest: SyncManifest,
): Promise<void> {
  const manifestPath = path.join(localDir, '.boxel-sync.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
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
      `Starting push from ${this.options.localDir} to ${this.options.realmUrl}`,
    );

    console.log('Testing realm access...');
    try {
      await this.getRemoteFileList('');
    } catch (error) {
      console.error('Failed to access realm:', error);
      throw new Error(
        'Cannot proceed with push: Authentication or access failed. ' +
          'Please check your credentials and realm permissions.',
      );
    }
    console.log('Realm access verified');

    const localFiles = await this.getLocalFileList();
    console.log(`Found ${localFiles.size} files in local directory`);

    const manifest = await loadManifest(this.options.localDir);
    const newManifest: SyncManifest = {
      realmUrl: this.options.realmUrl,
      files: {},
    };

    const filesToUpload: Map<string, string> = new Map();

    if (
      this.pushOptions.force ||
      !manifest ||
      manifest.realmUrl !== this.options.realmUrl
    ) {
      if (this.pushOptions.force) {
        console.log('Force mode: uploading all files');
      } else if (!manifest) {
        console.log('No sync manifest found, will upload all files');
      } else {
        console.log('Realm URL changed, will upload all files');
      }
      for (const [relativePath, localPath] of localFiles) {
        if (isProtectedFile(relativePath)) continue;
        filesToUpload.set(relativePath, localPath);
      }
    } else {
      console.log('Checking for changed files...');
      let skipped = 0;

      const hashResults = await Promise.all(
        Array.from(localFiles.entries()).map(
          async ([relativePath, localPath]) => {
            if (isProtectedFile(relativePath)) {
              return {
                relativePath,
                localPath,
                currentHash: '',
                protected: true,
              };
            }
            const currentHash = await computeFileHash(localPath);
            return {
              relativePath,
              localPath,
              currentHash,
              protected: false,
            };
          },
        ),
      );

      for (const entry of hashResults) {
        if (entry.protected) {
          skipped++;
          continue;
        }
        const previousHash = manifest.files[entry.relativePath];
        if (previousHash !== entry.currentHash) {
          filesToUpload.set(entry.relativePath, entry.localPath);
        } else {
          skipped++;
          newManifest.files[entry.relativePath] = entry.currentHash;
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

      const uploadResults = await Promise.all(
        Array.from(filesToUpload.entries()).map(
          async ([relativePath, localPath]) => {
            try {
              await this.uploadFile(relativePath, localPath);
              const hash = await computeFileHash(localPath);
              return { relativePath, hash };
            } catch (error) {
              this.hasError = true;
              console.error(`Error uploading ${relativePath}:`, error);
              return null;
            }
          },
        ),
      );

      for (const result of uploadResults) {
        if (result) {
          newManifest.files[result.relativePath] = result.hash;
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

        await Promise.all(
          Array.from(filesToDelete).map(async (relativePath) => {
            try {
              await this.deleteFile(relativePath);
            } catch (error) {
              this.hasError = true;
              console.error(`Error deleting ${relativePath}:`, error);
            }
          }),
        );
      }
    }

    if (!this.options.dryRun) {
      await saveManifest(this.options.localDir, newManifest);
    }

    if (!this.options.dryRun && filesToUpload.size > 0) {
      const checkpointManager = new CheckpointManager(this.options.localDir);
      const pushChanges: CheckpointChange[] = Array.from(
        filesToUpload.keys(),
      ).map((f) => ({
        file: f,
        status: 'modified' as const,
      }));
      const checkpoint = await checkpointManager.createCheckpoint(
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
      '<realm-url>',
      'The URL of the target realm (e.g., https://app.boxel.ai/demo/)',
    )
    .option('--delete', 'Delete remote files that do not exist locally')
    .option('--dry-run', 'Show what would be done without making changes')
    .option('--force', 'Upload all files, even if unchanged')
    .action(
      async (
        localDir: string,
        realmUrl: string,
        options: { delete?: boolean; dryRun?: boolean; force?: boolean },
      ) => {
        await pushCommand(localDir, realmUrl, options);
      },
    );
}

export async function pushCommand(
  localDir: string,
  realmUrl: string,
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

  if (!(await pathExists(localDir))) {
    console.error(`Local directory does not exist: ${localDir}`);
    process.exit(1);
  }

  try {
    const pusher = new RealmPusher(
      {
        realmUrl,
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
