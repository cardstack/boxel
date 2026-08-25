#!/usr/bin/env -S node
// Makes a tier adapter landing visible to the record-parity harness (RP-14.4).
//
// The harness compares the records every tier produces, but it can only
// compare tiers it was handed. Nothing about writing a second `BoxelRuntime`
// implementation wires it in, and nothing about forgetting to fails: the
// harness reports parity across the tiers it knows, so an unregistered adapter
// is not a red test, it is an absent one. That is the failure this project
// already paid for once — the spike grew three record builders, and nearly
// every parity bug traced to two of the three disagreeing with no check
// watching.
//
// So the set of `BoxelRuntime` implementations in the repo is held EQUAL to the
// list recorded below. An adapter appearing fails the build until someone
// records it here, which is the moment to hand it to `checkRecordParity` as a
// registered mode. An adapter disappearing fails too, because a harness still
// listing a mode that no longer exists reports a tier absent forever.
//
// What this cannot see, and does not claim to: an implementation that satisfies
// the interface structurally, with no `implements` / `satisfies` / annotated
// declaration naming it, and one that inherits the interface from a base class
// that names it. This is a tripwire on the ways an adapter is actually written,
// not a proof that none exists. Comment detection is line-local, for the
// reasons `check-rp-bijection.mts` gives at length.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scanRoot = join(repoRoot, 'packages');

// Every file declaring a tier runtime, and nothing else. Empty because no
// adapter exists yet: the interface is declared (CS-12599) and the first
// implementation is still ahead. Each entry here should be a mode passed to
// `checkRecordParity` as registered.
const registered = new Set<string>([]);

// Directories with no source of ours in them, or with a copy of it that is not
// the one that ships.
const skipDirectories = new Set([
  'node_modules',
  'dist',
  'tmp',
  'coverage',
  '.git',
  'declarations',
]);

const SOURCE = /\.(ts|gts|mts)$/;

// `implements` may list more than one interface, so the match runs to the class
// body rather than to the next identifier. `satisfies` covers an object literal
// adapter, and the annotated-declaration form covers one built by a factory. A
// parameter or field annotation deliberately does not match: taking a
// `BoxelRuntime` is what a consumer does.
const DECLARES_RUNTIME = [
  /\bimplements\b[^{;]*\bBoxelRuntime\b/,
  /\bsatisfies\s+BoxelRuntime\b/,
  /\b(?:const|let|var)\s+\w+\s*:\s*BoxelRuntime\b/,
];

function* walk(dir: string): Generator<string> {
  for (let entry of readdirSync(dir)) {
    if (skipDirectories.has(entry)) {
      continue;
    }
    let full = join(dir, entry);
    let stat = statSync(full, { throwIfNoEntry: false });
    if (!stat) {
      continue;
    }
    if (stat.isDirectory()) {
      yield* walk(full);
    } else if (SOURCE.test(entry)) {
      yield full;
    }
  }
}

function withoutComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      let withoutSpans = line.replace(/\/\*.*?\*\//g, ' ');
      return /^\s*(\/\/|\*|\/\*|\{\{!)/.test(withoutSpans) ? '' : withoutSpans;
    })
    .join('\n');
}

let found: string[] = [];
for (let file of walk(scanRoot)) {
  let raw = readFileSync(file, 'utf8');
  // The name is what makes a file worth parsing at all, and most of the repo
  // does not carry it.
  if (!raw.includes('BoxelRuntime')) {
    continue;
  }
  let source = withoutComments(raw);
  if (DECLARES_RUNTIME.some((pattern) => pattern.test(source))) {
    found.push(relative(repoRoot, file));
  }
}
found.sort();

const unexpected = found.filter((file) => !registered.has(file));
const missing = [...registered].sort().filter((file) => !found.includes(file));

console.log(
  `execution tier adapters: ${found.length} — ${found.length === 0 ? 'none yet' : found.join(', ')}`,
);

if (unexpected.length > 0) {
  console.error(
    `\nThese files declare a BoxelRuntime the record-parity harness does not know about:\n` +
      unexpected.map((file) => `  ${file}`).join('\n') +
      `\n\nA tier the harness is not handed is a tier RP-14.4 does not hold to\n` +
      `anything. Pass its mode to checkRecordParity as a registered mode, and\n` +
      `record the file here in the same change.`,
  );
}
if (missing.length > 0) {
  console.error(
    `\nRecorded as a tier adapter but no longer declaring a BoxelRuntime:\n` +
      missing.map((file) => `  ${file}`).join('\n') +
      `\n\nA harness still expecting that mode reports it absent on every run.\n` +
      `Drop it from the registered modes and from this script together.`,
  );
}

process.exit(unexpected.length + missing.length > 0 ? 1 : 0);
