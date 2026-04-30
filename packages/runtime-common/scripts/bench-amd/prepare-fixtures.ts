// Generate realistic loader-input fixtures by running the realm-server
// transpileJS pipeline on a set of representative .gts modules. The
// output is what the Loader's AMD transpilation step actually sees:
// plain ES6 JS with TS, decorators, glimmer templates, and scoped-CSS
// already lowered.
//
// Run from `packages/runtime-common`:
//   pnpm bench:amd:prep
//
// This is an INTENTIONAL-REFRESH operation: it overwrites the committed
// fixtures at `<repo>/bench-fixtures/runtime-common/amd-transpile/`. The
// bench gate compares against these frozen fixtures so that an unrelated
// change to a card source or the upstream `transpile.ts` pipeline cannot
// silently move the perf numbers. Re-run this only when you intentionally
// want to re-anchor the bench inputs — and remember to regenerate
// `baseline.json` in the same commit.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { fixturesDir, repoRoot } from './paths';

const baseDir = path.join(repoRoot, 'packages/base');

const fixtures: { name: string; file: string }[] = [
  { name: 'enum', file: 'enum.gts' },
  { name: 'spec', file: 'spec.gts' },
  { name: 'skill-set', file: 'skill-set.gts' },
  { name: 'card-api', file: 'card-api.gts' },
];

(async () => {
  // `transpileJS` reads `globalThis.ContentTagGlobal` (set up by realm-
  // server's main.ts at boot). Install it here the same way. content-tag
  // is ESM-only — must use dynamic import.
  const ContentTag = await import('content-tag');
  (globalThis as any).ContentTagGlobal = ContentTag;

  // transpile.ts is in the runtime-common package; ts-node intercepts the
  // `.ts` extension via require.
  const { transpileJS } =
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../../transpile') as typeof import('../../transpile');

  mkdirSync(fixturesDir, { recursive: true });

  for (const { name, file } of fixtures) {
    const src = readFileSync(path.join(baseDir, file), 'utf8');
    const transpiled = await transpileJS(src, file);
    const outPath = path.join(fixturesDir, `${name}.js`);
    writeFileSync(outPath, transpiled, 'utf8');
    console.log(
      `${name.padEnd(12)}  in: ${src.length.toString().padStart(7)} bytes  →  out: ${transpiled.length.toString().padStart(7)} bytes`,
    );
  }

  console.log(
    `\nWrote fixtures to ${path.relative(repoRoot, fixturesDir)}/. Commit them along with any baseline.json updates.`,
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
