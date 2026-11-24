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
    let current = readHolder(lockPath);
    // A lock that reads as nothing is one its process is still writing, or
    // one left half-written: it is abandoned once it is older than `staleMs`.
    let abandoned = current
      ? !isProcessAlive(current.pid) || Date.now() - current.takenAt > staleMs
      : olderThan(lockPath, staleMs);
    if (abandoned) {
      fs.rmSync(lockPath, { force: true });
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
    if (readHolder(lockPath)?.id === holder.id) {
      fs.rmSync(lockPath, { force: true });
    }
  }
}
