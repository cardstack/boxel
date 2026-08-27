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

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dependency = 'content-tag';

function readJSON(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Every field a package can declare a dependency under, and every declaration
// is compared rather than the first one found: a package naming content-tag
// under two fields has two ranges, and comparing one of them would leave the
// other free to say anything.
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

function declaredRanges(
  manifest: Record<string, any>,
): { field: string; range: string }[] {
  let declarations: { field: string; range: string }[] = [];
  for (let field of dependencyFields) {
    let range = manifest[field]?.[dependency];
    if (range !== undefined) {
      declarations.push({ field, range });
    }
  }
  return declarations;
}

/**
 * The workspace's own package globs, read from `pnpm-workspace.yaml` rather
 * than restated here: a glob added there has to bring its packages into this
 * comparison, and a hand-maintained list would not.
 *
 * Parsed by hand because these scripts run under node's type stripping with no
 * dependencies. The block is a flat YAML sequence of scalars, which is the only
 * shape pnpm accepts for it.
 */
function workspaceGlobs(): string[] {
  let lines = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8').split(
    '\n',
  );
  let start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  if (start === -1) {
    throw new Error(
      'pnpm-workspace.yaml declares no `packages:` block; this check cannot discover what to compare',
    );
  }
  let globs: string[] = [];
  for (let line of lines.slice(start + 1)) {
    let entry = line.match(/^\s+-\s+(.+?)\s*$/);
    if (!entry) {
      // The first line that is not a sequence item ends the block. A blank line
      // inside it would end it early, which YAML does not allow here anyway.
      if (line.trim() === '' || /^\s/.test(line)) {
        continue;
      }
      break;
    }
    globs.push(entry[1]!.replace(/^["']|["']$/g, ''));
  }
  return globs;
}

/**
 * Directories a glob names, relative to the repo root. Supports the segment
 * wildcards pnpm's workspace globs use — `*` within one path segment and `**`
 * across any number of them — and throws on anything else rather than quietly
 * matching nothing, because a glob this failed to expand would drop its
 * packages out of the comparison silently.
 */
function expandGlob(glob: string): string[] {
  let segments = glob.split('/').filter((segment) => segment.length > 0);
  let matches = [''];
  for (let segment of segments) {
    // Ahead of the wildcard branches rather than inside the literal one, so a
    // segment carrying BOTH an unsupported construct and a `*` is refused
    // rather than compiled into a pattern that matches nothing. Neither `*`
    // nor `**` contains any of these characters, so the supported wildcards
    // still reach their branches.
    if (/[?[\]{}!+@()]/.test(segment)) {
      throw new Error(
        `pnpm-workspace.yaml declares \`${glob}\`, whose \`${segment}\` is a pattern this check cannot expand — teach it that syntax rather than leaving those packages uncompared`,
      );
    }
    let next: string[] = [];
    if (segment === '**') {
      let descend = (dir: string) => {
        next.push(dir);
        for (let entry of childDirectories(dir)) {
          descend(join(dir, entry));
        }
      };
      matches.forEach(descend);
    } else if (segment.includes('*')) {
      let pattern = new RegExp(
        `^${segment.split('*').map(escapeRegExp).join('[^/]*')}$`,
      );
      for (let dir of matches) {
        for (let entry of childDirectories(dir)) {
          if (pattern.test(entry)) {
            next.push(join(dir, entry));
          }
        }
      }
    } else {
      for (let dir of matches) {
        if (existsSync(join(repoRoot, dir, segment))) {
          next.push(join(dir, segment));
        }
      }
    }
    matches = next;
    if (matches.length === 0) {
      break;
    }
  }
  return matches.filter((dir) => dir.length > 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function childDirectories(dir: string): string[] {
  try {
    return readdirSync(join(repoRoot, dir), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name !== 'node_modules' &&
          !entry.name.startsWith('.'),
      )
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

// Every workspace package that declares it, discovered from the globs rather
// than listed: a new declarer joining one of them is the case this check exists
// for, and a hand-maintained list would omit it. Bounding discovery to the
// globs is what keeps the set equal to the packages that can HAVE an installed
// copy — a manifest outside the workspace (a generated bundle, a config
// directory carrying its own package.json) never gets a `node_modules` beside
// it, so comparing one could only ever report a missing install.
const included = new Set<string>();
const excluded = new Set<string>();
for (let glob of workspaceGlobs()) {
  let negated = glob.startsWith('!');
  let target = negated ? excluded : included;
  for (let dir of expandGlob(negated ? glob.slice(1) : glob)) {
    target.add(dir.split(sep).join('/'));
  }
}

const packages = [...included]
  .filter((pkg) => !excluded.has(pkg))
  .filter((pkg) => {
    try {
      return (
        declaredRanges(readJSON(join(repoRoot, pkg, 'package.json'))).length > 0
      );
    } catch {
      return false;
    }
  })
  .sort();

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
  for (let { field, range } of declaredRanges(
    readJSON(join(repoRoot, pkg, 'package.json')),
  )) {
    declared.set(`${pkg} (${field})`, range);
  }

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

function disagreement(
  label: string,
  noun: string,
  values: Map<string, string>,
): string[] {
  let distinct = new Set(values.values());
  if (distinct.size <= 1) {
    return [];
  }
  return [
    `${distinct.size} different ${label} ${dependency}s across ${values.size} ${noun}:\n` +
      [...values].map(([key, value]) => `  ${key}: ${value}`).join('\n'),
  ];
}

offenders.push(
  // The declared map is keyed by declaration rather than by package, because a
  // package naming content-tag under two fields has two of them.
  ...disagreement('declared', 'declarations', declared),
  ...disagreement('installed', 'packages', installedVersion),
  ...disagreement('resolved', 'packages', installedPath),
);

console.log(
  `${dependency} parity: ` +
    [...installedVersion]
      .map(([pkg, version]) => `${pkg} ${version}`)
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
