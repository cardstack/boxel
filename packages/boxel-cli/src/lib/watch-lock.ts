import * as fs from 'fs/promises';
import * as path from 'path';

const LOCK_FILE = '.boxel-watch.lock';

export interface WatchLockInfo {
  pid: number;
  startedAt: string;
  realmUrl: string;
}

export type WatchLockResult =
  | { ok: true; staleOverwrote: boolean }
  | { ok: false; existing: WatchLockInfo };

function lockPath(localDir: string): string {
  return path.join(localDir, LOCK_FILE);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM means the process exists but we can't signal it — still alive.
    return err?.code === 'EPERM';
  }
}

async function readLock(localDir: string): Promise<WatchLockInfo | null> {
  try {
    const raw = await fs.readFile(lockPath(localDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<WatchLockInfo>;
    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.startedAt !== 'string' ||
      typeof parsed.realmUrl !== 'string'
    ) {
      return null;
    }
    return parsed as WatchLockInfo;
  } catch {
    return null;
  }
}

export async function acquireWatchLock(
  localDir: string,
  realmUrl: string,
): Promise<WatchLockResult> {
  await fs.mkdir(localDir, { recursive: true });
  const existing = await readLock(localDir);
  let staleOverwrote = false;
  if (existing && isProcessAlive(existing.pid)) {
    return { ok: false, existing };
  }
  if (existing) {
    staleOverwrote = true;
  }
  const info: WatchLockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    realmUrl,
  };
  await fs.writeFile(lockPath(localDir), JSON.stringify(info, null, 2) + '\n');
  return { ok: true, staleOverwrote };
}

export async function releaseWatchLock(localDir: string): Promise<void> {
  try {
    await fs.unlink(lockPath(localDir));
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

export async function readWatchLock(
  localDir: string,
): Promise<WatchLockInfo | null> {
  return readLock(localDir);
}
