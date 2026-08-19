#!/usr/bin/env node
// Rewrites lodash imports to lodash-es (native ESM, named exports).
//
//   import merge from 'lodash/merge'         -> import { merge } from 'lodash-es'
//   import merge from 'lodash/merge.js'      -> import { merge } from 'lodash-es'
//   import foo   from 'lodash/merge'         -> import { merge as foo } from 'lodash-es'
//   import { a, b } from 'lodash'            -> import { a, b } from 'lodash-es'
//   import * as _ from 'lodash'              -> import * as _ from 'lodash-es'
//
// Usage: node lodash-to-lodash-es.mjs <file>...   (edits in place)
import { readFileSync, writeFileSync } from 'node:fs';

const SUBPATH =
  /^(\s*)import\s+(\w+)\s+from\s+['"]lodash\/([\w]+)(?:\.js)?['"];?\s*$/;
const BARE = /from\s+(['"])lodash\1/g;

export function transform(src) {
  let changed = false;
  const lines = src.split('\n').map((line) => {
    const m = line.match(SUBPATH);
    if (m) {
      const [, indent, binding, method] = m;
      const spec = binding === method ? method : `${method} as ${binding}`;
      changed = true;
      return `${indent}import { ${spec} } from 'lodash-es';`;
    }
    if (BARE.test(line)) {
      changed = true;
      return line.replace(BARE, 'from $1lodash-es$1');
    }
    return line;
  });
  return { code: lines.join('\n'), changed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let count = 0;
  for (const file of process.argv.slice(2)) {
    const { code, changed } = transform(readFileSync(file, 'utf8'));
    if (changed) {
      writeFileSync(file, code);
      count++;
      console.log(`rewrote ${file}`);
    }
  }
  console.log(`lodash-es: ${count} file(s) changed`);
}
