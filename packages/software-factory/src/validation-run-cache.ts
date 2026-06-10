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

import { logger } from './logger';

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
 */
export async function computeWorkspaceFingerprint(
  workspaceDir: string,
): Promise<string> {
  let entries: string[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (let name of names) {
      if (prefix === '' && FINGERPRINT_IGNORED.has(name)) continue;
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
        entries.push(`${rel}|${info.size}|${info.mtimeMs}`);
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
 */
export class ValidationRunCache {
  private entries = new Map<string, { fingerprint: string; value: unknown }>();
  private workspaceDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  /**
   * Return the cached value for `key` when the workspace is unchanged since
   * it was recorded; otherwise execute `run`, record its result, and return
   * it.
   */
  async getOrRun<T>(key: string, run: () => Promise<T>): Promise<T> {
    let fingerprint = await computeWorkspaceFingerprint(this.workspaceDir);
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
  private workspaceDir: string;
  private syncFn: () => Promise<SyncOutcome>;

  constructor(workspaceDir: string, syncFn: () => Promise<SyncOutcome>) {
    this.workspaceDir = workspaceDir;
    this.syncFn = syncFn;
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
    } else {
      this.lastSyncedFingerprint = undefined;
    }
    return outcome;
  }
}
