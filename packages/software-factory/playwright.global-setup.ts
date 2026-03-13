import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const realmDir = resolve(
  packageRoot,
  process.env.SOFTWARE_FACTORY_REALM_DIR ?? 'demo-realm',
);

export default async function globalSetup() {
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
}
