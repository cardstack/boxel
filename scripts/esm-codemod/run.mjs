#!/usr/bin/env node
// Orchestrates the CS-11449 ts-node -> native-Node ESM codemod across the
// node-run package cluster. Idempotent: safe to re-run. Pass --dry to preview.
//
//   node scripts/esm-codemod/run.mjs [--dry]
//
// What it does (see ./README.md for the full error taxonomy):
//   1. Source rewrites over cluster .ts files:
//        - add explicit extensions to relative imports        (add-relative-extensions)
//        - lodash/X            -> named import from lodash-es  (lodash-to-lodash-es)
//        - named CJS imports   -> default + destructure        (cjs-named-to-default)
//        - __dirname/__filename-> import.meta.dirname/filename (dirname-to-import-meta)
//   2. Invocation rewrites over package.json / *.sh / mise-tasks:
//        - ts-node --transpileOnly <entry> -> node <entry>.ts  (ts-node-to-node)
//
// NOT automated (do by hand — see README): per-package `exports` maps + `type`,
// `import.meta.url`-as-path bugs, the qunit test-runner bootstrap, removing the
// `ts-node` devDependency, and in-source `spawn('ts-node', ...)` sites.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform as addExt } from './add-relative-extensions.mjs';
import { transform as lodashEs } from './lodash-to-lodash-es.mjs';
import { transform as cjsNamed } from './cjs-named-to-default.mjs';
import { transform as dirname } from './dirname-to-import-meta.mjs';
import { transform as tsNode } from './ts-node-to-node.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const DRY = process.argv.includes('--dry');

// The node-run cluster: packages Node executes directly (not bundled by Vite).
const CLUSTER = [
  'packages/runtime-common',
  'packages/postgres',
  'packages/billing',
  'packages/realm-server',
  'packages/realm-test-harness',
  'packages/ai-bot',
  'packages/bot-runner',
  'packages/matrix',
  'packages/software-factory',
];

function walk(dir, test, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git')
      continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (test(p)) out.push(p);
  }
  return out;
}

function applySource(file, fns) {
  let src = readFileSync(file, 'utf8');
  let changed = false;
  for (const fn of fns) {
    const r = fn === addExt ? fn(file, src) : fn(src);
    if (r.changed) {
      src = r.code;
      changed = true;
    }
  }
  if (changed && !DRY) writeFileSync(file, src);
  return changed;
}

let srcChanged = 0;
for (const pkg of CLUSTER) {
  const files = walk(join(REPO, pkg), (p) => /\.(ts|mts)$/.test(p));
  for (const f of files) {
    if (applySource(f, [addExt, lodashEs, cjsNamed, dirname])) srcChanged++;
  }
}
console.log(`source rewrites: ${srcChanged} file(s)${DRY ? ' (dry)' : ''}`);

let invChanged = 0;
const invFiles = [
  ...CLUSTER.map((p) => join(REPO, p, 'package.json')),
  ...walk(join(REPO, 'mise-tasks'), () => true),
  ...CLUSTER.flatMap((p) => walk(join(REPO, p), (f) => f.endsWith('.sh'))),
];
for (const f of invFiles) {
  let src;
  try {
    src = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  const r = tsNode(src);
  if (r.changed) {
    if (!DRY) writeFileSync(f, r.code);
    invChanged++;
  }
  if (r.skipped?.length) {
    for (const s of r.skipped) console.log(`  SKIP ${f}: ${s}`);
  }
}
console.log(`invocation rewrites: ${invChanged} file(s)${DRY ? ' (dry)' : ''}`);
