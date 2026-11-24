import * as fs from 'fs';
import { randomUUID } from 'crypto';

import { isProcessAlive } from './watch-lock.ts';

export interface FileLockOptions {
  // How long to wait for another process to let go before giving up.
  timeoutMs?: number;
  // A lock older than this is taken to be left behind by a process that
  // stopped without letting go, even if a process with its PID is running
  // (PIDs are reused).
  staleMs?: number;
  pollMs?: number;
}

export class FileLockTimeoutError extends Error {
  constructor(lockPath: string, timeoutMs: number) {
    super(
      `Another boxel command held ${lockPath} for over ${Math.round(timeoutMs / 1000)}s. ` +
        `If no other boxel command is running, delete that file and try again.`,
    );
    this.name = 'FileLockTimeoutError';
  }
}

interface LockHolder {
  pid: number;
  id: string;
  takenAt: number;
}

function readHolder(lockPath: string): LockHolder | null {
  try {
    let parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as LockHolder;
    return typeof parsed.pid === 'number' && typeof parsed.takenAt === 'number'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function olderThan(lockPath: string, ms: number): boolean {
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs > ms;
  } catch {
    // Gone already: the next attempt takes it.
    return false;
  }
}

function tryTake(lockPath: string, holder: LockHolder): boolean {
  try {
    // `wx` fails when the file exists, so only one process creates it.
    fs.writeFileSync(lockPath, JSON.stringify(holder), {
      flag: 'wx',
      mode: 0o600,
    });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw err;
  }
}

// Whether the lock `holder` (as read from the file) was left behind. A lock
// that reads as nothing is one its process is still writing, or one left
// half-written: it is abandoned once its file is older than `staleMs`.
function isAbandoned(
  path: string,
  holder: LockHolder | null,
  staleMs: number,
): boolean {
  return holder
    ? !isProcessAlive(holder.pid) || Date.now() - holder.takenAt > staleMs
    : olderThan(path, staleMs);
}

// A guard is held for a few file operations, so one this old was left by a
// process that stopped while holding it.
const GUARD_STALE_MS = 10_000;

// Runs `fn`, which must be synchronous, while this process alone holds the
// guard beside the lock file. Every removal of the lock file happens under
// the guard: taking over an abandoned lock, and a holder letting go of its
// own. A removal decided outside it could remove a lock another process took
// since. Creating the lock needs no guard, since only one process can create
// a file that doesn't exist.
async function underGuard(
  lockPath: string,
  pollMs: number,
  fn: () => void,
): Promise<void> {
  let guardPath = `${lockPath}.guard`;
  let guard: LockHolder = {
    pid: process.pid,
    id: randomUUID(),
    takenAt: Date.now(),
  };
  while (!tryTake(guardPath, guard)) {
    // Taking over a guard can itself race, but only after a process stopped
    // in the moment it held one.
    if (isAbandoned(guardPath, readHolder(guardPath), GUARD_STALE_MS)) {
      fs.rmSync(guardPath, { force: true });
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    guard.takenAt = Date.now();
  }
  try {
    fn();
  } finally {
    if (readHolder(guardPath)?.id === guard.id) {
      fs.rmSync(guardPath, { force: true });
    }
  }
}

// Runs `fn` while this process alone holds the lock file at `lockPath`, for
// work that two processes must never do at once. Other processes wait for it.
// A lock whose process is gone, or that is older than `staleMs`, is taken
// over.
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  { timeoutMs = 30_000, staleMs = 60_000, pollMs = 50 }: FileLockOptions = {},
): Promise<T> {
  let holder: LockHolder = {
    pid: process.pid,
    id: randomUUID(),
    takenAt: Date.now(),
  };
  let deadline = Date.now() + timeoutMs;
  while (!tryTake(lockPath, holder)) {
    if (isAbandoned(lockPath, readHolder(lockPath), staleMs)) {
      // Decided again under the guard, from the lock as it is then: a lock
      // another waiter took over meanwhile is live, and stays.
      await underGuard(lockPath, pollMs, () => {
        if (isAbandoned(lockPath, readHolder(lockPath), staleMs)) {
          fs.rmSync(lockPath, { force: true });
        }
      });
      continue;
    }
    if (Date.now() > deadline) {
      throw new FileLockTimeoutError(lockPath, timeoutMs);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    holder.takenAt = Date.now();
  }
  try {
    return await fn();
  } finally {
    // Removed only while it is still this process's: one taken over as
    // stale belongs to the process that took it.
    await underGuard(lockPath, pollMs, () => {
      if (readHolder(lockPath)?.id === holder.id) {
        fs.rmSync(lockPath, { force: true });
      }
    });
  }
}
