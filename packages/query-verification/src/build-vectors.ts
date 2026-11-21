// Builds the conformance vectors from the Lean model into vectors/ and
// prints the file's path and sha256. With --check, fails unless the sha256
// is the pinned VECTORS_SHA256. Needs `lake` (elan) on the PATH.
import { execFileSync } from 'node:child_process';

import { cacheVectors, sha256, VECTORS_SHA256 } from './vectors-artifact.ts';

const lean = new URL('../lean/', import.meta.url);
const lake = (args: string[]) =>
  execFileSync('lake', args, {
    cwd: lean,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'inherit'],
  });

lake(['build', 'vectors']);
// `lake exe vectors` with no argument writes the filter vectors.
let parts = ['dates', 'filters', 'grammar', 'paths', 'values'].map(
  (name) =>
    `${JSON.stringify(name)}:${lake(['exe', 'vectors', ...(name === 'filters' ? [] : [name])]).trim()}`,
);
let bytes = Buffer.from(`{${parts.join(',')}}\n`);
let sha = sha256(bytes);
console.log(`${cacheVectors(bytes)}\nsha256 ${sha}`);
if (sha !== VECTORS_SHA256) {
  let message = `the model's vectors have sha256 ${sha}, not the pinned ${VECTORS_SHA256}: publish the file and update src/vectors-artifact.ts`;
  if (process.argv.includes('--check')) {
    console.error(message);
    process.exitCode = 1;
  } else {
    console.log(message);
  }
}
