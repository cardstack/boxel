#!/usr/bin/env node
// Rewrites `ts-node --transpileOnly <entry>` invocations to `node <entry>.ts`
// in package.json scripts, shell scripts, and mise-tasks. Native Node runs the
// TypeScript entry directly (type-stripping is stable in Node >=23.6); the
// extensionless entry must gain a `.ts` suffix because Node does no extension
// search for the CLI entry point.
//
//   ts-node --transpileOnly main                -> node main.ts
//   ts-node --transpileOnly prerender/server    -> node prerender/server.ts
//   ts-node --transpileOnly scripts/foo.ts      -> node scripts/foo.ts
//   NODE_NO_WARNINGS=1 ts-node --transpileOnly x -> NODE_NO_WARNINGS=1 node x.ts
//
// Leaves alone (reported, fix by hand):
//   - qunit --require ts-node/register/transpile-only ...   (needs a node bootstrap)
//   - ts-node ... -e / --eval ...                           (inline code, no type-strip)
//
// Usage: node ts-node-to-node.mjs <file>...   (edits in place)
import { readFileSync, writeFileSync } from 'node:fs';

const KNOWN_EXT = /\.(ts|mts|cts|js|mjs|cjs)$/;

// `ts-node --transpileOnly <entry>` (entry = next non-flag token). The
// separator class allows shell line-continuations (`\` + newline + indent),
// so multi-line `exec ts-node \\\n  --transpileOnly main \\` forms convert too.
const INVOCATION = /\bts-node[\s\\]+--transpileOnly[\s\\]+([^\s"'\\]+)/g;

export function transform(src) {
  const skipped = [];
  let changed = false;
  let code = src.replace(INVOCATION, (full, entry) => {
    if (entry.startsWith('-')) {
      skipped.push(full.trim());
      return full; // inline -e / --eval etc.
    }
    changed = true;
    const withExt = KNOWN_EXT.test(entry) ? entry : `${entry}.ts`;
    return `node ${withExt}`;
  });
  // `qunit --require ts-node/register/transpile-only` needs a hand-written
  // bootstrap; flag it rather than silently breaking it.
  if (/ts-node\/register\/transpile-only/.test(code)) {
    skipped.push('qunit --require ts-node/register/transpile-only');
  }
  return { code, changed, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let count = 0;
  const allSkipped = [];
  for (const file of process.argv.slice(2)) {
    const { code, changed, skipped } = transform(readFileSync(file, 'utf8'));
    if (changed) {
      writeFileSync(file, code);
      count++;
    }
    for (const s of skipped) allSkipped.push(`${file}: ${s}`);
  }
  console.log(`ts-node-to-node: ${count} file(s) changed`);
  if (allSkipped.length) {
    console.log(`\nSKIPPED — fix by hand (${allSkipped.length}):`);
    for (const s of allSkipped) console.log('  ' + s);
  }
}
