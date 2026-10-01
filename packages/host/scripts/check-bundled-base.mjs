// Enforces the one rule `BUNDLED_BASE_MODULES` rests on: the set is closed
// under imports. Nothing else in the build can see this, because the bundler
// resolves a bundled module's imports inside its chunk and the loader is never
// asked for them.
//
// It does not fail loudly when broken. A module reachable from a bundled one
// but missing from the table is compiled into that chunk AND served by the
// realm, leaving two copies of each class it declares, which disagree only
// where something compares them.
//
// Attribution used to need rules here too — which module a class's code ref
// names depended on what the loader happened to be asked for first. It does
// not any more: a bundled module publishes the classes it declares as it is
// evaluated, and the loader reads that before its own record, so a class is
// named by its declarer whatever the serving order.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hostDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseDir = join(hostDir, '..', 'base');
const tablePath = join(hostDir, 'app', 'lib', 'bundled-base.ts');
const SKIP_DIRS = new Set(['node_modules', 'scripts', 'types', 'tests']);

// Read source with comments blanked, so prose that looks like a specifier is
// not taken for one. A comment is not a regular language — `/*` appears inside
// line comments here, and `//` inside strings — so this walks rather than
// matches, holding which of code, comment or string each character is in.
function withoutComments(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    let c = code[i];
    let next = code[i + 1];
    if (c === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      let close = code.indexOf('*/', i + 2);
      let stop = close === -1 ? code.length : close + 2;
      for (; i < stop; i++) {
        out += code[i] === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let quote = c;
      out += c;
      i++;
      while (i < code.length) {
        if (code[i] === '\\') {
          out += code.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += code[i];
        if (code[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function baseModules() {
  let found = [];
  let walk = (dir) => {
    for (let entry of readdirSync(dir, { withFileTypes: true })) {
      let full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(full);
        }
        continue;
      }
      if (!/\.(gts|ts)$/.test(entry.name) || entry.name.endsWith('.d.ts')) {
        continue;
      }
      found.push(relative(baseDir, full).replace(/\.(gts|ts)$/, ''));
    }
  };
  walk(baseDir);
  return found.sort();
}

function fileFor(name) {
  for (let ext of ['.gts', '.ts', '/index.gts', '/index.ts']) {
    let candidate = join(baseDir, name + ext);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

// A specifier naming another base module, or undefined for anything else.
function baseTargetOf(specifier, fromFile) {
  let target;
  if (specifier.startsWith('.')) {
    let absolute = resolve(dirname(fromFile), specifier);
    if (!absolute.startsWith(baseDir)) {
      return undefined;
    }
    target = relative(baseDir, absolute);
  } else if (specifier.startsWith('@cardstack/base/')) {
    target = specifier.slice('@cardstack/base/'.length);
  } else if (specifier.startsWith('https://cardstack.com/base/')) {
    target = specifier.slice('https://cardstack.com/base/'.length);
  } else {
    return undefined;
  }
  if (/\.css$/.test(target)) {
    return undefined;
  }
  return target.replace(/\.(gts|ts)$/, '');
}

function readTable() {
  let src = readFileSync(tablePath, 'utf8');
  let start = src.indexOf('export const BUNDLED_BASE_MODULES');
  let body = src.slice(src.indexOf('> = {', start) + 5);
  body = body.slice(0, body.indexOf('\n};'));
  let names = [
    ...body.matchAll(/^ {2}(?:'([^']+)'|([A-Za-z_$][\w$-]*)): \(\) =>/gm),
  ].map((m) => m[1] ?? m[2]);

  return new Set(names);
}

// `import { A, B as C } from './x'` and `import D from './x'`, mapping each
// local name to the base module it came from. Type-only imports are erased
// before runtime, so they cannot make a class reachable and are skipped.
const IMPORT_STATEMENT =
  /(?:^|\n)\s*import\s+(?!type\s)([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g;
const RUNTIME_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[^;'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g;

// Which base module each imported name comes from, keyed by the local name and
// carrying the name the declaring module exports it under — `import { X as Y }`
// is looked up in the declarer as X, not Y.
function importOrigins(code, file) {
  let origin = new Map();
  for (let match of code.matchAll(IMPORT_STATEMENT)) {
    let target = baseTargetOf(match[2], file);
    if (!target) {
      continue;
    }
    let named = match[1].match(/\{([\s\S]*?)\}/);
    if (named) {
      for (let piece of named[1].split(',')) {
        let local = piece.trim();
        if (!local || local.startsWith('type ')) {
          continue;
        }
        let [exported, alias] = local.includes(' as ')
          ? local.split(' as ').map((part) => part.trim())
          : [local, local];
        origin.set(alias, { module: target, name: exported });
      }
    }
    let defaultImport = match[1]
      .replace(/\{[\s\S]*?\}/, '')
      .replace(/^\s*,|,\s*$/g, '')
      .trim();
    for (let piece of defaultImport.split(',')) {
      let local = piece.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(local)) {
        // A default import is exposed under whatever name the importer chose;
        // the declaring module's own name for it is `default`.
        origin.set(local, { module: target, name: 'default' });
      }
    }
  }
  return origin;
}

function main() {
  let table = readTable();
  let closureViolations = [];

  for (let name of table) {
    let file = fileFor(name);
    if (!file) {
      closureViolations.push(`${name} — no source file in packages/base`);
      continue;
    }
    let code = withoutComments(readFileSync(file, 'utf8'));

    for (let match of code.matchAll(RUNTIME_IMPORT)) {
      let target = baseTargetOf(match[1], file);
      if (!target || table.has(target)) {
        continue;
      }
      closureViolations.push(`${name} imports ${target}`);
    }
  }

  let closure = [...new Set(closureViolations)].sort();

  if (closure.length === 0) {
    console.log(
      `ok: ${table.size} bundled base modules are closed under imports`,
    );
    return;
  }

  if (closure.length > 0) {
    console.error(
      `\n${closure.length} bundled module(s) import a base module outside the table.\n` +
        `The bundler compiles it into the chunk anyway, and the realm still serves ` +
        `it, so card code importing it by identifier gets a second copy whose ` +
        `classes do not match.\n` +
        `Add it to the table.\n`,
    );
    for (let line of closure) {
      console.error(`  ${line}`);
    }
  }

  console.error('');
  process.exit(1);
}

main();
