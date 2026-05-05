import { InvalidArgumentError, type Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  RealmSyncBase,
  isProtectedFile,
  type SyncOptions,
} from '../../lib/realm-sync-base';
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
  acquireWatchLock,
  releaseWatchLock,
  type WatchLockInfo,
} from '../../lib/watch-lock';
import {
  FG_CYAN,
  FG_GREEN,
  FG_RED,
  FG_YELLOW,
  DIM,
  RESET,
} from '../../lib/colors';

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
  checkpoint: Checkpoint | null;
}

interface WatcherInternalOptions extends SyncOptions {
  debounceMs: number;
  quiet: boolean;
}

/**
 * Watches a single realm by polling `_mtimes`, accumulating changes between
 * ticks, and applying them in a debounced batch (download + delete + write
 * a checkpoint). One instance per realm; `watchRealms()` orchestrates many.
 */
export class RealmWatcher extends RealmSyncBase {
  readonly name: string;
  private readonly debounceMs: number;
  private readonly quiet: boolean;
  private readonly checkpointManager: CheckpointManager;
  private lastKnownMtimes = new Map<string, number>();
  private pendingChanges = new Map<string, PendingChange>();
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(
    spec: WatchRealmSpec,
    authenticator: RealmAuthenticator,
    options: { debounceMs: number; quiet: boolean },
  ) {
    const internal: WatcherInternalOptions = {
      realmUrl: spec.realmUrl,
      localDir: spec.localDir,
      debounceMs: options.debounceMs,
      quiet: options.quiet,
    };
    super(internal, authenticator);
    this.debounceMs = options.debounceMs;
    this.quiet = options.quiet;
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
   * Verify realm access, ensure the checkpoint history is initialized, and
   * seed `lastKnownMtimes` from the on-disk manifest if one exists.
   */
  async initialize(): Promise<void> {
    const url = `${this.normalizedRealmUrl}_mtimes`;
    const response = await this.authenticator.authedRealmFetch(url, {
      headers: { Accept: 'application/vnd.api+json' },
    });
    if (!response.ok) {
      throw new Error(
        `Cannot access realm ${this.normalizedRealmUrl}: ${response.status} ${response.statusText}`,
      );
    }

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
      return { pulled: [], deleted: [], checkpoint: null };
    }

    // Snapshot then clear before any await — anything an interleaved poll()
    // records during this flush rolls into the next one instead of being
    // dropped by a trailing clear().
    const drained = new Map(this.pendingChanges);
    this.pendingChanges.clear();

    const pulled: string[] = [];
    const deleted: string[] = [];
    const changes: CheckpointChange[] = [];

    for (const [file, info] of drained) {
      if (info.status === 'deleted') {
        const localPath = path.join(this.options.localDir, file);
        try {
          await fs.unlink(localPath);
        } catch (err: any) {
          if (err.code !== 'ENOENT') throw err;
        }
        deleted.push(file);
        changes.push({ file, status: 'deleted' });
      } else {
        const localPath = path.join(this.options.localDir, file);
        await this.downloadFile(file, localPath);
        pulled.push(file);
        changes.push({ file, status: info.status });
      }
    }

    for (const [file, info] of drained) {
      if (info.status === 'deleted') {
        this.lastKnownMtimes.delete(file);
      } else {
        this.lastKnownMtimes.set(file, info.mtime);
      }
    }

    await this.persistManifest();

    const checkpoint = await this.checkpointManager.createCheckpoint(
      'remote',
      changes,
    );

    return { pulled, deleted, checkpoint };
  }

  /**
   * Schedule a debounced flush. Subsequent calls reset the timer so a burst
   * of changes lands in a single checkpoint.
   */
  scheduleFlush(onFlush?: (result: FlushResult) => void): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null;
      try {
        const result = await this.flushPending();
        onFlush?.(result);
      } catch (err) {
        if (!this.quiet) {
          console.error(
            `${FG_RED}[${this.name}] Error applying changes:${RESET}`,
            err,
          );
        }
      }
    }, this.debounceMs);
  }

  shutdown(): void {
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

  private async persistManifest(): Promise<void> {
    const manifest: SyncManifest = {
      realmUrl: this.normalizedRealmUrl,
      files: {},
      remoteMtimes: {},
    };
    for (const [file, mtime] of this.lastKnownMtimes) {
      const localPath = path.join(this.options.localDir, file);
      try {
        const hash = await computeFileHash(localPath);
        manifest.files[file] = hash;
        if (mtime !== 0) {
          manifest.remoteMtimes![file] = mtime;
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    if (
      manifest.remoteMtimes &&
      Object.keys(manifest.remoteMtimes).length === 0
    ) {
      delete manifest.remoteMtimes;
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
}

export interface WatchRealmsResult {
  watchers: RealmWatcher[];
  error?: string;
}

/**
 * Programmatic entry point. Returns when the abort signal fires (or the
 * process receives SIGINT/SIGTERM when no signal is supplied). Used by both
 * the CLI registration below and integration tests.
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
      quiet,
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
          if (!quiet) {
            console.error(
              `${FG_RED}[${w.name}] poll error:${RESET}`,
              err instanceof Error ? err.message : err,
            );
          }
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
  if (total === 0) return;
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

export function registerWatchCommand(realm: Command): void {
  realm
    .command('watch')
    .description(
      'Watch a Boxel realm for server-side changes and pull them into a local directory',
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
    .option('-q, --quiet', 'Suppress periodic status output')
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)',
    )
    .action(
      async (
        realmUrl: string,
        localDir: string,
        options: {
          interval: number;
          debounce: number;
          quiet?: boolean;
          realmSecretSeed?: boolean;
        },
      ) => {
        const realmSecretSeed = await resolveRealmSecretSeed(
          options.realmSecretSeed === true,
        );
        const result = await watchRealms([{ realmUrl, localDir }], {
          intervalMs: options.interval * 1000,
          debounceMs: options.debounce * 1000,
          quiet: options.quiet,
          realmSecretSeed,
        });
        if (result.error) {
          console.error(`${FG_RED}Error:${RESET} ${result.error}`);
          process.exit(1);
        }
      },
    );
}
