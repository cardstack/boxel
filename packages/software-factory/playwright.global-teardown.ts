import { existsSync, rmSync } from 'node:fs';
import { readSupportMetadata, sharedRuntimeDir } from './src/runtime-metadata';

function killBackgroundProcess(pid: number, signal: NodeJS.Signals) {
  try {
    if (process.platform === 'win32') {
      process.kill(pid, signal);
      return;
    }
    process.kill(-pid, signal);
  } catch (error) {
    let nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ESRCH') {
      return;
    }
    if (nodeError.code === 'EINVAL' || nodeError.code === 'ENOSYS') {
      process.kill(pid, signal);
      return;
    }
    throw error;
  }
}

export default async function globalTeardown() {
  try {
    let metadata = readSupportMetadata();
    if (metadata && existsSync(sharedRuntimeDir)) {
      let { pid } = metadata;

      if (typeof pid === 'number') {
        killBackgroundProcess(pid, 'SIGTERM');
      }
    }
  } finally {
    rmSync(sharedRuntimeDir, { recursive: true, force: true });
  }
}
