/**
 * Workspace-fingerprint–keyed reuse for the expensive validation engines and
 * the workspace→realm sync.
 *
 * The factory validates the same realm state repeatedly: the agent
 * self-validates mid-turn with the `run_*` tools, then the orchestrator's
 * validation pipeline re-runs the same engines after `signal_done` — and
 * every realm-touching tool syncs the workspace first, even when nothing
 * changed. Both costs key off the same question: "has the workspace changed
 * since this last ran?" A fingerprint over the workspace files answers it.
 *
 * Soundness: the engines execute against the realm, and the realm's source
 * is only ever written from this process by syncing the workspace — so as
 * long as every engine run happens against a realm that mirrors the
 * fingerprinted workspace (the tools sync before running; the issue loop
 * syncs before validating), an unchanged fingerprint means an identical
 * input state and the previous engine output can be reused. Artifact cards
 * are written by the pipeline steps outside the cached engines, so the
 * audit trail in `Validations/` is unaffected.
 */

import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { logger } from './logger.ts';

let log = logger('validation-run-cache');

/**
 * Workspace-local bookkeeping that must not invalidate the fingerprint:
 * checkpoint history and the sync manifest change as a *consequence* of
 * syncing, not as content edits.
 */
const FINGERPRINT_IGNORED = new Set(['.boxel-history', '.boxel-sync.json']);

/**
 * Cheap content fingerprint of a workspace directory: a hash over every
 * file's relative path, size, and mtime. Editing, adding, or deleting any
 * file changes it; re-syncing or checkpointing does not.
 *
 * `extraIgnoredTopLevel` names additional top-level directories to leave
 * out of the fingerprint (e.g. `Validations` for the validation cache —
 * see {@link ValidationRunCache}).
 */
export async function computeWorkspaceFingerprint(
  workspaceDir: string,
  extraIgnoredTopLevel: readonly string[] = [],
): Promise<string> {
  let ignored = new Set([...FINGERPRINT_IGNORED, ...extraIgnoredTopLevel]);
  let entries: string[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (let name of names) {
      if (prefix === '' && ignored.has(name)) continue;
      let full = join(dir, name);
      let rel = prefix === '' ? name : `${prefix}/${name}`;
      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        await walk(full, rel);
      } else {
        // ctimeMs joins size + mtimeMs to reduce the odds of a same-size
        // edit landing within one coarse mtime tick fingerprinting as
        // unchanged.
        entries.push(`${rel}|${info.size}|${info.mtimeMs}|${info.ctimeMs}`);
      }
    }
  }

  await walk(workspaceDir, '');
  entries.sort();
  return createHash('sha1').update(entries.join('\n')).digest('hex');
}

/** Stable key suffix for an engine input set (e.g. the discovered file list). */
export function cacheKeyForInputs(inputs: readonly string[]): string {
  return createHash('sha1')
    .update([...inputs].sort().join('\n'))
    .digest('hex');
}

/**
 * Memoizes validation-engine runs per workspace fingerprint. One entry per
 * key — a new run for the same key replaces the old entry, so the cache
 * never grows past the number of distinct engine/input combinations.
 *
 * The cache's fingerprint ignores `Validations/`: each pipeline step writes
 * a "running" artifact card there *before* executing its engine, and those
 * writes would otherwise invalidate the cache mid-pipeline — defeating the
 * whole point of reusing the agent's mid-turn runs. That is sound because
 * artifact cards are validation *outputs*; none of the five engines reads
 * them (eval/lint/test discover code files, parse validates only
 * Spec-linked JSON examples, instantiate reads only Spec cards).
 *
 * When constructed with a `syncGate`, the cache is bypassed entirely (no
 * read, no write) while the realm is not known to mirror the workspace —
 * i.e. after a failed sync, or before the first successful one. The
 * realm-backed engines run against the realm, so a result produced while
 * the realm lags the workspace must not be recorded under the workspace's
 * fingerprint: a later cache hit would serve a verdict for code that was
 * never actually validated.
 */
export class ValidationRunCache {
  private entries = new Map<string, { fingerprint: string; value: unknown }>();
  private workspaceDir: string;
  private syncGate: WorkspaceSyncGate | undefined;

  constructor(
    workspaceDir: string,
    options?: { syncGate?: WorkspaceSyncGate },
  ) {
    this.workspaceDir = workspaceDir;
    this.syncGate = options?.syncGate;
  }

  /**
   * Return the cached value for `key` when the workspace is unchanged since
   * it was recorded; otherwise execute `run`, record its result, and return
   * it. When the realm is not in sync with the workspace, the cache is
   * skipped in both directions.
   */
  async getOrRun<T>(key: string, run: () => Promise<T>): Promise<T> {
    if (this.syncGate && !(await this.syncGate.isEngineContentSynced())) {
      log.info(`Realm not in sync with workspace — bypassing cache for ${key}`);
      return run();
    }
    let fingerprint = await computeWorkspaceFingerprint(this.workspaceDir, [
      'Validations',
    ]);
    let hit = this.entries.get(key);
    if (hit && hit.fingerprint === fingerprint) {
      log.info(`Reusing ${key} result — workspace unchanged since last run`);
      return hit.value as T;
    }
    let value = await run();
    this.entries.set(key, { fingerprint, value });
    return value;
  }
}

export interface SyncOutcome {
  ok: boolean;
  error?: string;
}

/**
 * Skips workspace→realm syncs when the workspace hasn't changed since the
 * last successful sync. The realm-touching `run_*` tools and the issue loop
 * each sync defensively; most of those are no-ops that still cost an access
 * test, an `_mtimes` fetch, and a local diff.
 */
export class WorkspaceSyncGate {
  private lastSyncedFingerprint: string | undefined;
  private lastSyncedEngineFingerprint: string | undefined;
  private workspaceDir: string;
  private syncFn: () => Promise<SyncOutcome>;

  constructor(workspaceDir: string, syncFn: () => Promise<SyncOutcome>) {
    this.workspaceDir = workspaceDir;
    this.syncFn = syncFn;
  }

  /**
   * True when the workspace's engine-relevant content (everything except
   * `Validations/`) matches what was last successfully synced to the realm.
   * False after a failed sync or before the first successful one. This is
   * what makes a {@link ValidationRunCache} entry trustworthy: the engines
   * run against the realm, so their results are only meaningful for the
   * fingerprinted workspace while the two agree.
   */
  async isEngineContentSynced(): Promise<boolean> {
    if (this.lastSyncedEngineFingerprint === undefined) {
      return false;
    }
    let current = await computeWorkspaceFingerprint(this.workspaceDir, [
      'Validations',
    ]);
    return current === this.lastSyncedEngineFingerprint;
  }

  async sync(): Promise<SyncOutcome> {
    let fingerprint = await computeWorkspaceFingerprint(this.workspaceDir);
    if (fingerprint === this.lastSyncedFingerprint) {
      log.info('Workspace unchanged since last sync — skipping');
      return { ok: true };
    }
    let outcome = await this.syncFn();
    if (outcome.ok) {
      // A bidirectional sync can also pull remote changes into the
      // workspace, so fingerprint what actually ended up on disk.
      this.lastSyncedFingerprint = await computeWorkspaceFingerprint(
        this.workspaceDir,
      );
      this.lastSyncedEngineFingerprint = await computeWorkspaceFingerprint(
        this.workspaceDir,
        ['Validations'],
      );
    } else {
      this.lastSyncedFingerprint = undefined;
      this.lastSyncedEngineFingerprint = undefined;
    }
    return outcome;
  }
}
