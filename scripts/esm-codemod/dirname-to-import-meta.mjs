#!/usr/bin/env node
// Replaces CommonJS `__dirname` / `__filename` with their ESM equivalents.
// Node >=20.11 exposes `import.meta.dirname` and `import.meta.filename`; under
// ESM the bare `__dirname` / `__filename` globals are undefined (ReferenceError).
//
//   path.resolve(__dirname, '..')      -> path.resolve(import.meta.dirname, '..')
//   basename(__filename)               -> basename(import.meta.filename)
//   createRequire(__filename)          -> createRequire(import.meta.filename)
//
// Apply ONLY to ESM source (.ts/.mts/.gts). Never run it on .cjs/.js CommonJS
// files, where these globals are legitimately defined.
//
// Usage: node dirname-to-import-meta.mjs <file>...   (edits in place)
import { readFileSync, writeFileSync } from 'node:fs';

export function transform(src) {
  let changed = false;
  let code = src
    .replace(/\b__dirname\b/g, () => {
      changed = true;
      return 'import.meta.dirname';
    })
    .replace(/\b__filename\b/g, () => {
      changed = true;
      return 'import.meta.filename';
    });
  return { code, changed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let count = 0;
  for (const file of process.argv.slice(2)) {
    if (/\.(cjs|js)$/.test(file)) continue; // never touch CommonJS files
    const { code, changed } = transform(readFileSync(file, 'utf8'));
    if (changed) {
      writeFileSync(file, code);
      count++;
    }
  }
  console.log(`dirname-to-import-meta: ${count} file(s) changed`);
}
