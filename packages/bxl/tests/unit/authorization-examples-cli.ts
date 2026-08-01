import { spawnSync } from 'node:child_process';
import { strictEqual } from 'node:assert';
import { join } from 'node:path';

const result = spawnSync(
  process.execPath,
  [join('scripts', 'run-ts-entry.mjs'), join('examples', 'authorization', 'run.ts')],
  { cwd: process.cwd(), encoding: 'utf8' },
);

strictEqual(result.status, 0, result.stderr);
strictEqual(
  result.stdout.includes('coordination: 32 decisions'),
  true,
  result.stdout,
);
strictEqual(
  result.stdout.includes('education-report: 40 decisions'),
  true,
  result.stdout,
);

console.log('Authorization examples: generalized coordination and education runners passed');
