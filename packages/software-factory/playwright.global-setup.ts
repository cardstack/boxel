import { openSync, writeFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const packageRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const realmPort = Number(process.env.SOFTWARE_FACTORY_REALM_PORT ?? 4444);
const realmURL =
  process.env.SOFTWARE_FACTORY_REALM_URL ?? `http://127.0.0.1:${realmPort}/`;
const realmDir = resolve(
  packageRoot,
  process.env.SOFTWARE_FACTORY_REALM_DIR ?? 'demo-realm',
);
const stateFile = resolve(packageRoot, '.playwright-server.json');
const logFile = resolve(packageRoot, 'playwright-server.log');

async function waitForServer(url: string, timeoutMs = 120_000) {
  let startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      let response = await fetch(new URL('_info', url), { method: 'HEAD' });
      if (response.ok) {
        return;
      }
    } catch {
      // keep waiting for the child process to come up
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for software-factory realm at ${url}`);
}

export default async function globalSetup() {
  try {
    let response = await fetch(new URL('_info', realmURL), { method: 'HEAD' });
    if (response.ok) {
      writeFileSync(stateFile, JSON.stringify({ reusedExistingServer: true }));
      return;
    }
  } catch {
    // no reusable server is running
  }

  let cacheResult = spawnSync('pnpm', ['cache:prepare', realmDir], {
    cwd: packageRoot,
    stdio: 'inherit',
    env: process.env,
  });
  if (cacheResult.status !== 0) {
    throw new Error(
      `Failed to prepare software-factory cache (exit ${cacheResult.status})`,
    );
  }

  let logFd = openSync(logFile, 'a');
  let child = spawn('pnpm', ['serve:realm', realmDir], {
    cwd: packageRoot,
    env: process.env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();

  writeFileSync(
    stateFile,
    JSON.stringify({ pid: child.pid, reusedExistingServer: false }),
  );

  await waitForServer(realmURL);
}
