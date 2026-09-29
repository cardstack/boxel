import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const realm = join(packageRoot, 'dist-realm');
const generatedTest = join(realm, 'generated-gallery.test.gts');
const boxelCli = resolve(repoRoot, '../boxel/packages/boxel-cli/bin/boxel.js');

if (!existsSync(join(realm, 'gallery-runtime.ts'))) {
  throw new Error('Missing generated realm. Run pnpm build:realm first.');
}

copyFileSync(join(packageRoot, 'tests/boxel-runtime.test.gts'), generatedTest);
try {
  const useCheckout = existsSync(boxelCli);
  const command = useCheckout ? process.execPath : 'boxel';
  const args = useCheckout
    ? [boxelCli, 'test', realm, '--debug']
    : ['test', realm, '--debug'];
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message ?? `boxel test exited ${result.status}`,
    );
  }
} finally {
  rmSync(generatedTest, { force: true });
}
