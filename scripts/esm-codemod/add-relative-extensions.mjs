#!/usr/bin/env node
// Adds explicit extensions to relative imports/exports so native Node ESM can
// resolve them (Node does NOT do extension search or directory-index resolution).
//
//   import x from './foo'        -> './foo.ts'        (foo.ts exists)
//   import x from './foo'        -> './foo.gts'       (foo.gts exists)
//   import x from './foo'        -> './foo/index.ts'  (foo/ is a dir with index)
//   import x from '.'            -> './index.ts'
//   export * from './bar'        -> './bar.ts'
//
// Leaves alone: specifiers that already have a known extension, bare/package
// specifiers, and relative specifiers that resolve to nothing (reported).
//
// Usage: node add-relative-extensions.mjs <file>...   (edits in place)
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const KNOWN_EXT =
  /\.(ts|tsx|mts|cts|gts|js|mjs|cjs|gjs|json|css|wasm|node|d\.ts)$/;
// Resolution order matters: prefer source over compiled, ts over gts.
const FILE_EXTS = ['.ts', '.gts', '.tsx', '.js', '.mjs', '.cjs', '.gjs'];
const INDEX_EXTS = FILE_EXTS;

// Matches the specifier in import/export ... from '...' and bare import '...'.
const FROM =
  /(\bfrom\s*|\bimport\s*|\bexport\s*\*\s*from\s*)(['"])(\.[^'"]*)\2/g;

function resolveSpecifier(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  // Already a file with an extension we trust.
  if (KNOWN_EXT.test(spec)) return null;
  // Direct file match by appending an extension.
  for (const ext of FILE_EXTS) {
    if (existsSync(base + ext)) return spec + ext;
  }
  // Directory index.
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const ext of INDEX_EXTS) {
      if (existsSync(resolve(base, 'index' + ext))) {
        return (spec.endsWith('/') ? spec.slice(0, -1) : spec) + '/index' + ext;
      }
    }
  }
  return undefined; // unresolved
}

export function transform(fromFile, src) {
  const unresolved = [];
  let changed = false;
  const code = src.replace(FROM, (full, kw, q, spec) => {
    const out = resolveSpecifier(fromFile, spec);
    if (out === null) return full; // already extensioned
    if (out === undefined) {
      unresolved.push(spec);
      return full;
    }
    changed = true;
    return `${kw}${q}${out}${q}`;
  });
  return { code, changed, unresolved };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let count = 0;
  const allUnresolved = [];
  for (const file of process.argv.slice(2)) {
    const { code, changed, unresolved } = transform(
      file,
      readFileSync(file, 'utf8'),
    );
    if (changed) {
      writeFileSync(file, code);
      count++;
    }
    for (const u of unresolved) allUnresolved.push(`${file}: ${u}`);
  }
  console.log(`relative-extensions: ${count} file(s) changed`);
  if (allUnresolved.length) {
    console.log(`\nUNRESOLVED (${allUnresolved.length}):`);
    for (const u of allUnresolved) console.log('  ' + u);
  }
}
