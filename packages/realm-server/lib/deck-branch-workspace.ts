import { hashBytes, RefBusyError } from '@cardstack/deck/node';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function deckBranchWorkspaceDir(
  realmDir: string,
  branch: string,
): string {
  return branch === 'main'
    ? realmDir
    : join(realmDir, '.deck', 'branches', encodeURIComponent(branch));
}

export function deckBranchWorkspaceName(branch: string): string {
  return `deck:${branch}`;
}

export async function withDeckBranchWriter<T>(
  realmDir: string,
  branch: string,
  callback: () => Promise<T>,
): Promise<T> {
  let lock = join(
    realmDir,
    '.deck',
    '_writer-locks',
    `${hashBytes(branch)}.lock`,
  );
  await mkdir(dirname(lock), { recursive: true });
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new RefBusyError(`branch writer is busy: ${branch}`);
    }
    throw error;
  }
  try {
    return await callback();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
