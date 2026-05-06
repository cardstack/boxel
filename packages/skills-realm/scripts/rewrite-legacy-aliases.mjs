#!/usr/bin/env node
// Temporary shim for CS-10992: boxel-skills cards reference some host
// commands by their old URL-flavored module paths. This script rewrites
// the cloned `contents/` tree in place so the renamed commands resolve
// when skills are loaded.
//
// Runs after `skills:setup` / `skills:update` / `skills:reset`. Once the
// boxel-skills PR landing the new paths is merged, delete this file
// and remove its invocation from package.json. Tracked by CS-11046.

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const ALIASES = [
  [
    '@cardstack/boxel-host/commands/get-realm-of-url',
    '@cardstack/boxel-host/commands/get-realm-of-resource-identifier',
  ],
  [
    '@cardstack/boxel-host/commands/get-available-realm-urls',
    '@cardstack/boxel-host/commands/get-available-realm-identifiers',
  ],
  [
    '@cardstack/boxel-host/commands/get-catalog-realm-urls',
    '@cardstack/boxel-host/commands/get-catalog-realm-identifiers',
  ],
  [
    '@cardstack/boxel-host/commands/invalidate-realm-urls',
    '@cardstack/boxel-host/commands/invalidate-realm-identifiers',
  ],
];

const ROOT = new URL('../contents', import.meta.url).pathname;

if (!existsSync(ROOT)) {
  console.log(`[rewrite-legacy-aliases] ${ROOT} not found, skipping.`);
  process.exit(0);
}

async function* walkJson(dir) {
  for (let entry of await readdir(dir)) {
    if (entry === '.git') continue;
    let full = join(dir, entry);
    let s = await stat(full);
    if (s.isDirectory()) {
      yield* walkJson(full);
    } else if (s.isFile() && entry.endsWith('.json')) {
      yield full;
    }
  }
}

let rewritten = 0;
for await (let path of walkJson(ROOT)) {
  let original = await readFile(path, 'utf8');
  let updated = original;
  for (let [from, to] of ALIASES) {
    updated = updated.split(from).join(to);
  }
  if (updated !== original) {
    await writeFile(path, updated);
    rewritten += 1;
    console.log(`  rewrote ${path}`);
  }
}

console.log(
  `[rewrite-legacy-aliases] updated ${rewritten} file${rewritten === 1 ? '' : 's'}.`,
);
