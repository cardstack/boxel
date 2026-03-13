import { existsSync, readFileSync, rmSync } from 'node:fs';
import {
  defaultSupportMetadataFile,
  sharedRuntimeDir,
} from './src/runtime-metadata.ts';

function killProcessGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    let nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== 'ESRCH') {
      throw error;
    }
  }
}

export default async function globalTeardown() {
  try {
    if (existsSync(defaultSupportMetadataFile)) {
      let { pid } = JSON.parse(
        readFileSync(defaultSupportMetadataFile, 'utf8'),
      ) as {
        pid?: number;
      };

      if (typeof pid === 'number') {
        killProcessGroup(pid, 'SIGTERM');
      }
    }
  } finally {
    rmSync(sharedRuntimeDir, { recursive: true, force: true });
  }
}
