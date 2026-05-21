/**
 * Populate `packages/boxel-cli/bundled-test-harness/` from
 * `packages/host/dist/`, so a published `@cardstack/boxel-cli`
 * install can run `boxel test` without the monorepo on disk
 * (CS-11164).
 *
 * What gets shipped:
 *
 * - Only the files chromium actually fetches while running card tests,
 *   as listed in `scripts/test-harness-manifest.json`. The manifest was
 *   captured by running the existing test runner with the env var
 *   `BOXEL_TEST_HARNESS_MANIFEST=<path>` set (which records every
 *   request to the test-page server). Files referenced by the manifest
 *   but missing from `host/dist/` are skipped silently — they're
 *   typically routes that the live-test entry point doesn't navigate
 *   to.
 * - `tests/index.html` is always included even if the manifest is
 *   stale, because the CLI reads it directly off disk to build the
 *   QUnit page; without it `boxel test` errors before the manifest
 *   filter ever matters.
 *
 * What gets stripped:
 *
 * - `*.map` sourcemap files (no value to the headless runner).
 * - Every chunk the manifest doesn't reference: the AI assistant,
 *   code-mode UI, monaco workers, cytoscape, katex, and most of the
 *   commands that card tests don't exercise. This is what gets the
 *   harness from ~60MB (full host dist minus sourcemaps) down to
 *   ~30MB.
 *
 * ## Regenerating the manifest
 *
 * When the host adds a dependency that card tests load at runtime,
 * the manifest goes stale and tests will 404 on the new chunk. To
 * refresh:
 *
 *     # 1. From the monorepo, rebuild the host and the cli:
 *     pnpm --filter @cardstack/host build
 *     pnpm --filter @cardstack/boxel-cli build
 *
 *     # 2. Capture a fresh manifest by running a representative card
 *     #    test with the env var set. Use a workspace that exercises
 *     #    `setupCardTest` + `renderCard` (the helper surface every
 *     #    card test depends on):
 *     BOXEL_TEST_HARNESS_MANIFEST=$PWD/scripts/test-harness-manifest.json \
 *       boxel test path/to/representative-workspace
 *
 *     # 3. Re-run `pnpm build`; the slim bundle now includes any new
 *     #    chunks the manifest captured.
 *
 * Don't add unrelated entries by hand — the manifest is generated, and
 * editing it manually risks drift between what the test runner actually
 * loads and what we ship.
 *
 * Run order: `pnpm --filter @cardstack/host build` first (produces
 * `host/dist/`), then this script copies only the manifest-referenced
 * files. The CI build script chains these together via the boxel-cli
 * `package.json`'s `build` script.
 */

import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const PACKAGE_ROOT = resolve(__dirname, '..');
const MONOREPO_PACKAGES = resolve(PACKAGE_ROOT, '..');

const HOST_DIST = join(MONOREPO_PACKAGES, 'host', 'dist');
const OUT_DIR = join(PACKAGE_ROOT, 'bundled-test-harness');
const MANIFEST_FILE = join(
  PACKAGE_ROOT,
  'scripts',
  'test-harness-manifest.json',
);

// Files the manifest can't capture but the CLI reads directly. Add
// here, not to the manifest, when the CLI grows a new direct read.
const ALWAYS_INCLUDE = ['/tests/index.html'];

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

function loadManifest(): string[] {
  try {
    return JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) as string[];
  } catch (err) {
    console.error(
      `Failed to read ${MANIFEST_FILE}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

function main(): void {
  console.log('Building bundled-test-harness for boxel-cli (CS-11164)...');
  ensureHostDist();

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  let manifest = loadManifest();
  let entries = new Set<string>([...manifest, ...ALWAYS_INCLUDE]);

  let copied = 0;
  let skipped: string[] = [];

  for (let entry of entries) {
    // Manifest entries are URL paths captured from the test runner.
    // The CLI's local-mode realm mounts (`/workspace/`, `/base/`,
    // `/skills/`) and the root request (`/`) are served at runtime,
    // not from host/dist — skip those.
    if (
      entry === '/' ||
      entry.startsWith('/workspace/') ||
      entry.startsWith('/base/') ||
      entry.startsWith('/skills/')
    ) {
      continue;
    }
    let rel = entry.replace(/^\//, '');
    let src = join(HOST_DIST, rel);
    let dst = join(OUT_DIR, rel);
    try {
      let st = statSync(src);
      if (!st.isFile()) {
        skipped.push(entry);
        continue;
      }
    } catch {
      skipped.push(entry);
      continue;
    }
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    copied++;
  }

  let size = dirSize(OUT_DIR);
  console.log(
    `Bundled-test-harness: ${copied} files, ${(size / 1024 / 1024).toFixed(2)} MB`,
  );
  if (skipped.length > 0) {
    console.log(
      `  ${skipped.length} manifest entries skipped (not present in host/dist).`,
    );
  }
}

main();
