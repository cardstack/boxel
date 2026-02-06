import * as fs from 'fs';
import * as path from 'path';

export interface EditLock {
  files: string[];
  since: number;
  agent?: string;
}

const LOCK_FILE = '.boxel-editing.json';

export function getEditLockPath(localDir: string): string {
  return path.join(localDir, LOCK_FILE);
}

export function loadEditLock(localDir: string): EditLock | null {
  const lockPath = getEditLockPath(localDir);
  if (!fs.existsSync(lockPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveEditLock(localDir: string, lock: EditLock): void {
  const lockPath = getEditLockPath(localDir);
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
}

export function clearEditLock(localDir: string): void {
  const lockPath = getEditLockPath(localDir);
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
  }
}

export function addToEditLock(localDir: string, files: string[], agent?: string): EditLock {
  const existing = loadEditLock(localDir);
  const lock: EditLock = existing || { files: [], since: Date.now(), agent };

  for (const file of files) {
    if (!lock.files.includes(file)) {
      lock.files.push(file);
    }
  }

  if (!existing) {
    lock.since = Date.now();
    lock.agent = agent;
  }

  saveEditLock(localDir, lock);
  return lock;
}

export function removeFromEditLock(localDir: string, files?: string[]): EditLock | null {
  const lock = loadEditLock(localDir);
  if (!lock) return null;

  if (!files) {
    // Clear all
    clearEditLock(localDir);
    return null;
  }

  lock.files = lock.files.filter(f => !files.includes(f));

  if (lock.files.length === 0) {
    clearEditLock(localDir);
    return null;
  }

  saveEditLock(localDir, lock);
  return lock;
}

export function isFileBeingEdited(localDir: string, file: string): boolean {
  const lock = loadEditLock(localDir);
  if (!lock) return false;
  return lock.files.includes(file);
}

export function getEditingFiles(localDir: string): string[] {
  const lock = loadEditLock(localDir);
  return lock?.files || [];
}
