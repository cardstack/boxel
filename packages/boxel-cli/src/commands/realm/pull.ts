import type { Command } from 'commander';
import { RealmSyncBase, type SyncOptions } from '../../lib/realm-sync-base.ts';
import {
  CheckpointManager,
  type CheckpointChange,
} from '../../lib/checkpoint-manager.ts';
import type { ProfileManager } from '../../lib/profile-manager.ts';
import type { RealmAuthenticator } from '../../lib/realm-authenticator.ts';
import { resolveRealmAuthenticator } from '../../lib/auth-resolver.ts';
import { resolveRealmIdentifier } from '../../lib/resolve-realm-identifier.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import * as fs from 'fs/promises';
import * as path from 'path';

interface PullOptions extends SyncOptions {
  deleteLocal?: boolean;
}

class RealmPuller extends RealmSyncBase {
  hasError = false;
  downloadedFiles: string[] = [];
  private pullOptions: PullOptions;

  constructor(pullOptions: PullOptions, authenticator: RealmAuthenticator) {
    super(pullOptions, authenticator);
    this.pullOptions = pullOptions;
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
          'Please check your credentials and realm permissions.',
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
  /**
   * Pre-resolved realm secret seed for administrative access. When set, the
   * CLI mints a JWT locally and skips Matrix login + /_server-session +
   * /_realm-auth. The `--realm-secret-seed` CLI flag is resolved via
   * `resolveRealmSecretSeed` (env var or interactive prompt) before being
   * passed here.
   */
  realmSecretSeed?: string;
  /**
   * @internal Test hook: supply an already-constructed authenticator,
   * bypassing both seed resolution and the profile flow.
   */
  authenticator?: RealmAuthenticator;
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
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)',
    )
    .action(
      async (
        realmUrl: string,
        localDir: string,
        options: {
          delete?: boolean;
          dryRun?: boolean;
          realmSecretSeed?: boolean;
        },
      ) => {
        const realmSecretSeed = await resolveRealmSecretSeed(
          options.realmSecretSeed === true,
        );
        const result = await pull(realmUrl, localDir, {
          delete: options.delete,
          dryRun: options.dryRun,
          realmSecretSeed,
        });
        if (result.error) {
          console.error(`Error: ${result.error}`);
          process.exit(result.files.length > 0 ? 2 : 1);
        }
        console.log('Pull completed successfully');
      },
    );
}

export async function pull(
  realmUrl: string,
  localDir: string,
  options: PullCommandOptions,
): Promise<{ files: string[]; error?: string }> {
  const resolvedRealm = resolveRealmIdentifier(realmUrl, {
    profileManager: options.profileManager,
  });
  if (!resolvedRealm.ok) {
    return { files: [], error: resolvedRealm.error };
  }
  realmUrl = resolvedRealm.url;
  const resolution = resolveRealmAuthenticator({
    realmUrl,
    realmSecretSeed: options.realmSecretSeed,
    profileManager: options.profileManager,
    authenticator: options.authenticator,
  });
  if (!resolution.ok) {
    return { files: [], error: resolution.error };
  }
  const authenticator = resolution.authenticator;

  try {
    const puller = new RealmPuller(
      {
        realmUrl,
        localDir,
        deleteLocal: options.delete,
        dryRun: options.dryRun,
      },
      authenticator,
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
