// The published package's exports map: the subpaths an installed
// `@cardstack/bxl` serves, and how they are derived from the ones this repo
// serves.
//
// `scripts/build.ts` asserts the same invariant, but only when a build runs.
// Checking it here means ordinary `pnpm test` catches a subpath added to one map
// and forgotten in the other.

import { deepStrictEqual, strictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';

import { publishedExportsFor } from '../../scripts/build.ts';

let checks = 0;

const manifest = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);

// The invariant itself: what the published package serves is what deriving the
// development map gives, entry for entry — not merely the same subpaths.
checks++;
deepStrictEqual(
  manifest.publishConfig.exports,
  publishedExportsFor(manifest.exports),
  'publishConfig.exports mirrors exports',
);

// Every subpath a consumer can reach resolves to something the tarball ships.
for (const [subpath, target] of Object.entries<string>(
  manifest.publishConfig.exports,
)) {
  checks++;
  const shipped =
    target === './package.json' ||
    manifest.files.some(
      (entry: string) =>
        target.startsWith(`./${entry}/`) || target === `./${entry}`,
    );
  strictEqual(shipped, true, `${subpath} → ${target} is covered by "files"`);
}

// The derivation, on its own terms.
checks++;
deepStrictEqual(
  publishedExportsFor({
    '.': './src/index.ts',
    './package.json': './package.json',
    './mutation': './src/mutation/index.ts',
    './syntax/textmate': './src/bxl/syntax/bxl.tmLanguage.json',
    './*': './src/*.ts',
  }),
  {
    '.': './dist/index.js',
    './package.json': './package.json',
    './mutation': './dist/mutation/index.js',
    // A data file moves but keeps its extension — the compiler doesn't emit it,
    // the build copies it.
    './syntax/textmate': './dist/bxl/syntax/bxl.tmLanguage.json',
    // The wildcard is a pattern in both maps, and translates like any other.
    './*': './dist/*.js',
  },
);

// Only `src/` moves. A target that already points elsewhere is left alone, so
// the derivation can't invent a `dist/` path for something that never had one.
checks++;
deepStrictEqual(publishedExportsFor({ './docs': './docs/README.md' }), {
  './docs': './docs/README.md',
});

console.log(`published exports map: ${checks} checks passed`);
