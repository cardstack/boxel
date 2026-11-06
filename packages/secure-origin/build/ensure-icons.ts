// The secure origin's build reads boxel-icons from boxel-icons' own build,
// the only thing its package exports, so boxel-icons is built first wherever
// the origin is (ADR 019 §1.1). `pnpm build`, `pnpm lint` and
// `pnpm test:components` run this first.
//
// It builds boxel-icons in full (`build`: its JavaScript, which the origin
// ships, and its type declarations, which the package's type check reads)
// when there is no build, and writes a stamp into `dist/` holding a hash of
// what that build was made from: boxel-icons' own inputs and what decides
// the versions of the tools that build it (the lockfile and the dependency
// fetch's other inputs), the same inputs CI's cache of its build is keyed
// on (`.github/actions/restore-icons-cache`). It builds again
// when the stamp no longer matches. A build with no stamp was made by
// something else: CI's cache or test-assets artifact, the realm-server image's
// boxel-icons stage, or boxel-icons' own `pnpm build`. That build is kept, as
// each of those already decides when to build. boxel-ui isn't built: the
// origin compiles it from its source.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

import { PACKAGE_ROOT } from './module-package.ts';

export const ICONS_ROOT = join(PACKAGE_ROOT, '..', 'boxel-icons');
export const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');

export const STAMP = join('dist', '.secure-origin-inputs');

// A file boxel-icons' build always writes, standing for its JavaScript, and
// the directory its declarations go to.
const BUILT = join(
  'dist',
  '@cardstack',
  'boxel-icons',
  'v1',
  'boxel-icons-meta.js',
);
const DECLARATIONS = 'declarations';

// What boxel-icons' build is made from, relative to boxel-icons, and what
// decides the tools that build it, relative to the repository.
export const ICON_INPUTS = [
  'src',
  'unpublished-development-types',
  'package.json',
  'rollup.config.mjs',
  'tsconfig.json',
  'babel.config.json',
];
export const DEPENDENCY_INPUTS = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.pnpmfile.cjs',
  'patches',
];

function filesIn(path: string): string[] {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return [];
  }
  if (stat.isFile()) {
    return [path];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  return readdirSync(path)
    .sort()
    .flatMap((name) => filesIn(join(path, name)));
}

// A hash of every input, each named by its path, so a file that moves counts
// as a change too.
export function iconsInputsHash(
  root: string = ICONS_ROOT,
  repo: string = REPO_ROOT,
): string {
  let hash = createHash('sha256');
  for (let [base, inputs] of [
    [root, ICON_INPUTS],
    [repo, DEPENDENCY_INPUTS],
  ] as const) {
    for (let input of inputs) {
      for (let file of filesIn(join(base, input))) {
        hash.update(`${relative(repo, file)}\0`);
        hash.update(readFileSync(file));
        hash.update('\0');
      }
    }
  }
  return hash.digest('hex');
}

// Why boxel-icons needs building, or undefined when its build is kept.
export function iconsStale(
  root: string = ICONS_ROOT,
  repo: string = REPO_ROOT,
): string | undefined {
  if (!existsSync(join(root, BUILT))) {
    return 'boxel-icons has no build';
  }
  let stamp = join(root, STAMP);
  if (!existsSync(stamp)) {
    return undefined;
  }
  if (readFileSync(stamp, 'utf8').trim() !== iconsInputsHash(root, repo)) {
    return 'its sources or the tools that build it have changed since this build';
  }
  if (!existsSync(join(root, DECLARATIONS))) {
    return 'its build has no type declarations';
  }
  return undefined;
}

if (import.meta.main) {
  let reason = iconsStale();
  if (reason === undefined) {
    process.exit(0);
  }
  console.log(`secure origin: building boxel-icons, because ${reason}`);
  let inputs = iconsInputsHash();
  let { status, error } = spawnSync('pnpm', ['build'], {
    cwd: ICONS_ROOT,
    stdio: 'inherit',
  });
  if (error) {
    console.error(error);
  }
  if (status === 0) {
    writeFileSync(join(ICONS_ROOT, STAMP), `${inputs}\n`);
  }
  process.exit(status ?? 1);
}
