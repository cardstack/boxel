import { InvalidArgumentError, type Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  RealmSyncBase,
  isProtectedFile,
} from '../../../lib/realm-sync-base.ts';
import {
  CheckpointManager,
  type Checkpoint,
  type CheckpointChange,
} from '../../../lib/checkpoint-manager.ts';
import {
  type SyncManifest,
  computeFileHash,
  loadManifest,
  saveManifest,
} from '../../../lib/sync-manifest.ts';
import type { ProfileManager } from '../../../lib/profile-manager.ts';
import type { RealmAuthenticator } from '../../../lib/realm-authenticator.ts';
import { resolveRealmAuthenticator } from '../../../lib/auth-resolver.ts';
import { resolveRealmSecretSeed } from '../../../lib/prompt.ts';
import {
  acquireWatchLock,
  releaseWatchLock,
  type WatchLockInfo,
} from '../../../lib/watch-lock.ts';
import {
  registerProcess,
  unregisterCurrentProcess,
} from '../../../lib/watch-process-registry.ts';
import {
  FG_CYAN,
  FG_GREEN,
  FG_RED,
  FG_YELLOW,
  DIM,
  RESET,
} from '../../../lib/colors.ts';

export interface WatchRealmSpec {
  realmUrl: string;
  localDir: string;
}

interface PendingChange {
  status: 'added' | 'modified' | 'deleted';
  mtime: number;
}

export interface FlushResult {
  pulled: string[];
  deleted: string[];
  /**
   * Files whose remote-side change was detected but not applied because the
   * local copy diverges from the sync manifest. Cleared by passing
   * `overwriteLocal: true`, or by reconciling via `boxel realm sync`.
   */
  skipped: string[];
  checkpoint: Checkpoint | null;
}

/**
 * Watches a single realm by polling `_mtimes`, accumulating changes between
 * ticks, and applying them in a debounced batch (download + delete + write
 * a checkpoint). One instance per realm; `watchRealms()` orchestrates many.
 */
export class RealmWatcher extends RealmSyncBase {
  readonly name: string;
  private readonly debounceMs: number;
  private readonly overwriteLocal: boolean;
  private readonly checkpointManager: CheckpointManager;
  private lastKnownMtimes = new Map<string, number>();
  private pendingChanges = new Map<string, PendingChange>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private isShutdown = false;

  constructor(
    spec: WatchRealmSpec,
    authenticator: RealmAuthenticator,
    options: { debounceMs: number; overwriteLocal?: boolean },
  ) {
    super({ realmUrl: spec.realmUrl, localDir: spec.localDir }, authenticator);
    this.debounceMs = options.debounceMs;
    this.overwriteLocal = options.overwriteLocal ?? false;
    this.checkpointManager = new CheckpointManager(spec.localDir);
    this.name = deriveRealmName(this.normalizedRealmUrl);
  }

  /** RealmSyncBase requires `sync()`. For the watcher, run one poll+apply. */
  async sync(): Promise<void> {
    await this.poll();
    await this.flushPending();
  }

  // Override: base swallows errors → empty map, which the watcher would
  // read as "every file deleted" and wipe the local dir on a network blip.
  protected override async getRemoteMtimes(): Promise<Map<string, number>> {
    const url = `${this.normalizedRealmUrl}_mtimes`;
    const response = await this.authenticator.authedRealmFetch(url, {
      headers: { Accept: 'application/vnd.api+json' },
    });
    if (!response.ok) {
      throw new Error(
        `_mtimes fetch failed for ${this.normalizedRealmUrl}: ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as {
      data?: { attributes?: { mtimes?: Record<string, number> } };
    };
    const mtimes = new Map<string, number>();
    for (const [fileUrl, mtime] of Object.entries(
      data.data?.attributes?.mtimes ?? {},
    )) {
      mtimes.set(fileUrl.replace(this.normalizedRealmUrl, ''), mtime);
    }
    return mtimes;
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
   * Verify realm access (via the throw-on-error override), ensure the
   * checkpoint history is initialized, and seed `lastKnownMtimes` from the
   * on-disk manifest if one exists.
   */
  async initialize(): Promise<void> {
    await this.getRemoteMtimes();

    if (!(await this.checkpointManager.isInitialized())) {
      await this.checkpointManager.init();
    }

    const manifest = await loadManifest(this.options.localDir);
    if (
      manifest &&
      manifest.realmUrl === this.normalizedRealmUrl &&
      manifest.remoteMtimes
    ) {
      for (const [file, mtime] of Object.entries(manifest.remoteMtimes)) {
        this.lastKnownMtimes.set(file, mtime);
      }
    }
  }

  /**
   * Poll the realm once and accumulate changes into `pendingChanges`. Returns
   * true if the poll discovered changes that weren't already pending.
   */
  async poll(): Promise<boolean> {
    const remoteMtimes = await this.getRemoteMtimes();
    let hasNewChanges = false;

    for (const [file, mtime] of remoteMtimes) {
      if (isProtectedFile(file)) continue;
      const last = this.lastKnownMtimes.get(file);
      if (last === undefined) {
        if (this.recordPending(file, { status: 'added', mtime })) {
          hasNewChanges = true;
        }
      } else if (mtime > last) {
        if (this.recordPending(file, { status: 'modified', mtime })) {
          hasNewChanges = true;
        }
      }
    }

    for (const file of this.lastKnownMtimes.keys()) {
      if (isProtectedFile(file)) continue;
      if (!remoteMtimes.has(file)) {
        const pending = this.pendingChanges.get(file);
        if (pending?.status !== 'deleted') {
          this.pendingChanges.set(file, { status: 'deleted', mtime: 0 });
          hasNewChanges = true;
        }
      }
    }

    return hasNewChanges;
  }

  /** Apply all currently pending changes immediately, bypassing the debounce. */
  async flushPending(): Promise<FlushResult> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.pendingChanges.size === 0) {
      return { pulled: [], deleted: [], skipped: [], checkpoint: null };
    }

    // Snapshot then clear before any await — anything an interleaved poll()
    // records during this flush rolls into the next one instead of being
    // dropped by a trailing clear().
    const drained = new Map(this.pendingChanges);
    this.pendingChanges.clear();

    const pulled: string[] = [];
    const deleted: string[] = [];
    const skipped: string[] = [];
    const changes: CheckpointChange[] = [];

    // Load the manifest once per flush so we hash-compare against a single
    // baseline. Skipped when `overwriteLocal` is on — we never look. A
    // manifest from a different realm is treated as "no manifest" (same
    // policy as `initialize()` and `sync()`), so every local file looks
    // unrecorded and is protected by the divergence gate.
    let manifest: SyncManifest | null = null;
    if (!this.overwriteLocal) {
      const loaded = await loadManifest(this.options.localDir);
      if (loaded && loaded.realmUrl === this.normalizedRealmUrl) {
        manifest = loaded;
      }
    }

    for (const [file, info] of drained) {
      const localPath = path.join(this.options.localDir, file);

      if (
        !this.overwriteLocal &&
        (await this.localDivergesFromManifest(
          localPath,
          file,
          manifest,
          info.status,
        ))
      ) {
        skipped.push(file);
        continue;
      }

      if (info.status === 'deleted') {
        try {
          await fs.unlink(localPath);
        } catch (err: any) {
          if (err.code !== 'ENOENT') throw err;
        }
        deleted.push(file);
        changes.push({ file, status: 'deleted' });
      } else {
        await this.downloadFile(file, localPath);
        pulled.push(file);
        changes.push({ file, status: info.status });
      }
    }

    // Only advance mtimes for files we actually applied. Skipped entries
    // keep their old `lastKnownMtimes` value (or absence) so the next poll
    // re-detects them — the warning persists until reconciled.
    const skippedSet = new Set(skipped);
    for (const [file, info] of drained) {
      if (skippedSet.has(file)) continue;
      if (info.status === 'deleted') {
        this.lastKnownMtimes.delete(file);
      } else {
        this.lastKnownMtimes.set(file, info.mtime);
      }
    }

    let checkpoint: Checkpoint | null = null;
    if (changes.length > 0) {
      await this.persistManifest(pulled, deleted);
      checkpoint = await this.checkpointManager.createCheckpoint(
        'remote',
        changes,
      );
    }

    return { pulled, deleted, skipped, checkpoint };
  }

  /**
   * True when the local copy of `relPath` no longer matches the sync
   * manifest: hash mismatch, missing manifest record for a present file,
   * or — for non-delete operations — the user deleted the file locally
   * while the manifest still recorded it (the delete-vs-change conflict
   * that `sync-logic.ts` classifies via `'deleted' + 'changed' = conflict`).
   */
  private async localDivergesFromManifest(
    localPath: string,
    relPath: string,
    manifest: SyncManifest | null,
    operation: 'added' | 'modified' | 'deleted',
  ): Promise<boolean> {
    let localHash: string;
    try {
      localHash = await computeFileHash(localPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
      // Remote also deleting → no local work to lose. Manifest had no
      // record → first-time pull, nothing to protect. Manifest had a
      // record and remote wants to write → that's the conflict.
      if (operation === 'deleted') return false;
      return manifest?.files[relPath] !== undefined;
    }
    const manifestHash = manifest?.files[relPath];
    if (manifestHash === undefined) return true;
    return localHash !== manifestHash;
  }

  /**
   * Schedule a debounced flush. Subsequent calls reset the timer so a burst
   * of changes lands in a single checkpoint.
   */
  scheduleFlush(onFlush?: (result: FlushResult) => void): void {
    // Closes the race where a poll() in flight at cleanup() resolves AFTER
    // shutdown() and would otherwise arm a new debounceTimer that nothing
    // clears — i.e. work scheduled past the watcher's lifetime.
    if (this.isShutdown) return;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null;
      try {
        const result = await this.flushPending();
        onFlush?.(result);
      } catch (err) {
        console.error(
          `${FG_RED}[${this.name}] Error applying changes:${RESET}`,
          err,
        );
      }
    }, this.debounceMs);
  }

  shutdown(): void {
    // Set the flag before clearing the timer so a concurrent scheduleFlush()
    // racing the in-flight poll path observes the shutdown state.
    this.isShutdown = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private recordPending(file: string, change: PendingChange): boolean {
    const existing = this.pendingChanges.get(file);
    if (existing && existing.mtime === change.mtime) {
      return false;
    }
    this.pendingChanges.set(file, change);
    return true;
  }

  // Mutate just the entries that changed in this flush instead of
  // rehashing everything in lastKnownMtimes — keeps each apply O(changed).
  private async persistManifest(
    pulled: string[],
    deleted: string[],
  ): Promise<void> {
    // Drop file hashes from a manifest belonging to a different realm —
    // otherwise we'd persist cross-realm entries under our `realmUrl`.
    // Matches the policy used by `flushPending()` and `initialize()`.
    const prior = await loadManifest(this.options.localDir);
    const priorFiles =
      prior && prior.realmUrl === this.normalizedRealmUrl ? prior.files : null;
    const files: Record<string, string> = priorFiles ? { ...priorFiles } : {};

    for (const file of deleted) {
      delete files[file];
    }
    for (const file of pulled) {
      const localPath = path.join(this.options.localDir, file);
      try {
        files[file] = await computeFileHash(localPath);
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
    }

    const remoteMtimes: Record<string, number> = {};
    for (const [file, mtime] of this.lastKnownMtimes) {
      if (mtime !== 0) {
        remoteMtimes[file] = mtime;
      }
    }

    const manifest: SyncManifest = {
      realmUrl: this.normalizedRealmUrl,
      files,
    };
    if (Object.keys(remoteMtimes).length > 0) {
      manifest.remoteMtimes = remoteMtimes;
    }
    await saveManifest(this.options.localDir, manifest);
  }
}

export interface WatchRealmsOptions {
  intervalMs?: number;
  debounceMs?: number;
  quiet?: boolean;
  profileManager?: ProfileManager;
  /** Pre-resolved realm secret seed (resolve via `resolveRealmSecretSeed` first). */
  realmSecretSeed?: string;
  /** @internal Test hook: supply an already-constructed authenticator. */
  authenticator?: RealmAuthenticator;
  /** Stops the watch loop when aborted. SIGINT/SIGTERM are wired up when omitted. */
  signal?: AbortSignal;
  /**
   * When true, downloads always overwrite the local file. When false
   * (default), files whose local copy diverges from the sync manifest are
   * skipped with a warning instead of overwritten.
   */
  overwriteLocal?: boolean;
}

export interface WatchRealmsResult {
  watchers: RealmWatcher[];
  error?: string;
}

/**
 * Programmatic entry point. Returns when the abort signal fires (or the
 * process receives SIGINT/SIGTERM when no signal is supplied). The CLI
 * passes a single spec; the array shape exists for programmatic / test
 * use. The authenticator is resolved once (from `specs[0].realmUrl`) and
 * shared across all specs — multi-realm callers must use realms that
 * share a profile / secret seed.
 */
export async function watchRealms(
  specs: WatchRealmSpec[],
  options: WatchRealmsOptions = {},
): Promise<WatchRealmsResult> {
  if (specs.length === 0) {
    return { watchers: [], error: 'No realms provided to watch.' };
  }

  const intervalMs = options.intervalMs ?? 30_000;
  const debounceMs = options.debounceMs ?? 5_000;
  const quiet = options.quiet ?? false;
  const overwriteLocal = options.overwriteLocal ?? false;

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return { watchers: [], error: '`intervalMs` must be a positive number.' };
  }
  if (!Number.isFinite(debounceMs) || debounceMs < 0) {
    return {
      watchers: [],
      error: '`debounceMs` must be a non-negative number.',
    };
  }

  let authenticator: RealmAuthenticator;
  if (options.authenticator) {
    authenticator = options.authenticator;
  } else {
    const resolution = resolveRealmAuthenticator({
      realmUrl: specs[0].realmUrl,
      realmSecretSeed: options.realmSecretSeed,
      profileManager: options.profileManager,
    });
    if (!resolution.ok) {
      return { watchers: [], error: resolution.error };
    }
    authenticator = resolution.authenticator;
  }

  // Acquire one lock per spec.localDir before initializing any watcher, so a
  // failure rolls back all earlier locks rather than leaving them dangling.
  const lockedDirs: string[] = [];
  for (const spec of specs) {
    const result = await acquireWatchLock(spec.localDir, spec.realmUrl);
    if (!result.ok) {
      for (const dir of lockedDirs) await releaseWatchLock(dir);
      return {
        watchers: [],
        error: formatLockedError(spec.localDir, result.existing),
      };
    }
    if (result.staleOverwrote && !quiet) {
      console.log(
        `${DIM}[${timestamp()}] overwrote stale lock at ${spec.localDir}${RESET}`,
      );
    }
    lockedDirs.push(spec.localDir);
  }

  const watchers: RealmWatcher[] = [];
  for (const spec of specs) {
    const watcher = new RealmWatcher(spec, authenticator, {
      debounceMs,
      overwriteLocal,
    });
    try {
      await watcher.initialize();
    } catch (err) {
      for (const w of watchers) w.shutdown();
      for (const dir of lockedDirs) await releaseWatchLock(dir);
      return {
        watchers: [],
        error: `Failed to initialize watch on ${spec.realmUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    watchers.push(watcher);
  }

  if (!quiet) {
    console.log(
      `${FG_CYAN}\u21c5 Watching ${watchers.length} realm${watchers.length > 1 ? 's' : ''}:${RESET}`,
    );
    for (const w of watchers) {
      console.log(`  ${w.name} ${DIM}\u2192${RESET} ${w.localDir}`);
    }
    console.log(
      `  ${DIM}Interval: ${intervalMs / 1000}s, Debounce: ${debounceMs / 1000}s${RESET}`,
    );
    console.log(`  ${DIM}Press Ctrl+C to stop${RESET}\n`);
  }

  const tickAll = async () => {
    await Promise.all(
      watchers.map(async (w) => {
        try {
          const hasNew = await w.poll();
          if (hasNew) {
            if (!quiet) {
              console.log(
                `${DIM}[${timestamp()}]${RESET} [${w.name}] ${FG_YELLOW}\u26a1 ${w.pendingCount} change(s) detected${RESET}`,
              );
            }
            w.scheduleFlush((result) => {
              if (!quiet) logFlush(w.name, result);
            });
          }
        } catch (err) {
          console.error(
            `${FG_RED}[${w.name}] poll error:${RESET}`,
            err instanceof Error ? err.message : err,
          );
        }
      }),
    );
  };

  // Self-scheduling tick: the next setTimeout is only armed after the
  // current tickAll resolves, so two polls can never overlap.
  let stopped = false;
  let timeoutId: NodeJS.Timeout | null = null;
  const scheduleNextTick = () => {
    if (stopped) return;
    timeoutId = setTimeout(async () => {
      timeoutId = null;
      if (stopped) return;
      await tickAll();
      scheduleNextTick();
    }, intervalMs);
  };

  try {
    await registerProcess(specs.map((s) => s.localDir).join(', '));
  } catch {
    // Best effort — registry failures must never block the watch.
  }

  await tickAll();
  scheduleNextTick();

  await new Promise<void>((resolve) => {
    let sigintHandler: (() => void) | null = null;
    let sigtermHandler: (() => void) | null = null;

    const cleanup = async () => {
      if (stopped) return;
      stopped = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      for (const w of watchers) w.shutdown();
      if (sigintHandler) process.off('SIGINT', sigintHandler);
      if (sigtermHandler) process.off('SIGTERM', sigtermHandler);
      for (const dir of lockedDirs) {
        try {
          await releaseWatchLock(dir);
        } catch {
          // Best effort \u2014 a leftover lock will be detected as stale next run.
        }
      }
      try {
        await unregisterCurrentProcess();
      } catch {
        // Best effort \u2014 leftover entries are pruned on next read.
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
        if (!quiet) console.log(`\n${FG_CYAN}\u21c5 Watch stopped${RESET}`);
        void cleanup();
      };
      sigtermHandler = sigintHandler;
      process.on('SIGINT', sigintHandler);
      process.on('SIGTERM', sigtermHandler);
    }
  });

  return { watchers };
}

function formatLockedError(localDir: string, info: WatchLockInfo): string {
  return (
    `A boxel realm watch process is already active for ${localDir} ` +
    `(pid ${info.pid}, started ${info.startedAt}). Stop it before starting ` +
    `a new one, or remove ${path.join(localDir, '.boxel-watch.lock')} if it's stale.`
  );
}

function logFlush(name: string, result: FlushResult): void {
  const total = result.pulled.length + result.deleted.length;
  if (total > 0) {
    console.log(
      `${DIM}[${timestamp()}]${RESET} [${name}] ${FG_GREEN}applied ${total} change(s)${RESET} (${result.pulled.length} pulled, ${result.deleted.length} deleted)`,
    );
    if (result.checkpoint) {
      const tag = result.checkpoint.isMajor ? '[MAJOR]' : '[minor]';
      console.log(
        `  ${DIM}Checkpoint:${RESET} ${result.checkpoint.shortHash} ${tag} ${result.checkpoint.message}`,
      );
    }
  }
  for (const file of result.skipped) {
    console.log(
      `${DIM}[${timestamp()}]${RESET} [${name}] ${FG_YELLOW}⚠ skipped ${file}: local diverges from sync manifest (rerun with --overwrite-local to discard, or \`boxel realm sync\` to reconcile)${RESET}`,
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

export function registerStartCommand(watch: Command): void {
  watch
    .command('start')
    .description(
      'Start watching a Boxel realm for server-side changes and pull them into a local directory',
    )
    .argument(
      '<realm-url>',
      'The URL of the realm to watch (e.g., https://app.boxel.ai/demo/)',
    )
    .argument('<local-dir>', 'The local directory to write changes into')
    .option(
      '-i, --interval <seconds>',
      'Polling interval in seconds',
      parsePositiveSeconds('--interval'),
      30,
    )
    .option(
      '-d, --debounce <seconds>',
      'Seconds to wait after a burst of changes before applying them',
      parseNonNegativeSeconds('--debounce'),
      5,
    )
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)',
    )
    .option(
      '--overwrite-local',
      'Overwrite local files when the remote changes. Default: skip + warn when the local copy diverges from the sync manifest.',
    )
    .action(
      async (
        realmUrl: string,
        localDir: string,
        options: {
          interval: number;
          debounce: number;
          realmSecretSeed?: boolean;
          overwriteLocal?: boolean;
        },
      ) => {
        const realmSecretSeed = await resolveRealmSecretSeed(
          options.realmSecretSeed === true,
        );
        const result = await watchRealms([{ realmUrl, localDir }], {
          intervalMs: options.interval * 1000,
          debounceMs: options.debounce * 1000,
          realmSecretSeed,
          overwriteLocal: options.overwriteLocal === true,
        });
        if (result.error) {
          console.error(`${FG_RED}Error:${RESET} ${result.error}`);
          process.exit(1);
        }
      },
    );
}
