import { spawnSync } from 'node:child_process';
import { strictEqual } from 'node:assert';
import { join } from 'node:path';

const packageRoot = join(import.meta.dirname, '..', '..');

const result = spawnSync(
  process.execPath,
  [join(packageRoot, 'examples', 'authorization', 'run.ts')],
  { cwd: packageRoot, encoding: 'utf8' },
);

strictEqual(result.status, 0, result.stderr);
strictEqual(
  result.stdout.includes('coordination: 32 decisions'),
  true,
  result.stdout,
);
strictEqual(
  result.stdout.includes('software-release: 40 decisions'),
  true,
  result.stdout,
);

console.log(
  'Authorization examples: generalized coordination and software-release runners passed',
);
