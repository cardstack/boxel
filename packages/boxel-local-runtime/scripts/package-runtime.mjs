import { fileURLToPath } from 'node:url';
import { stageRuntimeTree } from './package-tree.mjs';

const destination = process.env.BOXEL_RUNTIME_OUTPUT;
if (!destination)
  throw new Error('Set BOXEL_RUNTIME_OUTPUT to a new build-output directory');
const result = await stageRuntimeTree({
  sourceRoot: fileURLToPath(new URL('../../../', import.meta.url)),
  destination,
});
process.stdout.write(JSON.stringify(result) + '\n');
