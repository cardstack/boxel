#!/usr/bin/env -S node
// Holds every package that declares content-tag on one version of it.
//
// Several packages preprocess authored `<template>` source with their own copy:
// the realm transpiles with runtime-common's, the Host's module classifier
// analyzes what host's emits, and the CLI drives its own. Those copies have to
// agree about what the compiled form looks like. Where they do not, the
// classifier reads a module the realm serves as an unfinished draft — and a
// draft's module graph is empty, which is the whole of a sandboxed render's
// fetch authority, so the card is refused its own modules. The quieter
// divergence is the injected template-compiler import being spelled
// differently, which adds a module to every templated card's graph.
//
// Parity is a side effect of every package spelling the dependency `catalog:`,
// which resolves to one version for the whole workspace, and nothing declares
// that it matters. The host browser suite bundles host's copy and
// runtime-common's into one process, so a divergence that changes behavior on
// the syntax those tests cover does surface there — but only incidentally, and
// only for that pair. What no test sees is the declaration itself drifting, or a
// divergence in a package no suite bundles both sides of.
//
// So both the declared range and the installed version are compared. The
// declared range catches the edit, in the diff that makes it; the installed
// version catches the ways a range is not the last word — an override scoped to
// one package, a patch, a stale store.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dependency = 'content-tag';

function readJSON(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function declaredRange(manifest: Record<string, any>): string | undefined {
  return (
    manifest.dependencies?.[dependency] ??
    manifest.devDependencies?.[dependency]
  );
}

// Every package that declares it, discovered rather than listed: a new one
// joining is the case this check exists for, and a hand-maintained list would
// silently omit it.
const packages = readdirSync(join(repoRoot, 'packages'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => `packages/${entry.name}`)
  .filter((pkg) => {
    try {
      return (
        declaredRange(readJSON(join(repoRoot, pkg, 'package.json'))) !==
        undefined
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
const installed = new Map<string, string>();
const offenders: string[] = [];

for (let pkg of packages) {
  let range = declaredRange(readJSON(join(repoRoot, pkg, 'package.json')))!;
  declared.set(pkg, range);

  // Read through the package's own node_modules rather than resolving from
  // here: under pnpm's isolated layout that directory IS what the package's
  // imports see, which is the copy whose behavior matters.
  try {
    installed.set(
      pkg,
      readJSON(join(repoRoot, pkg, 'node_modules', dependency, 'package.json'))
        .version,
    );
  } catch {
    offenders.push(
      `${pkg} has no installed ${dependency} — run pnpm install before this check`,
    );
  }
}

function disagreement(label: string, values: Map<string, string>): string[] {
  if (new Set(values.values()).size <= 1) {
    return [];
  }
  return [
    `${values.size} packages disagree on the ${label} ${dependency}:\n` +
      [...values].map(([pkg, value]) => `  ${pkg}: ${value}`).join('\n'),
  ];
}

offenders.push(
  ...disagreement('declared', declared),
  ...disagreement('installed', installed),
);

console.log(
  `${dependency} parity: ` +
    [...installed]
      .map(([pkg, version]) => `${pkg} ${version} (${declared.get(pkg)})`)
      .join(', '),
);

if (offenders.length > 0) {
  console.error(
    `\n${offenders.join('\n')}\n\n` +
      `These packages preprocess authored \`<template>\` source with their own copy,\n` +
      `and the Host's module classifier analyzes what its copy emits. Put them back on\n` +
      `one version — \`catalog:\` everywhere is what holds this without an override.`,
  );
}

process.exit(offenders.length > 0 ? 1 : 0);
