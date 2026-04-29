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
import type { ProfileManager } from '../../lib/profile-manager';
import type { RealmAuthenticator } from '../../lib/realm-authenticator';
import { resolveRealmAuthenticator } from '../../lib/auth-resolver';
import { resolveRealmSecretSeed } from '../../lib/prompt';
import {
  type SyncManifest,
  computeFileHash,
  loadManifest,
  saveManifest,
  pathExists,
} from '../../lib/sync-manifest';

interface PushOptions extends SyncOptions {
  deleteRemote?: boolean;
  force?: boolean;
}

class RealmPusher extends RealmSyncBase {
  hasError = false;
  uploadedFiles: string[] = [];

  constructor(
    private pushOptions: PushOptions,
    authenticator: RealmAuthenticator,
  ) {
    super(pushOptions, authenticator);
  }

  async sync(): Promise<void> {
    console.log(
      `Starting push from ${this.options.localDir} to ${this.options.realmUrl}`,
    );

    console.log('Testing realm access...');
    let initialRemoteFiles: Map<string, boolean>;
    try {
      initialRemoteFiles = await this.getRemoteFileList('');
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
      realmUrl: this.normalizedRealmUrl,
      files: {},
      remoteMtimes: {},
    };

    const filesToUpload: Map<string, string> = new Map();
    const driftedPaths: Set<string> = new Set();

    const canGoIncremental =
      !this.pushOptions.force &&
      manifest !== null &&
      manifest.realmUrl === this.normalizedRealmUrl;

    if (!canGoIncremental) {
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

      const [remoteMtimes, hashResults] = await Promise.all([
        this.getRemoteMtimes(),
        Promise.all(
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
        ),
      ]);

      for (const entry of hashResults) {
        if (entry.protected) {
          skipped++;
          continue;
        }
        const previousHash = manifest!.files[entry.relativePath];
        const prevMtime = manifest!.remoteMtimes?.[entry.relativePath];
        const currMtime = remoteMtimes.get(entry.relativePath);

        const localChanged = previousHash !== entry.currentHash;
        const remoteMissing =
          previousHash !== undefined &&
          !initialRemoteFiles.has(entry.relativePath);
        const remoteMtimeChanged =
          prevMtime !== undefined &&
          currMtime !== undefined &&
          currMtime !== prevMtime;

        if (localChanged || remoteMissing || remoteMtimeChanged) {
          filesToUpload.set(entry.relativePath, entry.localPath);
          if (!localChanged && (remoteMissing || remoteMtimeChanged)) {
            driftedPaths.add(entry.relativePath);
          }
        } else {
          skipped++;
          newManifest.files[entry.relativePath] = entry.currentHash;
          if (prevMtime !== undefined) {
            newManifest.remoteMtimes![entry.relativePath] = prevMtime;
          }
        }
      }

      if (skipped > 0) {
        console.log(`Skipping ${skipped} unchanged files`);
      }

      if (driftedPaths.size > 0) {
        const list = Array.from(driftedPaths);
        const preview = list.slice(0, 5).join(', ');
        const suffix = list.length > 5 ? ', ...' : '';
        console.warn(
          `Warning: ${driftedPaths.size} file(s) changed on the realm since your last push; your local versions will overwrite them: ${preview}${suffix}`,
        );
      }
    }

    let uploadFailed = false;

    if (filesToUpload.size === 0) {
      console.log('No files to upload - everything is up to date');
    } else {
      console.log(`Uploading ${filesToUpload.size} file(s) via /_atomic...`);

      // Choose `op: add` vs `op: update` per file. When we have a
      // manifest, the choice reflects our *intent* so the atomic
      // endpoint can surface concurrent creation (409) and concurrent
      // deletion (404):
      //   - File not in our manifest         →  op: add
      //   - File in manifest, remote-missing →  op: add (drift re-create)
      //   - File in manifest, on the remote  →  op: update
      // With `--force`, or when there is no manifest (first push, or
      // recovery from a malformed manifest), we defer to the actual
      // remote state to avoid spurious 409/404s from intent the user
      // never expressed.
      const addPaths = new Set<string>();
      const deferToRemote = this.pushOptions.force || !manifest;
      for (const relativePath of filesToUpload.keys()) {
        if (deferToRemote) {
          if (!initialRemoteFiles.has(relativePath)) {
            addPaths.add(relativePath);
          }
        } else {
          const knownToManifest = manifest!.files[relativePath] !== undefined;
          const knownMissing =
            knownToManifest && !initialRemoteFiles.has(relativePath);
          if (!knownToManifest || knownMissing) {
            addPaths.add(relativePath);
          }
        }
      }

      const result = await this.uploadFilesAtomic(filesToUpload, addPaths);

      if (result.error) {
        uploadFailed = true;
        this.hasError = true;
        console.error(result.error.message);
        for (const entry of result.error.perFile) {
          let hint: string;
          if (entry.status === 409) {
            hint = `${entry.path} was created on the realm concurrently — run with --force to overwrite.`;
          } else if (entry.status === 404) {
            hint = `${entry.path} was removed from the realm concurrently — run with --force to re-create it from your local copy.`;
          } else {
            hint = `${entry.path}: ${entry.title}`;
          }
          console.error(`  ${hint}`);
        }
      } else if (result.succeeded.length > 0) {
        const uploaded = await Promise.all(
          result.succeeded.map(async (rel) => ({
            rel,
            hash: await computeFileHash(filesToUpload.get(rel)!),
          })),
        );
        for (const { rel, hash } of uploaded) {
          newManifest.files[rel] = hash;
        }
        this.uploadedFiles.push(...result.succeeded);
      }
    }

    if (this.pushOptions.deleteRemote) {
      const filesToDelete = new Set(initialRemoteFiles.keys());

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

    if (!this.options.dryRun && !uploadFailed && filesToUpload.size > 0) {
      try {
        const freshMtimes = await this.getRemoteMtimes();
        for (const rel of Object.keys(newManifest.files)) {
          const mtime = freshMtimes.get(rel);
          if (mtime !== undefined) {
            newManifest.remoteMtimes![rel] = mtime;
          }
        }
      } catch (error) {
        console.warn('Could not refresh remote mtimes after upload:', error);
      }
    }

    if (
      newManifest.remoteMtimes &&
      Object.keys(newManifest.remoteMtimes).length === 0
    ) {
      delete newManifest.remoteMtimes;
    }

    if (!this.options.dryRun && !uploadFailed) {
      await saveManifest(this.options.localDir, newManifest);
    }

    if (!this.options.dryRun && filesToUpload.size > 0 && !uploadFailed) {
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
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)',
    )
    .action(
      async (
        localDir: string,
        realmUrl: string,
        options: {
          delete?: boolean;
          dryRun?: boolean;
          force?: boolean;
          realmSecretSeed?: boolean;
        },
      ) => {
        const realmSecretSeed = await resolveRealmSecretSeed(
          options.realmSecretSeed === true,
        );
        await pushCommand(localDir, realmUrl, {
          delete: options.delete,
          dryRun: options.dryRun,
          force: options.force,
          realmSecretSeed,
        });
      },
    );
}

export interface PushResult {
  files: string[];
  error?: string;
}

export async function push(
  localDir: string,
  realmUrl: string,
  options: PushCommandOptions,
): Promise<PushResult> {
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
      return { files: [], error: resolution.error };
    }
    authenticator = resolution.authenticator;
  }

  if (!(await pathExists(localDir))) {
    return {
      files: [],
      error: `Local directory does not exist: ${localDir}`,
    };
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
      authenticator,
    );

    await pusher.sync();

    if (pusher.hasError) {
      return {
        files: pusher.uploadedFiles.sort(),
        error:
          'Push completed with errors. Some files may not have been uploaded.',
      };
    }

    return { files: pusher.uploadedFiles.sort() };
  } catch (error) {
    return {
      files: [],
      error: `Push failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function pushCommand(
  localDir: string,
  realmUrl: string,
  options: PushCommandOptions,
): Promise<void> {
  const result = await push(localDir, realmUrl, options);
  if (result.error) {
    console.error(`Error: ${result.error}`);
    process.exit(result.files.length > 0 ? 2 : 1);
  }
  console.log('Push completed successfully');
}
