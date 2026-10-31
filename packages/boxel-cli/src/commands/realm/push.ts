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
import { resolveRealmIdentifier } from '../../lib/resolve-realm-identifier.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import {
  type SyncManifest,
  computeFileHash,
  loadManifest,
  saveManifest,
  pathExists,
} from '../../lib/sync-manifest.ts';
import { listUnchangedSince } from '../../lib/git-changes.ts';

interface PushOptions extends SyncOptions {
  deleteRemote?: boolean;
  force?: boolean;
  changedSince?: string[];
}

// Fresh realms always include these server-managed cards even when the local
// workspace has never pulled them. Treat them as realm artifacts, not user
// drift, so `push --delete` only removes genuine remote-only user files.
const REMOTE_DELETE_EXCLUSIONS = new Set(['index.json', 'realm.json']);

class RealmPusher extends RealmSyncBase {
  hasError = false;
  private pushOptions: PushOptions;

  constructor(pushOptions: PushOptions, authenticator: RealmAuthenticator) {
    super(pushOptions, authenticator);
    this.pushOptions = pushOptions;
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

    const changedSince = this.pushOptions.changedSince;
    const canGoIncremental =
      !this.pushOptions.force &&
      manifest !== null &&
      manifest.realmUrl === this.normalizedRealmUrl;

    if (changedSince !== undefined) {
      // The baseline is git, not a manifest, so a fresh checkout (a CI
      // runner) uploads only what git says changed. Each revision is one the
      // realm's files may hold: the one it was last fully synced to, plus any
      // a later sync wrote part of before it failed. A file is skipped only
      // when git tracks it, reports it unchanged against every one of them,
      // and the realm has it. Everything else goes up, including files git
      // doesn't track or ignores by rules the push doesn't read. Skipped
      // files are recorded in the new manifest as matching the realm.
      const unchangedSets = await Promise.all(
        changedSince.map((revision) =>
          listUnchangedSince(this.options.localDir, revision),
        ),
      );
      const unchanged = new Set(
        [...unchangedSets[0]].filter((p) =>
          unchangedSets.every((set) => set.has(p)),
        ),
      );
      const baseline = changedSince.join(', ');
      let skipped = 0;
      let missingRemote = 0;
      for (const [relativePath, localPath] of localFiles) {
        if (isProtectedFile(relativePath)) continue;
        if (!unchanged.has(relativePath)) {
          filesToUpload.set(relativePath, localPath);
        } else if (!initialRemoteFiles.has(relativePath)) {
          filesToUpload.set(relativePath, localPath);
          missingRemote++;
        } else {
          skipped++;
          newManifest.files[relativePath] = await computeFileHash(localPath);
        }
      }
      console.log(
        `${filesToUpload.size - missingRemote} file(s) changed since ${baseline}`,
      );
      if (missingRemote > 0) {
        console.log(
          `${missingRemote} unchanged file(s) are missing from the realm and will be uploaded`,
        );
      }
      if (skipped > 0) {
        console.log(`Skipping ${skipped} files unchanged since ${baseline}`);
      }
    } else if (!canGoIncremental) {
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
    let uploadUnanswered: string[] = [];

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
      // With `--force`, `--changed-since`, or when there is no manifest
      // (first push, or recovery from a malformed manifest), we defer to
      // the actual remote state to avoid spurious 409/404s from intent the
      // user never expressed.
      const addPaths = new Set<string>();
      const deferToRemote =
        this.pushOptions.force || changedSince !== undefined || !manifest;
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
      uploadUnanswered = result.unanswered;

      // Record every file the server actually wrote before surfacing
      // errors. uploadFilesAtomic can return both `succeeded` and
      // `error` when the atomic text batch lands but a per-file
      // binary POST fails — dropping the manifest update in that
      // case would force a re-add on the next push (409 cascade).
      if (result.succeeded.length > 0) {
        // Guard the map lookup: `succeeded` should only carry paths from
        // `filesToUpload`, but a server response in an unexpected shape must
        // degrade to a manifest gap (re-upload next push), not a crash.
        const uploaded = await Promise.all(
          result.succeeded
            .filter((rel) => filesToUpload.has(rel))
            .map(async (rel) => ({
              rel,
              hash: await computeFileHash(filesToUpload.get(rel)!),
            })),
        );
        for (const { rel, hash } of uploaded) {
          newManifest.files[rel] = hash;
        }
      }

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
      }
    }

    if (this.pushOptions.deleteRemote && uploadFailed) {
      // Deleting after a partial upload would leave the realm matching
      // neither the old local state nor the new one.
      console.error('Skipping --delete because the upload did not complete');
    } else if (this.pushOptions.deleteRemote) {
      const filesToDelete = new Set(initialRemoteFiles.keys());
      const skippedDeleteArtifacts: string[] = [];

      for (const relativePath of filesToDelete) {
        if (isProtectedFile(relativePath)) {
          filesToDelete.delete(relativePath);
          continue;
        }
        if (REMOTE_DELETE_EXCLUSIONS.has(relativePath)) {
          filesToDelete.delete(relativePath);
          skippedDeleteArtifacts.push(relativePath);
        }
      }

      for (const relativePath of localFiles.keys()) {
        filesToDelete.delete(relativePath);
      }

      if (skippedDeleteArtifacts.length > 0) {
        console.log(
          `Skipping ${skippedDeleteArtifacts.length} realm-managed remote artifact(s): ${skippedDeleteArtifacts.join(', ')}`,
        );
      }

      if (filesToDelete.size > 0) {
        const deletePlan = Array.from(filesToDelete).sort();
        console.log(
          `Deleting ${deletePlan.length} remote files that don't exist locally: ${deletePlan.join(', ')}`,
        );

        for (const relativePath of deletePlan) {
          try {
            await this.deleteFile(relativePath);
          } catch (error) {
            this.hasError = true;
            console.error(`Error deleting ${relativePath}:`, error);
          }
        }
      }
    }

    // Refresh mtimes and save the manifest even on partial failure —
    // newManifest.files holds the files the server wrote (unchanged
    // carry-overs + succeeded uploads) with their hashes, so persisting it
    // avoids re-uploading text files that landed. Files --changed-since
    // skipped have no mtime yet, even when nothing uploads, and a later push
    // needs one to notice a realm-side edit.
    if (
      !this.options.dryRun &&
      (filesToUpload.size > 0 || changedSince !== undefined)
    ) {
      let remoteNow: Set<string> = new Set(initialRemoteFiles.keys());
      try {
        const freshMtimes = await this.getRemoteMtimes();
        remoteNow = new Set(freshMtimes.keys());
        for (const rel of Object.keys(newManifest.files)) {
          const mtime = freshMtimes.get(rel);
          if (mtime !== undefined) {
            newManifest.remoteMtimes![rel] = mtime;
          }
        }
      } catch (error) {
        console.warn('Could not refresh remote mtimes after upload:', error);
      }
      // A file this push didn't confirm writing keeps what the last manifest
      // knew of it, its realm mtime included, so the next push treats it as
      // this one did. The exception is a new file in a request that got no
      // answer and is on the realm now: this push wrote it, so it's recorded
      // with a hash no file has and the next push sends it as an update.
      const unanswered = new Set(uploadUnanswered);
      for (const rel of filesToUpload.keys()) {
        if (newManifest.files[rel] !== undefined) continue;
        if (
          unanswered.has(rel) &&
          !initialRemoteFiles.has(rel) &&
          remoteNow.has(rel)
        ) {
          newManifest.files[rel] = '';
        } else if (manifest?.files[rel] !== undefined) {
          newManifest.files[rel] = manifest.files[rel];
          const mtime = manifest.remoteMtimes?.[rel];
          if (mtime !== undefined) {
            newManifest.remoteMtimes![rel] = mtime;
          } else {
            delete newManifest.remoteMtimes![rel];
          }
        }
      }
    }

    if (
      newManifest.remoteMtimes &&
      Object.keys(newManifest.remoteMtimes).length === 0
    ) {
      delete newManifest.remoteMtimes;
    }

    if (!this.options.dryRun) {
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
  /**
   * False to push without the realm announcing the changes to its
   * subscribers (see `SyncOptions.realmEvents`).
   */
  realmEvents?: boolean;
  atomicBatchSize?: number;
  /**
   * Git revisions the realm's files may hold. Only files that differ from any
   * of them in the local git checkout, files git doesn't track, and files the
   * realm is missing are uploaded.
   */
  changedSince?: string[];
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
      '--changed-since <revision>',
      'Upload only files that differ from this git revision (one the realm already holds), plus files git does not track and files missing from the realm, instead of comparing against the sync manifest. Repeat it to name every revision the realm may hold part of, such as one a failed sync stopped partway through; a file is skipped only when it matches all of them. A file edited directly on the realm stays as it is until it changes in git. The local directory must be a git checkout whose history reaches each revision',
      (revision: string, previous: string[] = []) => [...previous, revision],
    )
    .option(
      '--no-realm-events',
      'Index the pushed changes without announcing them to open tabs, which pick them up on their next load (for deploys)',
    )
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED; names the paired Matrix server from MATRIX_SERVER_NAME)',
    )
    .action(
      async (
        localDir: string,
        realmUrl: string,
        options: {
          delete?: boolean;
          dryRun?: boolean;
          force?: boolean;
          realmEvents?: boolean;
          changedSince?: string[];
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
          realmEvents: options.realmEvents,
          changedSince: options.changedSince,
          realmSecretSeed,
        });
      },
    );
}

export async function pushCommand(
  localDir: string,
  realmUrl: string,
  options: PushCommandOptions,
): Promise<void> {
  const resolvedRealm = resolveRealmIdentifier(realmUrl, {
    profileManager: options.profileManager,
  });
  if (!resolvedRealm.ok) {
    console.error(`Error: ${resolvedRealm.error}`);
    process.exit(1);
  }
  realmUrl = resolvedRealm.url;
  const resolution = resolveRealmAuthenticator({
    realmUrl,
    realmSecretSeed: options.realmSecretSeed,
    profileManager: options.profileManager,
    authenticator: options.authenticator,
  });
  if (!resolution.ok) {
    console.error(`Error: ${resolution.error}`);
    process.exit(1);
  }
  const authenticator = resolution.authenticator;

  if (!(await pathExists(localDir))) {
    console.error(`Local directory does not exist: ${localDir}`);
    process.exit(1);
  }

  const changedSince = options.changedSince?.length
    ? options.changedSince
    : undefined;
  if (options.force && changedSince !== undefined) {
    console.error(
      'Error: --force uploads every file and --changed-since uploads only changed ones; pass one of them.',
    );
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
        realmEvents: options.realmEvents,
        atomicBatchSize: options.atomicBatchSize,
        changedSince,
      },
      authenticator,
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
