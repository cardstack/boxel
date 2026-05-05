import * as fs from 'fs/promises';
import * as path from 'path';

const LOCK_FILES = {
  watch: '.boxel-watch.lock',
  track: '.boxel-track.lock',
} as const;

export type LockKind = keyof typeof LOCK_FILES;

export interface SyncLockInfo {
  pid: number;
  startedAt: string;
  realmUrl: string;
}

export type SyncLockResult =
  | { ok: true; staleOverwrote: boolean }
  | { ok: false; conflictKind: LockKind; existing: SyncLockInfo };

function lockPath(localDir: string, kind: LockKind): string {
  return path.join(localDir, LOCK_FILES[kind]);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM means the process exists but we can't signal it — still alive.
    return err?.code === 'EPERM';
  }
}

async function readLock(
  localDir: string,
  kind: LockKind,
): Promise<SyncLockInfo | null> {
  try {
    const raw = await fs.readFile(lockPath(localDir, kind), 'utf8');
    const parsed = JSON.parse(raw) as Partial<SyncLockInfo>;
    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.startedAt !== 'string' ||
      typeof parsed.realmUrl !== 'string'
    ) {
      return null;
    }
    return parsed as SyncLockInfo;
  } catch {
    return null;
  }
}

/**
 * Acquire a sync-lock of `kind` against `localDir`. Refuses if either
 *   - the same kind is already held by a live process, or
 *   - the *other* kind is held by a live process — running `boxel realm
 *     track` and `boxel realm watch` against the same dir would create a
 *     push/pull loop.
 * A stale same-kind lock (dead pid) is overwritten. A stale other-kind
 * lock is left in place — its owner will overwrite it on next run.
 */
export async function acquireSyncLock(
  localDir: string,
  kind: LockKind,
  realmUrl: string,
): Promise<SyncLockResult> {
  await fs.mkdir(localDir, { recursive: true });

  const otherKind: LockKind = kind === 'watch' ? 'track' : 'watch';
  const otherLock = await readLock(localDir, otherKind);
  if (otherLock && isProcessAlive(otherLock.pid)) {
    return { ok: false, conflictKind: otherKind, existing: otherLock };
  }

  const existing = await readLock(localDir, kind);
  let staleOverwrote = false;
  if (existing && isProcessAlive(existing.pid)) {
    return { ok: false, conflictKind: kind, existing };
  }
  if (existing) {
    staleOverwrote = true;
  }
  const info: SyncLockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    realmUrl,
  };
  await fs.writeFile(
    lockPath(localDir, kind),
    JSON.stringify(info, null, 2) + '\n',
  );
  return { ok: true, staleOverwrote };
}

export async function releaseSyncLock(
  localDir: string,
  kind: LockKind,
): Promise<void> {
  try {
    await fs.unlink(lockPath(localDir, kind));
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

export async function readSyncLock(
  localDir: string,
  kind: LockKind,
): Promise<SyncLockInfo | null> {
  return readLock(localDir, kind);
}
