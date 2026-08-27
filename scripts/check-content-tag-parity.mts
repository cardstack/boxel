#!/usr/bin/env -S node
// Holds every package that declares content-tag on one copy of it.
//
// Several packages preprocess authored `<template>` source with content-tag,
// and they have to agree about what the compiled form looks like. Where they do
// not, the Host's module classifier reads a module the realm serves as an
// unfinished draft — and a draft's module graph is empty, which is the whole of
// a sandboxed render's fetch authority, so the card is refused its own modules.
// The quieter divergence is the injected template-compiler import being spelled
// differently, which adds a module to every templated card's graph.
//
// Two of the copies are reached indirectly, which is why this compares
// declarers rather than importers. `boxel test` preprocesses a user's cards
// through `transpileJS`, so it runs runtime-common's copy — but boxel-cli's
// build bundles its OWN copy's JavaScript glue into `dist/` and then copies the
// wasm binary beside it from `packages/boxel-cli/node_modules`. Glue and wasm
// that came from different versions ship together in that tarball.
//
// Parity is a side effect of every package spelling the dependency `catalog:`,
// which resolves to one version for the whole workspace, and nothing declares
// that it matters. The host browser suite bundles host's copy and
// runtime-common's into one process, so a divergence that changes behavior on
// the syntax those tests cover does surface there — but only incidentally, and
// only for that pair. What no test sees is the declaration itself drifting, or a
// divergence in a package no suite bundles both sides of.
//
// So three things are compared. The declared range catches the edit, in the diff
// that makes it. The installed version catches a range that was not the last
// word — an override scoped to one package, a stale store. The resolved path
// catches what a version string cannot: a `patchedDependencies` entry leaves the
// patched package's own `version` untouched and encodes itself in the store
// directory name instead, so two packages can report the same version while one
// of them is running different code.

import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dependency = 'content-tag';

// Deep enough for every workspace glob this repo declares — `packages/*`,
// `packages/boxel-ui/docs-app`, `vendor/*` — with room for one more level, so a
// glob added to `pnpm-workspace.yaml` does not silently fall outside the scan.
const maxDepth = 4;
const skipDirectories = new Set(['node_modules', 'dist', 'declarations']);

function readJSON(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Every field a package can declare a dependency under. A declaration this
// missed would drop the package out of the comparison entirely, which is the
// silent pass this check exists to prevent — so the set is the whole of them
// rather than the two a workspace package usually uses.
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

function declaredRange(manifest: Record<string, any>): string | undefined {
  for (let field of dependencyFields) {
    let range = manifest[field]?.[dependency];
    if (range !== undefined) {
      return range;
    }
  }
  return undefined;
}

/**
 * Every package that declares it, discovered by walking the tree rather than
 * from a list: a new declarer joining is the case this check exists for, and
 * both a hand-maintained list and a scan of one directory level would omit it.
 */
function declaringPackages(directory: string, depth = 0): string[] {
  let found: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (let entry of entries) {
    if (entry.name === 'package.json' && entry.isFile() && depth > 0) {
      try {
        if (
          declaredRange(readJSON(join(directory, entry.name))) !== undefined
        ) {
          found.push(relative(repoRoot, directory).split(sep).join('/'));
        }
      } catch {
        // A manifest that does not parse is not this check's to report.
      }
    }
    if (
      entry.isDirectory() &&
      !entry.name.startsWith('.') &&
      !skipDirectories.has(entry.name) &&
      depth < maxDepth
    ) {
      found.push(...declaringPackages(join(directory, entry.name), depth + 1));
    }
  }
  return found;
}

const packages = declaringPackages(repoRoot).sort();

if (packages.length < 2) {
  console.error(
    `only ${packages.length} package declares ${dependency}; this check compares copies, so it has nothing to hold`,
  );
  process.exit(1);
}

const declared = new Map<string, string>();
const installedVersion = new Map<string, string>();
const installedPath = new Map<string, string>();
const offenders: string[] = [];

for (let pkg of packages) {
  declared.set(
    pkg,
    declaredRange(readJSON(join(repoRoot, pkg, 'package.json')))!,
  );

  // Read through the package's own node_modules rather than resolving from
  // here: under pnpm's isolated layout that directory IS what the package's
  // imports see, which is the copy whose behavior matters.
  let installed = join(repoRoot, pkg, 'node_modules', dependency);
  try {
    installedVersion.set(
      pkg,
      readJSON(join(installed, 'package.json')).version,
    );
    installedPath.set(
      pkg,
      relative(repoRoot, realpathSync(installed)).split(sep).join('/'),
    );
  } catch {
    offenders.push(
      `${pkg} has no installed ${dependency} — run pnpm install before this check`,
    );
  }
}

function disagreement(label: string, values: Map<string, string>): string[] {
  let distinct = new Set(values.values());
  if (distinct.size <= 1) {
    return [];
  }
  return [
    `${distinct.size} different ${label} ${dependency}s across ${values.size} packages:\n` +
      [...values].map(([pkg, value]) => `  ${pkg}: ${value}`).join('\n'),
  ];
}

offenders.push(
  ...disagreement('declared', declared),
  ...disagreement('installed', installedVersion),
  ...disagreement('resolved', installedPath),
);

console.log(
  `${dependency} parity: ` +
    [...installedVersion]
      .map(([pkg, version]) => `${pkg} ${version} (${declared.get(pkg)})`)
      .join(', '),
);

if (offenders.length > 0) {
  console.error(
    `\n${offenders.join('\n')}\n\n` +
      `These packages preprocess authored \`<template>\` source with content-tag, and\n` +
      `the Host's module classifier analyzes what its copy emits. Put them back on one\n` +
      `copy — \`catalog:\` everywhere is what holds this without an override or a patch.`,
  );
}

process.exit(offenders.length > 0 ? 1 : 0);
