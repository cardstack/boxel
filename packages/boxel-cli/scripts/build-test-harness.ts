/**
 * Populate `packages/boxel-cli/bundled-test-harness/` from
 * `packages/host/dist/`, so a published `@cardstack/boxel-cli`
 * install can run `boxel test` without the monorepo on disk
 * (CS-11164).
 *
 * What gets shipped:
 *
 * - The dev-mode host build (which includes the test entry
 *   `tests/index.html` + `tests/test-helper.js` + qunit + helpers).
 *   The production build strips test assets entirely; the dev build
 *   keeps them.
 * - All `assets/*.js` chunks, the test HTML, and the WASM blobs the
 *   runtime needs (sqlite3, content-tag, matrix-sdk-crypto).
 *
 * What gets stripped:
 *
 * - `*.map` sourcemap files (~half the size, ~20MB).
 *
 * What we considered stripping but kept:
 *
 * - Monaco editor (`editor.*`, `ts.worker-*`, etc., ~19MB). On paper
 *   this is only loaded by code-mode UI, which the test runner never
 *   navigates to. In practice the host's Ember service container
 *   constructs the editor wiring during boot, so the chunks get
 *   eagerly imported and 404s on those break test-page initialization
 *   (silent — surfaces as a 5-minute `waitForFunction` timeout, with
 *   only "404 (Not Found)" lines in `--debug` output). Don't strip
 *   them again without auditing the host's boot-time dynamic-imports
 *   for these chunks.
 *
 * Falls back to monorepo `packages/host/dist/` in development if
 * `bundled-test-harness/` hasn't been built yet — same
 * detection pattern as `bundled-types/`.
 *
 * Size note: the bundle lands around ~60MB. Most of that is
 * load-bearing (matrix-sdk-crypto wasm, content-tag wasm, sqlite3
 * wasm, runtime-common, the host's render plumbing, Monaco editor
 * chunks that get eagerly imported during host boot). It's a lot,
 * but `boxel test` also requires `npx playwright install chromium`
 * (~150MB) on first run, so 60MB of JS is noise next to the browser
 * binary that has to be there anyway. Don't refactor to a lazy
 * companion package or remote-served harness unless the CLI grows a
 * wider (non-dev) audience — the current shape is simpler and avoids
 * version drift between CLI and harness.
 *
 * Run order: `pnpm --filter @cardstack/host build` first (produces
 * `host/dist/`), then this script copies the slimmed-down result
 * over. The CI build script chains these together via
 * `package.json`'s `build` script.
 */

import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const PACKAGE_ROOT = resolve(__dirname, '..');
const MONOREPO_PACKAGES = resolve(PACKAGE_ROOT, '..');

const HOST_DIST = join(MONOREPO_PACKAGES, 'host', 'dist');
const OUT_DIR = join(PACKAGE_ROOT, 'bundled-test-harness');

// Substring matches — applied to the basename only. Anything that
// matches one of these patterns is dropped from the bundle.
const SKIP_PATTERNS = [
  // Sourcemaps are dev-only artifacts the test runner never reads.
  /\.map$/,
];

function shouldSkip(name: string): boolean {
  return SKIP_PATTERNS.some((re) => re.test(name));
}

function dirSize(dir: string): number {
  let total = 0;
  let walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (let entry of entries) {
      let full = join(current, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else total += st.size;
    }
  };
  walk(dir);
  return total;
}

function ensureHostDist(): void {
  try {
    if (!statSync(HOST_DIST).isDirectory()) {
      throw new Error('not a directory');
    }
  } catch {
    console.error(
      `Missing host dist at ${HOST_DIST}. Run ` +
        `\`pnpm --filter @cardstack/host build\` first, then re-run ` +
        `this script.`,
    );
    process.exit(1);
  }
}

function main(): void {
  console.log('Building bundled-test-harness for boxel-cli (CS-11164)...');
  ensureHostDist();

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  // Single recursive copy with a per-path filter; `cpSync` calls the
  // filter for every path under the source tree (files and dirs), and
  // skipping a directory short-circuits its descendants.
  cpSync(HOST_DIST, OUT_DIR, {
    recursive: true,
    filter: (src) => !shouldSkip(basename(src)),
  });

  let size = dirSize(OUT_DIR);
  console.log(`Bundled-test-harness: ${(size / 1024 / 1024).toFixed(2)} MB`);
}

main();
