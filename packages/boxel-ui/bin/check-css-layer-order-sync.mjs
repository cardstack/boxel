// The CSS cascade layer order is declared in src/styles/global.css and
// repeated in the <head> of every app entry, because the copy in global.css
// does not survive bundling (see the comment there). The copies decide the
// cascade, so they must all agree. tests/unit/css-layer-order-test.ts can only
// exercise the entry it runs under — this check covers every copy, including
// the production host entry no test loads.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

const sourceOfTruth = 'packages/boxel-ui/src/styles/global.css';
const copies = [
  'packages/boxel-ui/tests/index.html',
  'packages/boxel-ui/docs-app/index.html',
  'packages/boxel-ui/docs-app/tests/index.html',
  'packages/host/index.html',
  'packages/host/tests/index.html',
];

// Matches only the order statement (`@layer a, b;`), not layer blocks
// (`@layer a { … }`) or `@import … layer(…)`.
const ORDER_STATEMENT = /@layer\s+([^;{]+);/g;

function layerOrder(file) {
  const content = readFileSync(join(repoRoot, file), 'utf8');
  const statements = [...content.matchAll(ORDER_STATEMENT)];
  if (statements.length !== 1) {
    throw new Error(
      `${file}: expected exactly one @layer order statement, found ${statements.length}`,
    );
  }
  return statements[0][1]
    .split(',')
    .map((name) => name.trim())
    .join(', ');
}

try {
  const expected = layerOrder(sourceOfTruth);
  const mismatches = copies
    .map((file) => ({ file, order: layerOrder(file) }))
    .filter(({ order }) => order !== expected);
  if (mismatches.length > 0) {
    console.error(`@layer order statements have drifted out of sync.`);
    console.error(`${sourceOfTruth} declares:\n  ${expected}`);
    for (const { file, order } of mismatches) {
      console.error(`${file} declares:\n  ${order}`);
    }
    process.exit(1);
  }
  console.log(
    `@layer order in sync across ${copies.length + 1} files: ${expected}`,
  );
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(1);
}
