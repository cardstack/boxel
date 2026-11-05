// The secure origin's build reads boxel-icons from boxel-icons' own build,
// the only thing its package exports, so boxel-icons is built first wherever
// the origin is (ADR 019 §1.1). `pnpm build` runs this before building.
//
// It builds boxel-icons' JavaScript (`build:js`; the origin needs no type
// declarations) when there is no build, or when any of the files that build
// is made from is newer than it. A build already in place is kept: the
// realm-server image's own boxel-icons stage, CI's restored builds, and a
// checkout's earlier build. boxel-ui isn't built: the origin compiles it from
// its source.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PACKAGE_ROOT } from './module-package.ts';

export const ICONS_ROOT = join(PACKAGE_ROOT, '..', 'boxel-icons');

// A file boxel-icons' build always writes, standing for the whole build.
function builtFile(root: string): string {
  return join(
    root,
    'dist',
    '@cardstack',
    'boxel-icons',
    'v1',
    'boxel-icons-meta.js',
  );
}

// What boxel-icons' build is made from, as CI's cache of it is keyed.
const INPUT_DIRS = ['src', 'unpublished-development-types'];
const INPUT_FILES = [
  'package.json',
  'rollup.config.mjs',
  'tsconfig.json',
  'babel.config.json',
];

function modified(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

function newestIn(dir: string): number {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (let entry of entries) {
    let path = join(dir, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory() ? newestIn(path) : (modified(path) ?? 0),
    );
  }
  return newest;
}

// Why boxel-icons needs building, or undefined when its build is current.
export function iconsStale(root: string = ICONS_ROOT): string | undefined {
  let built = modified(builtFile(root));
  if (built === undefined) {
    return 'boxel-icons has no build';
  }
  let newest = Math.max(
    ...INPUT_DIRS.map((dir) => newestIn(join(root, dir))),
    ...INPUT_FILES.map((file) => modified(join(root, file)) ?? 0),
  );
  return newest > built
    ? "boxel-icons' sources are newer than its build"
    : undefined;
}

if (import.meta.main) {
  let reason = iconsStale();
  if (reason === undefined) {
    process.exit(0);
  }
  console.log(`secure origin: building boxel-icons, because ${reason}`);
  let { status, error } = spawnSync('pnpm', ['build:js'], {
    cwd: ICONS_ROOT,
    stdio: 'inherit',
  });
  if (error) {
    console.error(error);
  }
  process.exit(status ?? 1);
}
