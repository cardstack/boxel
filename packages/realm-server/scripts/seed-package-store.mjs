#!/usr/bin/env node
/* eslint-env node */

// Seed a Deck object store with two MAJORS of one library.
//
// This exists to make the coexistence claim demonstrable rather than
// argued. Today a realm holds one version of a bare specifier: the import
// map is a flat prefix table with no notion of who is asking, so `palette`
// means one thing for the whole realm and a second version can only be had
// by copying the tree. Two immutable versions sitting at two addresses is
// the half of the fix that lives on the server; the resolver is the other
// half.
//
//   node scripts/seed-package-store.mjs <store-dir>
//
// The library is synthetic on purpose. A real vendored dependency would
// drag in a network fetch and a much larger diff, and would not make the
// point any better: what matters is that the two versions are byte-
// different, independently addressed, and both retrievable at once.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack, publishToStore, readStoreMeta } from '@cardstack/deck/node';

const NAME = 'lib/palette';

// Two majors whose observable behaviour differs, so a consumer that got the
// wrong one is obvious rather than subtly off.
const VERSIONS = {
  '1.0.0': `export const VERSION = '1.0.0';
export const NAME = 'palette';
// v1: three fixed colours, indexed from zero.
const COLORS = ['#e5484d', '#0090ff', '#30a46c'];
export function pick(n) {
  return COLORS[n % COLORS.length];
}
`,
  '2.0.0': `export const VERSION = '2.0.0';
export const NAME = 'palette';
// v2: BREAKING — pick() takes a name, not an index, and there are five.
const COLORS = {
  red: '#e5484d',
  blue: '#0090ff',
  green: '#30a46c',
  amber: '#ffb224',
  plum: '#ab4aba',
};
export function pick(name) {
  return COLORS[name] ?? null;
}
export function names() {
  return Object.keys(COLORS);
}
`,
};

function packFor(version, body) {
  return pack([
    {
      path: 'importmap.json',
      bytes: Buffer.from(
        JSON.stringify(
          {
            deck: {
              // Keyed by the PACKAGE segment, not the scoped name — identity
              // comes from where the deck sits, the map only says which
              // version it is.
              packages: { palette: { version, entry: '$DECK/index.js' } },
            },
          },
          null,
          2,
        ),
      ),
    },
    { path: 'index.js', bytes: Buffer.from(body) },
    {
      path: 'README.md',
      bytes: Buffer.from(`# palette ${version}\n\nFixture library.\n`),
    },
  ]);
}

let storeDir = process.argv[2];
if (!storeDir) {
  console.error('usage: seed-package-store.mjs <store-dir>');
  process.exit(1);
}

let scratch = await mkdtemp(join(tmpdir(), 'seed-palette-'));
try {
  for (let [version, body] of Object.entries(VERSIONS)) {
    let record = await publishToStore(
      storeDir,
      NAME,
      version,
      packFor(version, body),
    );
    console.log(`published ${NAME}@${version}  treeHash ${record.treeHash}`);
  }
  let meta = await readStoreMeta(storeDir, NAME);
  console.log(
    `store now holds ${NAME}: ${Object.keys(meta?.versions ?? {}).join(', ')}`,
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
