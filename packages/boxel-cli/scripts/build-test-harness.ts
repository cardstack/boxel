/**
 * Populate `packages/boxel-cli/bundled-test-harness/` from
 * `packages/host/dist/`, so a published `@cardstack/boxel-cli`
 * install can run `boxel test` without the monorepo on disk
 * (CS-11164).
 *
 * Copies the dev-mode host build wholesale, dropping only sourcemaps.
 * Tried a manifest-driven slim cut (~27 MB instead of ~60 MB), but
 * the manifest needed manual regen whenever the host's chunks
 * re-hashed, and we don't want correctness to depend on human
 * upkeep — see `feedback_no_manual_maintenance` in memory. The full
 * dist is ~60 MB unpacked and ~15 MB on the wire; next to the
 * 150 MB Playwright chromium install every `boxel test` user
 * already needs, it's noise.
 *
 * Run order: requires `pnpm --filter @cardstack/host build` to have
 * produced `packages/host/dist/` first. The CI publish workflow
 * chains both; see `.github/workflows/boxel-cli-publish.yml`.
 */

import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const PACKAGE_ROOT = resolve(__dirname, '..');
const MONOREPO_PACKAGES = resolve(PACKAGE_ROOT, '..');

const HOST_DIST = join(MONOREPO_PACKAGES, 'host', 'dist');
const OUT_DIR = join(PACKAGE_ROOT, 'bundled-test-harness');

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
    if (!statSync(join(HOST_DIST, 'tests', 'index.html')).isFile()) {
      throw new Error('tests/index.html missing');
    }
  } catch {
    console.error(
      `Missing host dev dist at ${HOST_DIST}.\n` +
        '  - Run `pnpm --filter @cardstack/host build` first (dev mode).\n' +
        '  - Production mode (`pnpm build:production`) strips test entries; ' +
        "don't use it as input here.",
    );
    process.exit(1);
  }
}

function main(): void {
  console.log('Building bundled-test-harness for boxel-cli (CS-11164)...');
  ensureHostDist();

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  // Single recursive copy; the only thing we filter out is sourcemaps
  // (the headless test runner never reads them, and they roughly
  // double the size).
  cpSync(HOST_DIST, OUT_DIR, {
    recursive: true,
    filter: (src) => !basename(src).endsWith('.map'),
  });

  let size = dirSize(OUT_DIR);
  console.log(
    `Bundled-test-harness: ${(size / 1024 / 1024).toFixed(2)} MB ` +
      `(host dist minus sourcemaps)`,
  );
}

main();
