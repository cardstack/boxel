// Rewrites relative `.gts` import specifiers in the emitted declaration
// files to `.js`, which consumers' module resolution maps to the sibling
// `.d.ts` files. ember-tsc emits declaration imports with their authored
// `.gts` extensions, which don't resolve from within declarations/ — and an
// unresolvable import inside a `.d.ts` is silently suppressed under
// skipLibCheck, degrading every symbol imported from this package to `any`.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const declarationsDir = fileURLToPath(
  new URL('../declarations', import.meta.url),
);

async function* dtsFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* dtsFiles(path);
    } else if (entry.name.endsWith('.d.ts')) {
      yield path;
    }
  }
}

const relativeGtsSpecifier = /(['"])(\.\.?\/[^'"]+)\.gts(\1)/g;
const anyGtsSpecifier = /['"][^'"]+\.gts['"]/;

let rewrittenFileCount = 0;
for await (const path of dtsFiles(declarationsDir)) {
  const source = await readFile(path, 'utf8');
  const updated = source.replace(relativeGtsSpecifier, '$1$2.js$3');
  if (updated !== source) {
    await writeFile(path, updated);
    rewrittenFileCount++;
  }
  const leftover = updated.match(anyGtsSpecifier);
  if (leftover) {
    throw new Error(
      `fix-declaration-extensions: unrewritable .gts specifier ${leftover[0]} remains in ${path}`,
    );
  }
}

console.log(
  `fix-declaration-extensions: rewrote .gts specifiers in ${rewrittenFileCount} declaration files`,
);
