import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const packageRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const stateFile = resolve(packageRoot, '.playwright-server.json');

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export default async function globalTeardown() {
  if (!existsSync(stateFile)) {
    return;
  }

  let state = JSON.parse(readFileSync(stateFile, 'utf8')) as {
    pid?: number;
    reusedExistingServer?: boolean;
  };

  if (!state.reusedExistingServer && state.pid) {
    try {
      process.kill(-state.pid, 'SIGTERM');
    } catch {
      // best effort cleanup
    }

    let startedAt = Date.now();
    while (processExists(state.pid) && Date.now() - startedAt < 10_000) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (processExists(state.pid)) {
      try {
        process.kill(-state.pid, 'SIGKILL');
      } catch {
        // best effort cleanup
      }
    }
  }

  rmSync(stateFile, { force: true });
}
