/**
 * Side-effect-free utilities for locating the host app dist directory.
 *
 * These are intentionally NOT in harness/shared.ts because that module
 * strips ambient env vars at import time (a harness-only side effect).
 * Code outside the harness (e.g. scripts/lib) can safely import from here.
 */
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const packageRoot = resolve(process.cwd());
const workspaceRoot = resolve(packageRoot, '..', '..');
const hostDir = resolve(packageRoot, '..', 'host');

export function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function findRootRepoCheckoutDir(): string | undefined {
  let result = spawnSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );

  if (result.status !== 0) {
    return undefined;
  }

  let commonDir = result.stdout.trim();
  if (!commonDir.endsWith(`${join('.git')}`)) {
    return undefined;
  }

  return dirname(commonDir);
}

export function findHostDistPackageDir(): string | undefined {
  let rootRepoCheckoutDir = findRootRepoCheckoutDir();
  let rootRepoHostDir =
    rootRepoCheckoutDir && rootRepoCheckoutDir !== workspaceRoot
      ? resolve(rootRepoCheckoutDir, 'packages', 'host')
      : undefined;

  let candidates = [
    process.env.TEST_HARNESS_HOST_DIST_PACKAGE_DIR,
    hostDir,
    rootRepoHostDir,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => resolve(value));

  let seen = new Set<string>();
  for (let candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    if (fileExists(join(candidate, 'dist', 'index.html'))) {
      return candidate;
    }
  }

  return undefined;
}
