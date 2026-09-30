// Enforces the two rules `BUNDLED_BASE_MODULES` rests on. Both describe what
// the loader is asked for, which nothing else in the build can see: the bundler
// resolves a bundled module's imports inside its chunk, so the loader is never
// asked for them and never learns they exist.
//
// Neither rule fails loudly when broken. A closure break leaves two copies of a
// class, which disagree only where something compares them. An attribution
// break leaves a class the loader does not name, and a code ref for it then
// names the field it is held as instead of the module that declares it — which
// still resolves, so only a caller that reads the ref as data is wrong.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hostDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseDir = join(hostDir, '..', 'base');
const tablePath = join(hostDir, 'app', 'lib', 'bundled-base.ts');
const SKIP_DIRS = new Set(['node_modules', 'scripts', 'types', 'tests']);

// Base modules a card author imports by identifier. The loader is asked for
// these, so the classes they declare are named however they are reached.
//
// This is a claim about the public surface, not something the repo can prove: a
// card in any realm may import any base module, and nothing here sees those
// realms. Widen it deliberately — an entry added to quiet this check asserts
// that card code names the module, and is wrong if it does not.
//
// It holds only for a loader some card has already made import the module, so
// it is the weakest of the exemptions and the last one to reach for. A
// superclass does not need it at all: that case is decided by what the
// subclass is, not by who imports the parent. See `isFieldClass`.
const NAMED_BY_CARD_CODE = new Set(['card-api', 'skill']);

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

  let exceptionsBlock = src.slice(src.indexOf('FETCHED_RE_EXPORTS'));
  exceptionsBlock = exceptionsBlock.slice(0, exceptionsBlock.indexOf(']'));
  let exceptions = new Set(
    [...exceptionsBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]),
  );
  return { table: new Set(names), exceptions };
}

// `import { A, B as C } from './x'` and `import D from './x'`, mapping each
// local name to the base module it came from. Type-only imports are erased
// before runtime, so they cannot make a class reachable and are skipped.
const IMPORT_STATEMENT =
  /(?:^|\n)\s*import\s+(?!type\s)([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g;
const RUNTIME_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[^;'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g;
// A class held as a link. `linksTo(() => Foo)` defers the reference; both
// spellings name the same class.
//
// Only links. A contained value is built from the field that holds it, so the
// field itself names the class, and the value deserializes, renders and round
// trips whatever the loader knows. A link's type is read as data instead: it is
// the filter a chooser searches by, so a ref that names the holding field
// rather than the declaring module asks for the wrong type.
const FIELD_USE =
  /\b(?:linksTo|linksToMany)\s*\(\s*(?:\(\)\s*=>\s*)?([A-Za-z_$][\w$]*)/g;

// `identifyCard(Foo)` asks for a class's code ref by name, which is the same
// question a link's type asks and has the same answer: the module the loader
// was asked for. A bundled module calling it on a class another bundled module
// declares gets undefined, since the import between them never reaches the
// loader. Reading a class's own identity — `identifyCard(this.card)`,
// `identifyCard(model.constructor)` — asks about a value, not an import, so
// only a bare imported name counts here.
const IDENTIFY_USE = /\bidentifyCard\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;

// `class X extends Y`. An adoption-chain walk asks each level of the prototype
// chain for its code ref and stops at the first it cannot name, so a class is
// only as reachable as its least-named ancestor. Serving the subclass does not
// help: the loader is asked for the module a value adopts from, and that
// module's own import of its superclass is resolved inside the chunk. A
// fetched module never has this problem, because evaluating it loads what it
// extends first — which is exactly what bundling removes.
const EXTENDS_USE =
  /\bclass\s+([A-Za-z_$][\w$]*)\s+extends\s+([A-Za-z_$][\w$]*)/g;

// A name a module exports whose binding another base module declares. The
// loader credits the first module it serves with every name that module
// exposes, so a module that passes a class through takes the credit from the
// module that declares it, and every code ref for that class then names a
// module that does not declare it.
//
// Four shapes reach that: `export { X } from './y'`, `export * from './y'`,
// and — where `X` was imported from a base module — `export default X` and
// `export { X }`. Testing whether a module is *entirely* re-exports would miss
// the last two and any module that declares classes of its own beside one it
// passes through; the loader credits every name a served module exposes, so
// one is enough.
const EXPORT_FROM =
  /\bexport\s*(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{([^}]*)\})\s*from\s*['"]([^'"]+)['"]/g;
const EXPORT_DEFAULT_NAME = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;/g;
const EXPORT_LOCAL_LIST = /\bexport\s*\{([^}]*)\}\s*(?!\s*from)[;\n]/g;

// Only a card or file def matters here. Its code ref is read as a type — the
// filter a chooser searches by, and a level of every subclass's adoption chain
// — so naming the wrong module for one is a wrong answer someone acts on. A
// function's ref is read by nothing, and a contained field's is supplied by
// the field that holds it, so passing either through costs nothing. That is
// decided from base's own class graph rather than from a list, so no module
// has to be vouched for by hand.

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

// Every base module's classes as `module#class -> what it extends`. Built over
// all of base, not only the table: a chain can pass through a module that is
// not bundled.
function classIndex() {
  let index = new Map();
  let defaultAliases = new Map();
  for (let name of baseModules()) {
    let file = fileFor(name);
    if (!file) {
      continue;
    }
    let code = withoutComments(readFileSync(file, 'utf8'));
    let origin = importOrigins(code, file);
    let defaultExport = code.match(
      /\bexport\s+default\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    );
    if (defaultExport) {
      defaultAliases.set(`${name}#default`, `${name}#${defaultExport[1]}`);
    }
    for (let match of code.matchAll(EXTENDS_USE)) {
      let from = origin.get(match[2]);
      index.set(`${name}#${match[1]}`, {
        parent: from ? from.name : match[2],
        module: from ? from.module : name,
      });
    }
  }
  for (let [alias, real] of defaultAliases) {
    let entry = index.get(real);
    if (entry) {
      index.set(alias, entry);
    }
  }
  return index;
}

// Whether a class is a FieldDef. Plenty of things walk a field's ancestry —
// code mode does, through `CardTypeService.toType` and
// `CodeSemanticsService` — but those go through `getAncestor`, which registers
// an `ancestorOf` local identity as it climbs, so the level above a bundled
// field answers with a ref relative to it rather than with undefined.
//
// The walks that truncate are the ones that climb with a raw prototype hop and
// stop at the first level `identifyCard` cannot name: `routes/render/meta.ts`,
// the file-def extractor, and the definition indexing in `routes/module.ts`.
// All three start from a card or a file def. So only a card or file def has to
// answer for its chain, and a field's unnamed ancestor is never reached by
// anything that would truncate on it.
//
// An unresolvable chain answers false, so the rule fires rather than goes
// quiet on something it could not read.
// Whether a class is a CardDef or FileDef. Only those have a code ref read as
// a type, so only those are worth refusing a pass-through over. A Glimmer
// component or a plain class reaches neither root and answers false.
function isCardOrFileClass(index, moduleName, className) {
  let key = `${moduleName}#${className}`;
  let seen = new Set();
  while (!seen.has(key)) {
    seen.add(key);
    let entry = index.get(key);
    if (!entry) {
      return false;
    }
    if (entry.parent === 'CardDef' || entry.parent === 'FileDef') {
      return true;
    }
    if (entry.parent === 'FieldDef') {
      return false;
    }
    key = `${entry.module}#${entry.parent}`;
  }
  return false;
}

function isFieldClass(index, moduleName, className) {
  let key = `${moduleName}#${className}`;
  let seen = new Set();
  while (!seen.has(key)) {
    seen.add(key);
    let entry = index.get(key);
    if (!entry) {
      return false;
    }
    if (entry.parent === 'FieldDef') {
      return true;
    }
    if (entry.parent === 'CardDef' || entry.parent === 'FileDef') {
      return false;
    }
    key = `${entry.module}#${entry.parent}`;
  }
  return false;
}

function main() {
  let { table, exceptions } = readTable();
  let closureViolations = [];
  let identityHazards = [];
  let passThroughs = [];
  let classes = classIndex();

  for (let name of table) {
    let file = fileFor(name);
    if (!file) {
      closureViolations.push(`${name} — no source file in packages/base`);
      continue;
    }
    let code = withoutComments(readFileSync(file, 'utf8'));

    for (let match of code.matchAll(RUNTIME_IMPORT)) {
      let target = baseTargetOf(match[1], file);
      if (!target || table.has(target) || exceptions.has(target)) {
        continue;
      }
      closureViolations.push(`${name} imports ${target}`);
    }

    let origin = importOrigins(code, file);

    let borrowed = [];
    for (let match of code.matchAll(EXPORT_FROM)) {
      let target = baseTargetOf(match[2], file);
      if (!target || target === name) {
        continue;
      }
      if (match[1] === undefined) {
        // `export * from './y'` names nothing, so every class `./y` declares
        // is passed through.
        for (let key of classes.keys()) {
          let [from, declared] = key.split('#');
          if (from === target) {
            borrowed.push([declared, target]);
          }
        }
        continue;
      }
      for (let piece of match[1].split(',')) {
        let local = piece.trim().split(/\s+as\s+/)[0];
        if (local && !local.startsWith('type ')) {
          borrowed.push([local, target]);
        }
      }
    }
    for (let re of [EXPORT_DEFAULT_NAME, EXPORT_LOCAL_LIST]) {
      for (let match of code.matchAll(re)) {
        let names =
          re === EXPORT_DEFAULT_NAME ? [match[1]] : match[1].split(',');
        for (let piece of names) {
          let local = piece.trim().split(/\s+as\s+/)[0];
          if (!local || local.startsWith('type ')) {
            continue;
          }
          let from = origin.get(local);
          if (from && from.module !== name) {
            borrowed.push([from.name, from.module]);
          }
        }
      }
    }
    for (let [declared, from] of borrowed) {
      if (!classes.has(`${from}#${declared}`)) {
        continue;
      }
      if (!isCardOrFileClass(classes, from, declared)) {
        continue;
      }
      passThroughs.push(`${name} passes through ${declared} from ${from}`);
    }

    let uses = [
      ...[...code.matchAll(FIELD_USE)].map((m) => ({ referenced: m[1] })),
      ...[...code.matchAll(IDENTIFY_USE)].map((m) => ({ referenced: m[1] })),
      ...[...code.matchAll(EXTENDS_USE)].map((m) => ({
        referenced: m[2],
        subclass: m[1],
      })),
    ];
    for (let use of uses) {
      let declaredIn = origin.get(use.referenced)?.module;
      if (
        !declaredIn ||
        declaredIn === name ||
        !table.has(declaredIn) ||
        NAMED_BY_CARD_CODE.has(declaredIn)
      ) {
        continue;
      }
      if (use.subclass && isFieldClass(classes, name, use.subclass)) {
        continue;
      }
      identityHazards.push(
        `${name} names ${use.referenced} from ${declaredIn}`,
      );
    }
  }

  let closure = [...new Set(closureViolations)].sort();
  let identity = [...new Set(identityHazards)].sort();
  let passThrough = [...new Set(passThroughs)].sort();

  if (
    closure.length === 0 &&
    identity.length === 0 &&
    passThrough.length === 0
  ) {
    console.log(
      `ok: ${table.size} bundled base modules are closed under imports, ` +
        `and name no class the loader is never asked for`,
    );
    return;
  }

  if (closure.length > 0) {
    console.error(
      `\n${closure.length} bundled module(s) import a base module outside the table.\n` +
        `The bundler compiles it into the chunk anyway, and the realm still serves ` +
        `it, so card code importing it by identifier gets a second copy whose ` +
        `classes do not match.\n` +
        `Add it to the table, or — if its whole content is a re-export — to ` +
        `FETCHED_RE_EXPORTS.\n`,
    );
    for (let line of closure) {
      console.error(`  ${line}`);
    }
  }

  if (identity.length > 0) {
    console.error(
      `\n${identity.length} bundled module(s) name a class another bundled ` +
        `module declares.\n` +
        `A class is named only when the loader is asked for the module ` +
        `declaring it, and one bundled module asking for another is resolved ` +
        `inside the chunk. A link's type, an identifyCard call and a ` +
        `superclass all read that name as data — a chooser filters on it, and ` +
        `an adoption-chain walk stops at the first level it cannot name, ` +
        `truncating the types a file or card is indexed under.\n` +
        `Leave the holder out of the table — a fetched holder imports the ` +
        `declarer through the loader, which is what names it — or, if card ` +
        `code names the declarer by identifier, add it to NAMED_BY_CARD_CODE ` +
        `in this script.\n`,
    );
    for (let line of identity) {
      console.error(`  ${line}`);
    }
  }

  if (passThrough.length > 0) {
    console.error(
      `\n${passThrough.length} bundled module(s) export a name another base ` +
        `module declares.\n` +
        `A class is credited to the first module the loader serves that ` +
        `exposes it, so passing one through takes the credit from the module ` +
        `that declares it, and every code ref for that class then names a ` +
        `module that does not.\n` +
        `Leave it out of the table: fetched, it asks the loader for what it ` +
        `re-exports from, so the declarer is served first.\n`,
    );
    for (let line of passThrough) {
      console.error(`  ${line}`);
    }
  }

  console.error('');
  process.exit(1);
}

main();
