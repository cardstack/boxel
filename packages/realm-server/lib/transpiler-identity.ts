import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSPILER_PACKAGES } from '@cardstack/runtime-common/transpile';

// A short value that changes whenever an installed package that can change
// what `transpileJS` makes from a given source changes. The realm puts it in
// the validator of every module it compiles, so a compile cached under one
// installation (in memory, in `module_transpile_cache`, or by a client holding
// the validator) doesn't match a request served under another, and is compiled
// again.
//
// The value covers each package in `TRANSPILER_PACKAGES` and every package it
// depends on, directly or not. A package installed under pnpm's store is
// named by its store directory, which carries its version, the versions of
// the peers it was installed against, and the hash of any patch applied to it.
// A package linked from inside this repository (a vendored or workspace
// package) has no such name, so it is named by a hash of its files.
//
// It is computed once, when the server starts. Reading the manifests takes
// well under a tenth of a second.
//
// A package in `packages` that isn't installed is an error. A dependency of
// one that isn't installed is recorded as such, since pnpm leaves out an
// optional dependency built for another platform.
export function transpilerIdentity(
  opts: { fromDir?: string; packages?: readonly string[] } = {},
): string {
  let fromDir = opts.fromDir ?? runtimeCommonDir();
  let packages = opts.packages ?? TRANSPILER_PACKAGES;
  let entries = transpilerPackageEntries(fromDir, packages);
  return createHash('sha256')
    .update(entries.join('\n'))
    .digest('hex')
    .slice(0, 12);
}

// The sorted names `transpilerIdentity` hashes, one per installed package.
// Exported so a test or an operator can see what the identity covers.
export function transpilerPackageEntries(
  fromDir: string,
  packages: readonly string[],
): string[] {
  let entries = new Set<string>();
  let visited = new Set<string>();
  let pending: { name: string; from: string; listed: boolean }[] = packages.map(
    (name) => ({ name, from: fromDir, listed: true }),
  );

  while (pending.length > 0) {
    let { name, from, listed } = pending.pop()!;
    let dir = resolvePackageDir(name, from);
    if (!dir) {
      if (listed) {
        throw new Error(
          `transpiler package ${name} is not installed where ${from} would find it`,
        );
      }
      entries.add(`${name}@not-installed`);
      continue;
    }
    if (visited.has(dir)) {
      continue;
    }
    visited.add(dir);
    let manifest = JSON.parse(
      readFileSync(join(dir, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    entries.add(packageEntry(name, dir));
    if (SELF_CONTAINED_PACKAGES.has(name)) {
      continue;
    }
    for (let dep of [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]) {
      pending.push({ name: dep, from: dir, listed: false });
    }
  }
  return [...entries].sort();
}

// Packages whose code `transpileJS` runs is one bundle that imports nothing,
// so what they depend on can't change the output, and is left out. ember-source
// depends on several hundred packages for building apps, none of which its
// template compiler (`dist/packages/ember-template-compiler/index.js`) loads.
// A realm-server test checks that the bundle still imports nothing.
export const SELF_CONTAINED_PACKAGES: ReadonlySet<string> = new Set([
  'ember-source',
]);

function runtimeCommonDir(): string {
  return dirname(
    fileURLToPath(
      import.meta.resolve('@cardstack/runtime-common/package.json'),
    ),
  );
}

// Node's lookup for a bare specifier: `node_modules/<name>` in the package's
// own directory and then in each directory above it, skipping directories
// that are themselves `node_modules`. Returns the real path, so a package
// reached through two symlinks counts once.
function resolvePackageDir(name: string, from: string): string | undefined {
  let dir = realpathSync(from);
  for (;;) {
    if (basename(dir) !== 'node_modules') {
      let candidate = join(dir, 'node_modules', name);
      if (existsSync(join(candidate, 'package.json'))) {
        return realpathSync(candidate);
      }
    }
    let parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

const PNPM_STORE_SEGMENT = `${sep}node_modules${sep}.pnpm${sep}`;

function packageEntry(name: string, dir: string): string {
  let storeAt = dir.indexOf(PNPM_STORE_SEGMENT);
  if (storeAt !== -1) {
    let storeName = dir
      .slice(storeAt + PNPM_STORE_SEGMENT.length)
      .split(sep)[0];
    return `${name} ${storeName}`;
  }
  return `${name} files:${hashPackageFiles(dir)}`;
}

// The contents of every file in a package linked from this repository, by
// path, leaving out what is installed into it.
function hashPackageFiles(dir: string): string {
  let hash = createHash('sha256');
  let files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter(
      (path) => !path.slice(dir.length).includes(`${sep}node_modules${sep}`),
    )
    .sort();
  for (let file of files) {
    hash.update(file.slice(dir.length));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}
