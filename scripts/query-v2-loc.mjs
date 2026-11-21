#!/usr/bin/env node
// Added lines of the Query V2 stack by kind, against the merge base with
// main: code, tests, generated data, docs. Usage:
//   node scripts/query-v2-loc.mjs [base-ref] [head-ref]
import { execFileSync } from 'node:child_process';

let [base = 'origin/main', head = 'HEAD'] = process.argv.slice(2);
let mergeBase = execFileSync('git', ['merge-base', base, head], {
  encoding: 'utf8',
}).trim();
let numstat = execFileSync('git', ['diff', '--numstat', mergeBase, head], {
  encoding: 'utf8',
  maxBuffer: 1 << 28,
});

function kindOf(path) {
  if (/(^|\/)tests?\/|[-.]test\.(ts|gts|js|mjs)$/.test(path)) return 'tests';
  if (
    path.startsWith('packages/query-verification/') &&
    /\.(json|jsonl)$/.test(path)
  ) {
    return 'generated';
  }
  if (path.endsWith('.lean')) return 'lean';
  if (path.endsWith('.md')) return 'docs';
  if (/\.(json|jsonl|yaml|yml|lock)$/.test(path)) return 'config';
  return 'code';
}

let added = {};
let removed = {};
for (let line of numstat.split('\n')) {
  if (!line) continue;
  let [a, d, path] = line.split('\t');
  if (a === '-') continue;
  let kind = kindOf(path);
  added[kind] = (added[kind] ?? 0) + Number(a);
  removed[kind] = (removed[kind] ?? 0) + Number(d);
}
let total = 0;
for (let kind of Object.keys(added).sort((x, y) => added[y] - added[x])) {
  total += added[kind];
  console.log(
    `${kind.padEnd(10)} +${String(added[kind]).padStart(7)} -${String(removed[kind]).padStart(6)}`,
  );
}
console.log(`${'total'.padEnd(10)} +${String(total).padStart(7)}`);
