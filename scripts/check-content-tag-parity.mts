#!/usr/bin/env -S node
// Holds `packages/host` and `packages/runtime-common` on the same content-tag.
//
// Both packages preprocess authored `<template>` source, and each uses its own
// copy: the realm transpiles with runtime-common's (`transpile.ts`), while the
// Boxel source classifier in host analyzes what host's copy emits. Those two
// copies have to agree about what the compiled form looks like. Where they do
// not, the classifier reads a module the realm serves as an unfinished draft —
// or reads the injected template-compiler import as an authored graph edge, and
// adds a module to every templated card's graph.
//
// Nothing today fails when they diverge. Parity is a side effect of both
// packages spelling the dependency `catalog:`, which resolves to one version
// for the whole workspace; pinning either side to a literal range, or adding a
// pnpm override for one of them, breaks it silently and in a shape no test can
// see, since a test suite bundles whatever it resolved.
//
// So both the declared range and the installed version are compared. The
// declared range catches the edit, in the diff that makes it; the installed
// version catches the ways a range is not the last word — an override, a
// patch, a stale store.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = ['packages/host', 'packages/runtime-common'];
const dependency = 'content-tag';

function readJSON(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const declared = new Map<string, string>();
const installed = new Map<string, string>();
const offenders: string[] = [];

for (let pkg of packages) {
  let manifest = readJSON(join(repoRoot, pkg, 'package.json'));
  let range =
    manifest.dependencies?.[dependency] ??
    manifest.devDependencies?.[dependency];
  if (!range) {
    offenders.push(`${pkg} does not declare ${dependency}`);
    continue;
  }
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
      `Both packages preprocess authored \`<template>\` source with their own copy,\n` +
      `and the source classifier analyzes what its copy emits. Put them back on one\n` +
      `version — \`catalog:\` on both sides is what holds this without an override.`,
  );
}

process.exit(offenders.length > 0 ? 1 : 0);
