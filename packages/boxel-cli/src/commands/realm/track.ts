import { InvalidArgumentError, type Command } from 'commander';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { RealmSyncBase, isProtectedFile } from '../../lib/realm-sync-base';
import {
  CheckpointManager,
  type Checkpoint,
  type CheckpointChange,
} from '../../lib/checkpoint-manager';
import {
  type SyncManifest,
  computeFileHash,
  loadManifest,
  saveManifest,
} from '../../lib/sync-manifest';
import type { ProfileManager } from '../../lib/profile-manager';
import type { RealmAuthenticator } from '../../lib/realm-authenticator';
import { resolveRealmAuthenticator } from '../../lib/auth-resolver';
import { resolveRealmSecretSeed } from '../../lib/prompt';
import {
  acquireSyncLock,
  releaseSyncLock,
  type SyncLockInfo,
  type LockKind,
} from '../../lib/sync-lock';
import {
  FG_CYAN,
  FG_GREEN,
  FG_RED,
  FG_YELLOW,
  DIM,
  RESET,
} from '../../lib/colors';

export interface TrackRealmSpec {
  realmUrl: string;
  localDir: string;
}

interface FileState {
  mtime: number;
  size: number;
}

interface PendingChange {
  status: 'added' | 'modified' | 'deleted';
  mtime: number;
  size: number;
}

export interface TrackFlushResult {
  added: string[];
  modified: string[];
  deleted: string[];
  pushed: string[];
  pushFailed: { path: string; reason: string }[];
  checkpoint: Checkpoint | null;
}

/**
 * Tracks a single localDir → realm pair: detects local FS changes via
 * fs.watch + 2s polling, debounces, gates with content-hash, creates a
 * local checkpoint, and (with --push) batch-uploads add/update changes
 * to the realm via /_atomic. Deletions are recorded in the checkpoint
 * but not pushed — server-side `op: 'remove'` is unimplemented and
 * per-file DELETE was scoped out for this PR. See follow-up.
 */
export class RealmTracker extends RealmSyncBase {
  readonly name: string;
  private readonly debounceMs: number;
  private readonly minIntervalMs: number;
  private readonly quiet: boolean;
  private readonly verbose: boolean;
  private readonly push: boolean;
  private readonly checkpointManager: CheckpointManager;
  private readonly fileStates = new Map<string, FileState>();
  private readonly pendingChanges = new Map<string, PendingChange>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private lastCheckpointTime = 0;
  private fsWatcher: fsSync.FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    spec: TrackRealmSpec,
    authenticator: RealmAuthenticator,
    options: {
      debounceMs: number;
      minIntervalMs: number;
      quiet: boolean;
      verbose: boolean;
      push: boolean;
    },
  ) {
    super({ realmUrl: spec.realmUrl, localDir: spec.localDir }, authenticator);
    this.debounceMs = options.debounceMs;
    this.minIntervalMs = options.minIntervalMs;
    this.quiet = options.quiet;
    this.verbose = options.verbose;
    this.push = options.push;
    this.checkpointManager = new CheckpointManager(spec.localDir);
    this.name = deriveRealmName(this.normalizedRealmUrl);
  }

  /** RealmSyncBase requires `sync()`. Single-pass scan-and-flush. */
  async sync(): Promise<void> {
    await this.scanForChanges();
    await this.flushPending(true);
  }

  get localDir(): string {
    return this.options.localDir;
  }

  get realmUrl(): string {
    return this.normalizedRealmUrl;
  }

  get pendingCount(): number {
    return this.pendingChanges.size;
  }

  /**
   * Pre-flight:
   *   1. With --push: require a sync manifest pointing at this realm and
   *      smoke-test auth by listing the remote root.
   *   2. Initialize the .boxel-history checkpoint repo if needed.
   *   3. Seed `fileStates` from a recursive walk so the first poll only
   *      reports actual changes, not the initial inventory.
   */
  async initialize(): Promise<void> {
    if (this.push) {
      const manifest = await loadManifest(this.options.localDir);
      if (!manifest) {
        throw new Error(
          `--push requires a synced workspace. Run "boxel realm sync ${this.options.localDir} ${this.normalizedRealmUrl}" first.`,
        );
      }
      if (manifest.realmUrl !== this.normalizedRealmUrl) {
        throw new Error(
          `Manifest realm URL (${manifest.realmUrl}) does not match the target realm (${this.normalizedRealmUrl}). Re-sync to align.`,
        );
      }
      // Surface auth/network failures here, before we enter the loop —
      // matches legacy track's startup JWT check.
      await this.getRemoteFileList('');
    }

    if (!(await this.checkpointManager.isInitialized())) {
      await this.checkpointManager.init();
    }

    await this.seedFileStates(this.options.localDir);
  }

  private async seedFileStates(dir: string, prefix = ''): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err: any) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      if (shouldSkipEntry(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await this.seedFileStates(full, rel);
      } else {
        try {
          const stats = await fs.stat(full);
          this.fileStates.set(rel, {
            mtime: stats.mtimeMs,
            size: stats.size,
          });
        } catch (err: any) {
          if (err.code !== 'ENOENT') throw err;
        }
      }
    }
  }

  /**
   * Walk localDir, diff against `fileStates`, and update
   * `pendingChanges`. Returns true if at least one new pending entry
   * was added or upgraded.
   */
  async scanForChanges(): Promise<boolean> {
    const current = new Map<string, FileState>();
    await this.collectFiles(this.options.localDir, current);

    let hasNew = false;

    for (const [file, state] of current) {
      if (isProtectedFile(file)) continue;
      const prev = this.fileStates.get(file);
      if (!prev) {
        if (this.recordPending(file, { status: 'added', ...state })) {
          hasNew = true;
        }
      } else if (state.mtime > prev.mtime || state.size !== prev.size) {
        if (this.recordPending(file, { status: 'modified', ...state })) {
          hasNew = true;
        }
      }
    }

    for (const file of this.fileStates.keys()) {
      if (isProtectedFile(file)) continue;
      if (!current.has(file)) {
        if (
          this.recordPending(file, { status: 'deleted', mtime: 0, size: 0 })
        ) {
          hasNew = true;
        }
      }
    }

    this.fileStates.clear();
    for (const [file, state] of current) {
      this.fileStates.set(file, state);
    }

    return hasNew;
  }

  private async collectFiles(
    dir: string,
    accum: Map<string, FileState>,
    prefix = '',
  ): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err: any) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      if (shouldSkipEntry(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await this.collectFiles(full, accum, rel);
      } else {
        try {
          const stats = await fs.stat(full);
          accum.set(rel, { mtime: stats.mtimeMs, size: stats.size });
        } catch (err: any) {
          if (err.code !== 'ENOENT') throw err;
        }
      }
    }
  }

  private recordPending(file: string, change: PendingChange): boolean {
    const existing = this.pendingChanges.get(file);
    if (
      existing &&
      existing.status === change.status &&
      existing.mtime === change.mtime &&
      existing.size === change.size
    ) {
      return false;
    }
    this.pendingChanges.set(file, change);
    return true;
  }

  /**
   * Schedule a debounced flush. Subsequent calls reset the timer so a
   * burst of edits lands in a single checkpoint.
   */
  scheduleFlush(onFlush?: (result: TrackFlushResult) => void): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null;
      try {
        const result = await this.flushPending();
        if (result) onFlush?.(result);
      } catch (err) {
        console.error(
          `${FG_RED}[${this.name}] flush error:${RESET}`,
          err instanceof Error ? err.message : err,
        );
      }
    }, this.debounceMs);
  }

  /**
   * Apply pending changes: hash-gate, create a local checkpoint, and
   * (with --push) batch-upload adds/updates. Honors the min-interval
   * gate unless `force` is set (used on shutdown to flush before exit).
   * Returns null if the call was deferred (waiting on min-interval) or
   * if there's nothing pending.
   */
  async flushPending(force = false): Promise<TrackFlushResult | null> {
    if (this.pendingChanges.size === 0) return null;

    const now = Date.now();
    const elapsed = now - this.lastCheckpointTime;
    if (!force && elapsed < this.minIntervalMs) {
      if (!this.intervalTimer) {
        const wait = this.minIntervalMs - elapsed;
        if (!this.quiet) {
          console.log(
            `${DIM}[${timestamp()}]${RESET} [${this.name}] ${FG_YELLOW}⏳ waiting ${Math.ceil(
              wait / 1000,
            )}s before next checkpoint${RESET}`,
          );
        }
        this.intervalTimer = setTimeout(async () => {
          this.intervalTimer = null;
          try {
            await this.flushPending();
          } catch (err) {
            console.error(
              `${FG_RED}[${this.name}] flush error:${RESET}`,
              err instanceof Error ? err.message : err,
            );
          }
        }, wait);
      }
      return null;
    }

    // Snapshot then clear before any await — anything an interleaved
    // scan() records during this flush rolls into the next pass.
    const drained = new Map(this.pendingChanges);
    this.pendingChanges.clear();

    // Hash-gate: drop modified entries whose content hash matches the
    // manifest. Stops editors that touch-but-don't-change from creating
    // empty checkpoints.
    const manifest = await loadManifest(this.options.localDir);
    if (manifest && manifest.realmUrl === this.normalizedRealmUrl) {
      for (const [file, change] of Array.from(drained.entries())) {
        if (change.status !== 'modified') continue;
        const prevHash = manifest.files[file];
        if (!prevHash) continue;
        try {
          const currHash = await computeFileHash(
            path.join(this.options.localDir, file),
          );
          if (currHash === prevHash) {
            drained.delete(file);
          }
        } catch (err: any) {
          // File vanished between scan and hash; reclassify as a delete
          // and let the next pass handle it.
          if (err.code !== 'ENOENT') throw err;
          drained.delete(file);
          this.pendingChanges.set(file, {
            status: 'deleted',
            mtime: 0,
            size: 0,
          });
        }
      }
    }

    if (drained.size === 0) {
      return {
        added: [],
        modified: [],
        deleted: [],
        pushed: [],
        pushFailed: [],
        checkpoint: null,
      };
    }

    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    const changes: CheckpointChange[] = [];
    for (const [file, change] of drained) {
      changes.push({ file, status: change.status });
      if (change.status === 'added') added.push(file);
      else if (change.status === 'modified') modified.push(file);
      else deleted.push(file);
    }

    // Always checkpoint locally before any network I/O so a push
    // failure never loses the local history record.
    const checkpoint = await this.checkpointManager.createCheckpoint(
      'local',
      changes,
    );

    this.lastCheckpointTime = Date.now();

    let pushed: string[] = [];
    let pushFailed: { path: string; reason: string }[] = [];

    if (this.push) {
      const result = await this.pushDrained(added, modified, deleted);
      pushed = result.pushed;
      pushFailed = result.failed;
      // Re-queue files whose push failed transiently so the next cycle
      // retries them.
      for (const fail of pushFailed) {
        const status = added.includes(fail.path) ? 'added' : 'modified';
        try {
          const stats = await fs.stat(
            path.join(this.options.localDir, fail.path),
          );
          this.pendingChanges.set(fail.path, {
            status,
            mtime: stats.mtimeMs,
            size: stats.size,
          });
        } catch (err: any) {
          if (err.code !== 'ENOENT') throw err;
        }
      }
    } else if (deleted.length > 0 && this.verbose) {
      for (const file of deleted) {
        console.log(
          `${DIM}[${timestamp()}]${RESET} [${this.name}] [VERBOSE] Skipping delete on push (deferred): ${file}`,
        );
      }
    }

    return { added, modified, deleted, pushed, pushFailed, checkpoint };
  }

  /**
   * Push add/update operations to /_atomic. Deletions are not pushed.
   * After a successful push the manifest is updated with fresh hashes
   * and remoteMtimes so a later `realm pull` doesn't see drift.
   */
  private async pushDrained(
    added: string[],
    modified: string[],
    deleted: string[],
  ): Promise<{
    pushed: string[];
    failed: { path: string; reason: string }[];
  }> {
    if (deleted.length > 0 && this.verbose) {
      for (const file of deleted) {
        console.log(
          `${DIM}[${timestamp()}]${RESET} [${this.name}] [VERBOSE] Skipping delete on push (deferred): ${file}`,
        );
      }
    }

    const allUploads = [...added, ...modified];
    if (allUploads.length === 0) {
      return { pushed: [], failed: [] };
    }

    // Sort modules (.gts/.ts/.js) before instances (.json) so the
    // atomic doc processes definitions before instances. uploadFilesAtomic
    // iterates the Map in insertion order, so a sorted Map yields a
    // sorted operations array.
    const sorted = allUploads.sort((a, b) => {
      const ka = pushOrderKey(a);
      const kb = pushOrderKey(b);
      if (ka !== kb) return ka - kb;
      return a < b ? -1 : a > b ? 1 : 0;
    });

    const filesToUpload = new Map<string, string>();
    for (const rel of sorted) {
      filesToUpload.set(rel, path.join(this.options.localDir, rel));
    }

    // Mirror RealmPusher's add/update discrimination: use *intent*, not
    // just remote presence. A file not in our manifest expresses "I'm
    // adding this" — if the realm has a file at that href anyway,
    // someone else created it concurrently and the atomic 409 surfaces
    // the conflict instead of silently overwriting their changes.
    const manifest = await loadManifest(this.options.localDir);
    const remoteFiles = await this.getRemoteFileList('');
    const addPaths = new Set<string>();
    for (const rel of filesToUpload.keys()) {
      const knownToManifest = manifest?.files[rel] !== undefined;
      const knownMissingOnRemote =
        knownToManifest && !remoteFiles.has(rel);
      if (!knownToManifest || knownMissingOnRemote) {
        addPaths.add(rel);
      }
    }

    const result = await this.uploadFilesAtomic(filesToUpload, addPaths);

    if (result.error) {
      const failed = result.error.perFile.map((p) => ({
        path: p.path,
        reason: `${p.status} ${p.title}`,
      }));
      console.error(
        `${FG_RED}[${this.name}] push failed: ${result.error.message}${RESET}`,
      );
      for (const entry of result.error.perFile) {
        let hint: string;
        if (entry.status === 409) {
          hint = `${entry.path} was created on the realm concurrently — will retry on the next cycle.`;
        } else if (entry.status === 404) {
          hint = `${entry.path} was removed from the realm concurrently — will retry on the next cycle.`;
        } else {
          hint = `${entry.path}: ${entry.title}`;
        }
        console.error(`  ${hint}`);
      }
      return { pushed: [], failed };
    }

    const succeeded = new Set(result.succeeded);
    if (succeeded.size > 0) {
      try {
        await this.updateManifestForPush(succeeded);
      } catch (err) {
        console.error(
          `${FG_RED}[${this.name}] manifest update failed:${RESET}`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return { pushed: result.succeeded, failed: [] };
  }

  private async updateManifestForPush(succeeded: Set<string>): Promise<void> {
    const prior = await loadManifest(this.options.localDir);
    if (!prior) return;
    const next: SyncManifest = {
      realmUrl: this.normalizedRealmUrl,
      files: { ...prior.files },
      remoteMtimes: { ...(prior.remoteMtimes ?? {}) },
    };
    for (const rel of succeeded) {
      try {
        next.files[rel] = await computeFileHash(
          path.join(this.options.localDir, rel),
        );
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    try {
      const fresh = await this.getRemoteMtimes();
      for (const rel of succeeded) {
        const mtime = fresh.get(rel);
        if (mtime !== undefined) {
          next.remoteMtimes![rel] = mtime;
        }
      }
    } catch {
      // Best-effort; remote mtimes will refresh on the next pull.
    }
    if (Object.keys(next.remoteMtimes ?? {}).length === 0) {
      delete next.remoteMtimes;
    }
    await saveManifest(this.options.localDir, next);
  }

  /**
   * Wire fs.watch (recursive on macOS/Windows; flat on Linux) plus a
   * 2s safety poll. The poll catches editors whose write pattern
   * (atomic-rename, etc.) doesn't reliably fire fs.watch.
   */
  startWatching(onFlush: (result: TrackFlushResult) => void): void {
    const isLinux = process.platform === 'linux';
    const watchOptions: fsSync.WatchOptions = isLinux
      ? {}
      : { recursive: true };

    try {
      this.fsWatcher = fsSync.watch(
        this.options.localDir,
        watchOptions,
        (_eventType, filename) => {
          if (!filename) return;
          const name =
            typeof filename === 'string' ? filename : filename.toString();
          const head = name.split(path.sep)[0];
          if (shouldSkipEntry(head)) return;
          this.triggerScan(onFlush);
        },
      );
      this.fsWatcher.on('error', (err) => {
        if (!this.quiet) {
          console.error(
            `${FG_RED}[${this.name}] fs.watch error:${RESET}`,
            err.message,
          );
        }
      });
    } catch {
      if (!this.quiet) {
        console.log(
          `${DIM}[${timestamp()}]${RESET} [${this.name}] fs.watch unavailable; polling only`,
        );
      }
    }

    this.pollTimer = setInterval(() => {
      this.triggerScan(onFlush);
    }, 2000);
  }

  private triggerScan(onFlush: (result: TrackFlushResult) => void): void {
    void this.scanForChanges()
      .then((hasNew) => {
        if (hasNew) {
          if (!this.quiet) {
            console.log(
              `${DIM}[${timestamp()}]${RESET} [${this.name}] ${FG_YELLOW}⚡ ${this.pendingCount} change(s) detected${RESET}`,
            );
          }
          this.scheduleFlush(onFlush);
        }
      })
      .catch((err) =>
        console.error(
          `${FG_RED}[${this.name}] scan error:${RESET}`,
          err instanceof Error ? err.message : err,
        ),
      );
  }

  shutdown(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.intervalTimer) {
      clearTimeout(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
  }
}

function pushOrderKey(rel: string): number {
  const ext = rel.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  if (ext === '.gts' || ext === '.ts' || ext === '.js') return 0;
  if (ext === '.json') return 2;
  return 1;
}

function shouldSkipEntry(name: string | undefined): boolean {
  if (!name) return false;
  if (name === '.git' || name === 'node_modules') return true;
  if (name.startsWith('.boxel-')) return true;
  if (name.startsWith('.') && name !== '.realm.json') return true;
  return false;
}

export interface TrackRealmsOptions {
  intervalMs?: number;
  debounceMs?: number;
  quiet?: boolean;
  verbose?: boolean;
  push?: boolean;
  profileManager?: ProfileManager;
  realmSecretSeed?: string;
  authenticator?: RealmAuthenticator;
  signal?: AbortSignal;
}

export interface TrackRealmsResult {
  trackers: RealmTracker[];
  error?: string;
}

const noAuthAuthenticator: RealmAuthenticator = {
  async authedRealmFetch() {
    throw new Error(
      'Network operation attempted on a tracker started without --push.',
    );
  },
};

/**
 * Programmatic entry point. The CLI passes a single spec; the array
 * shape lets tests / future multi-realm callers reuse the loop. With
 * --push the authenticator is resolved once from `specs[0]` and shared
 * across all trackers, so multi-realm callers must use realms that
 * share a profile / secret seed.
 */
export async function trackRealms(
  specs: TrackRealmSpec[],
  options: TrackRealmsOptions = {},
): Promise<TrackRealmsResult> {
  if (specs.length === 0) {
    return { trackers: [], error: 'No realms provided to track.' };
  }

  const intervalMs = options.intervalMs ?? 10_000;
  const debounceMs = options.debounceMs ?? 3_000;
  const quiet = options.quiet ?? false;
  const verbose = options.verbose ?? false;
  const push = options.push ?? false;

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return { trackers: [], error: '`intervalMs` must be a positive number.' };
  }
  if (!Number.isFinite(debounceMs) || debounceMs < 0) {
    return {
      trackers: [],
      error: '`debounceMs` must be a non-negative number.',
    };
  }

  let authenticator: RealmAuthenticator = noAuthAuthenticator;
  if (push) {
    if (options.authenticator) {
      authenticator = options.authenticator;
    } else {
      const resolution = resolveRealmAuthenticator({
        realmUrl: specs[0].realmUrl,
        realmSecretSeed: options.realmSecretSeed,
        profileManager: options.profileManager,
      });
      if (!resolution.ok) {
        return { trackers: [], error: resolution.error };
      }
      authenticator = resolution.authenticator;
    }
  }

  const lockedDirs: string[] = [];
  for (const spec of specs) {
    const result = await acquireSyncLock(spec.localDir, 'track', spec.realmUrl);
    if (!result.ok) {
      for (const dir of lockedDirs) await releaseSyncLock(dir, 'track');
      return {
        trackers: [],
        error: formatLockedError(
          spec.localDir,
          result.existing,
          result.conflictKind,
        ),
      };
    }
    if (result.staleOverwrote && !quiet) {
      console.log(
        `${DIM}[${timestamp()}] overwrote stale lock at ${spec.localDir}${RESET}`,
      );
    }
    lockedDirs.push(spec.localDir);
  }

  const trackers: RealmTracker[] = [];
  for (const spec of specs) {
    const tracker = new RealmTracker(spec, authenticator, {
      debounceMs,
      minIntervalMs: intervalMs,
      quiet,
      verbose,
      push,
    });
    try {
      await tracker.initialize();
    } catch (err) {
      for (const t of trackers) t.shutdown();
      for (const dir of lockedDirs) await releaseSyncLock(dir, 'track');
      return {
        trackers: [],
        error: `Failed to initialize track on ${spec.realmUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    trackers.push(tracker);
  }

  if (!quiet) {
    console.log(
      `${FG_CYAN}⇆ Tracking ${trackers.length} realm${
        trackers.length > 1 ? 's' : ''
      }:${RESET}`,
    );
    for (const t of trackers) {
      console.log(`  ${t.localDir} ${DIM}→${RESET} ${t.name}`);
    }
    console.log(
      `  ${DIM}Debounce: ${debounceMs / 1000}s, Min interval: ${intervalMs / 1000}s${RESET}`,
    );
    if (push) console.log(`  ${DIM}Push: enabled${RESET}`);
    if (verbose) console.log(`  ${DIM}Verbose: enabled${RESET}`);
    console.log(`  ${DIM}Press Ctrl+C to stop${RESET}\n`);
  }

  for (const tracker of trackers) {
    tracker.startWatching((result) => {
      if (!quiet) logFlush(tracker.name, result);
    });
  }

  let stopped = false;
  await new Promise<void>((resolve) => {
    let sigintHandler: (() => void) | null = null;
    let sigtermHandler: (() => void) | null = null;

    const cleanup = async () => {
      if (stopped) return;
      stopped = true;
      // Force-flush before shutdown so anything buffered lands in a final
      // checkpoint even when we're under the min-interval gate.
      for (const t of trackers) {
        try {
          await t.flushPending(true);
        } catch (err) {
          console.error(
            `${FG_RED}[${t.name}] final flush error:${RESET}`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      for (const t of trackers) t.shutdown();
      if (sigintHandler) process.off('SIGINT', sigintHandler);
      if (sigtermHandler) process.off('SIGTERM', sigtermHandler);
      for (const dir of lockedDirs) {
        try {
          await releaseSyncLock(dir, 'track');
        } catch {
          // Best-effort — a leftover lock will be detected as stale next run.
        }
      }
      resolve();
    };

    if (options.signal) {
      if (options.signal.aborted) {
        void cleanup();
        return;
      }
      options.signal.addEventListener('abort', () => void cleanup(), {
        once: true,
      });
    } else {
      sigintHandler = () => {
        if (!quiet) console.log(`\n${FG_CYAN}⇆ Tracking stopped${RESET}`);
        void cleanup();
      };
      sigtermHandler = sigintHandler;
      process.on('SIGINT', sigintHandler);
      process.on('SIGTERM', sigtermHandler);
    }
  });

  return { trackers };
}

function formatLockedError(
  localDir: string,
  info: SyncLockInfo,
  conflictKind: LockKind,
): string {
  if (conflictKind === 'watch') {
    return (
      `A boxel realm watch process is already active for ${localDir} ` +
      `(pid ${info.pid}, started ${info.startedAt}). Stop it before starting track — ` +
      `running track and watch against the same directory creates a push/pull loop.`
    );
  }
  return (
    `A boxel realm track process is already active for ${localDir} ` +
    `(pid ${info.pid}, started ${info.startedAt}). Stop it before starting ` +
    `a new one, or remove ${path.join(localDir, '.boxel-track.lock')} if it's stale.`
  );
}

function logFlush(name: string, result: TrackFlushResult): void {
  if (result.checkpoint) {
    const tag = result.checkpoint.isMajor ? '[MAJOR]' : '[minor]';
    console.log(
      `${DIM}[${timestamp()}]${RESET} [${name}] ${FG_GREEN}checkpoint:${RESET} ${result.checkpoint.shortHash} ${tag} ${result.checkpoint.message}`,
    );
  }
  if (result.added.length || result.modified.length || result.deleted.length) {
    const parts: string[] = [];
    if (result.added.length) parts.push(`+${result.added.length}`);
    if (result.modified.length) parts.push(`~${result.modified.length}`);
    if (result.deleted.length) parts.push(`-${result.deleted.length}`);
    console.log(`  ${DIM}${parts.join(' ')}${RESET}`);
  }
  if (result.pushed.length) {
    console.log(
      `  ${FG_GREEN}✓ pushed ${result.pushed.length} file(s)${RESET}`,
    );
  }
  if (result.pushFailed.length) {
    console.log(
      `  ${FG_RED}✗ ${result.pushFailed.length} push failure(s) (will retry)${RESET}`,
    );
  }
}

function deriveRealmName(normalizedUrl: string): string {
  const parts = normalizedUrl.replace(/\/$/, '').split('/');
  return parts.slice(-2).join('/');
}

function timestamp(): string {
  return new Date().toLocaleTimeString();
}

function parsePositiveSeconds(name: string): (value: string) => number {
  return (value: string) => {
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n) || n <= 0) {
      throw new InvalidArgumentError(`${name} must be a positive number.`);
    }
    return n;
  };
}

function parseNonNegativeSeconds(name: string): (value: string) => number {
  return (value: string) => {
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new InvalidArgumentError(`${name} must be a non-negative number.`);
    }
    return n;
  };
}

export function registerTrackCommand(realm: Command): void {
  realm
    .command('track')
    .description(
      'Watch a local directory for changes, create checkpoints, and (with --push) sync them to a Boxel realm',
    )
    .argument('<local-dir>', 'The local directory to track')
    .argument(
      '<realm-url>',
      'The URL of the realm this directory mirrors (used for --push and history attribution)',
    )
    .option(
      '-d, --debounce <seconds>',
      'Seconds to wait after a burst of edits before applying them',
      parseNonNegativeSeconds('--debounce'),
      3,
    )
    .option(
      '-i, --interval <seconds>',
      'Minimum seconds between checkpoints',
      parsePositiveSeconds('--interval'),
      10,
    )
    .option('-q, --quiet', 'Only print on checkpoint creation')
    .option(
      '-p, --push',
      'Push add/update changes to the realm after each checkpoint',
    )
    .option('-v, --verbose', 'Print detailed debug output')
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)',
    )
    .action(
      async (
        localDir: string,
        realmUrl: string,
        options: {
          debounce: number;
          interval: number;
          quiet?: boolean;
          push?: boolean;
          verbose?: boolean;
          realmSecretSeed?: boolean;
        },
      ) => {
        const realmSecretSeed = await resolveRealmSecretSeed(
          options.realmSecretSeed === true,
        );
        const result = await trackRealms([{ realmUrl, localDir }], {
          intervalMs: options.interval * 1000,
          debounceMs: options.debounce * 1000,
          quiet: options.quiet,
          verbose: options.verbose,
          push: options.push,
          realmSecretSeed,
        });
        if (result.error) {
          console.error(`${FG_RED}Error:${RESET} ${result.error}`);
          process.exit(1);
        }
      },
    );
}
