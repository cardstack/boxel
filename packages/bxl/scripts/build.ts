#!/usr/bin/env node
/**
 * Build the artifact published to npm as `@cardstack/bxl`.
 *
 * In-repo consumers read `src/` directly: the host's bundler compiles the
 * TypeScript, and this package's own suites are run by Node, which strips the
 * types as it loads them. Neither holds for an installed package — it lands
 * inside `node_modules`, where Node refuses to strip types
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). So the tarball has to carry
 * JavaScript.
 *
 * This script emits that JavaScript plus declarations into `dist/`.
 * `publishConfig.exports` points the published package at `dist/`; the
 * ordinary `exports` map still points at `src/`, so local development is
 * unaffected by anything here.
 *
 * The steps, and what each one is for:
 *
 *   1. Compile `src/` under `tsconfig.build.json`.
 *      `rewriteRelativeImportExtensions` turns `./x.ts` specifiers into
 *      `./x.js` in the emitted JavaScript, dynamic imports included — that
 *      covers the lazy formula chunks.
 *   2. Rewrite the same specifiers in the emitted declarations. TypeScript's
 *      rewrite applies to JavaScript emit only, so declarations keep the `.ts`
 *      specifiers they were written with — naming files that exist in `src/`
 *      but not beside the `.js` in `dist/`. TypeScript itself copes (it
 *      substitutes the sibling `.d.ts` for a `.ts` specifier), so this is
 *      about the declarations describing the tree that actually shipped, for
 *      every consumer that reads them without that substitution.
 *   3. Blank the `/// <reference path="…/types/*.d.ts" />` lines. Those
 *      ambient-module shims exist to carry declarations for the untyped
 *      `bessel` / `jstat` / `validator` packages into whatever project
 *      type-checks the sources; the compiler copies the comment into the
 *      emitted JavaScript, where the relative path resolves to nothing.
 *      Blanked rather than deleted so source-map line numbering still lines
 *      up with the emitted files.
 *   4. Copy the non-TypeScript assets the exports map serves — the TextMate
 *      grammar — which the compiler has no reason to emit.
 *   5. Check the published surface: the published exports map is what deriving
 *      it from the development one gives, every target it names exists, `files`
 *      ships what those targets and the source maps need, and nothing in
 *      `dist/` still imports a `.ts` file.
 *
 * Run via `pnpm --filter @cardstack/bxl build`. `prepack` runs it too, so a
 * `pnpm pack` or `pnpm publish` cannot ship a stale or missing `dist/`.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const SRC_DIR = join(PACKAGE_ROOT, 'src');
const DIST_DIR = join(PACKAGE_ROOT, 'dist');
const CONFIG_PATH = join(PACKAGE_ROOT, 'tsconfig.build.json');

// A relative specifier naming a TypeScript file, as written in source and
// preserved verbatim by declaration emit.
const RELATIVE_TS_SPECIFIER = /^(\.\.?\/.*)\.([mc]?)ts$/;

// A specifier naming a declaration file. Declarations are compiler inputs, not
// emitted beside the JavaScript, so there is no `.js` counterpart to redirect
// to — rewriting one would just name a different file that doesn't exist.
// Left alone so step 5 reports it instead.
const DECLARATION_SPECIFIER = /\.d\.[mc]?ts$/;

const DIAGNOSTIC_HOST: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (f) => f,
  getCurrentDirectory: () => PACKAGE_ROOT,
  getNewLine: () => '\n',
};

interface PackageJson {
  exports: Record<string, string>;
  files: string[];
  publishConfig?: { exports?: Record<string, string> };
  version: string;
}

function readPackageJson(): PackageJson {
  return JSON.parse(
    readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  ) as PackageJson;
}

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full));
    } else {
      found.push(full);
    }
  }
  return found;
}

// --- 1. compile ---

function compile(): number {
  const parsed = ts.getParsedCommandLineOfConfigFile(CONFIG_PATH, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(
        ts.formatDiagnostics([diagnostic], DIAGNOSTIC_HOST).trim(),
      );
    },
  });
  if (!parsed) {
    throw new Error(`Could not read ${CONFIG_PATH}`);
  }
  // A rejected option or an unmatched `include` is reported here rather than in
  // the program's own diagnostics, where it would be silently ignored — and the
  // emit shape is exactly what these options decide.
  if (parsed.errors.length > 0) {
    process.stderr.write(
      ts.formatDiagnosticsWithColorAndContext(parsed.errors, DIAGNOSTIC_HOST),
    );
    throw new Error(`${CONFIG_PATH} was not accepted as written`);
  }
  const program = ts.createProgram(parsed.fileNames, parsed.options);

  // `noEmitOnError` is a `tsc` CLI behavior, not a property of `emit()` — so
  // check first and bail rather than leaving a half-written `dist/` behind.
  const errors = ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    process.stderr.write(
      ts.formatDiagnosticsWithColorAndContext(errors, DIAGNOSTIC_HOST),
    );
    throw new Error(`${errors.length} type error(s); nothing emitted`);
  }

  const emitted = program.emit();
  if (emitted.diagnostics.length > 0) {
    process.stderr.write(
      ts.formatDiagnosticsWithColorAndContext(
        emitted.diagnostics,
        DIAGNOSTIC_HOST,
      ),
    );
    throw new Error('emit reported diagnostics');
  }
  return program.getRootFileNames().length;
}

// --- 2. declaration specifiers ---

function rewriteSpecifier(specifier: string): string | null {
  if (DECLARATION_SPECIFIER.test(specifier)) {
    return null;
  }
  const match = specifier.match(RELATIVE_TS_SPECIFIER);
  return match ? `${match[1]}.${match[2]}js` : null;
}

/**
 * Every module specifier in a parsed file, as the syntax tree reports them.
 *
 * Both the rewrite below and the final check read specifiers from here rather
 * than by searching the text, so a path written in a doc comment or held in a
 * string constant is neither rewritten nor mistaken for an import.
 */
function moduleSpecifiers(source: ts.SourceFile): ts.StringLiteral[] {
  const found: ts.StringLiteral[] = [];
  const take = (node: ts.Node | undefined): void => {
    if (node && ts.isStringLiteral(node)) {
      found.push(node);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      take(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      // `import('./x.ts').Type` — declaration emit's way of naming a type it
      // did not need a top-level import for.
      take(
        ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined,
      );
    } else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      take(node.name);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      // A dynamic import — how the lazy formula chunks load.
      take(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

function parseFile(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
}

/**
 * Rewrite every relative `.ts` module specifier in one declaration file to
 * name the emitted `.js` instead.
 */
function rewriteDeclarationSpecifiers(file: string): number {
  const text = readFileSync(file, 'utf8');
  const source = parseFile(file, text);

  const edits: { end: number; start: number; text: string }[] = [];
  for (const node of moduleSpecifiers(source)) {
    const rewritten = rewriteSpecifier(node.text);
    if (rewritten === null) {
      continue;
    }
    const start = node.getStart(source);
    const quote = text[start];
    edits.push({
      start,
      end: node.getEnd(),
      text: `${quote}${rewritten}${quote}`,
    });
  }

  if (edits.length === 0) {
    return 0;
  }
  let updated = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    updated =
      updated.slice(0, edit.start) + edit.text + updated.slice(edit.end);
  }
  writeFileSync(file, updated, 'utf8');
  return edits.length;
}

// --- 3. reference comments ---

function blankReferenceComments(file: string): number {
  const text = readFileSync(file, 'utf8');
  let blanked = 0;
  const updated = text.replace(
    /^[ \t]*\/\/\/[ \t]*<reference[ \t]+path=.*$/gm,
    () => {
      blanked++;
      return '';
    },
  );
  if (blanked > 0) {
    writeFileSync(file, updated, 'utf8');
  }
  return blanked;
}

// --- 4. assets ---

/**
 * Mirror the data files under `src/` into `dist/`. The TextMate grammar is
 * served straight out of the exports map; the compiler only emits modules, so
 * anything that isn't one has to be copied.
 */
function copyAssets(): string[] {
  const copied: string[] = [];
  for (const file of walk(SRC_DIR)) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const rel = relative(SRC_DIR, file);
    const dest = join(DIST_DIR, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(file, dest);
    copied.push(rel);
  }
  return copied;
}

// --- 5. checks ---

/**
 * The exports map the published package serves, derived from the one this repo
 * serves: `./src/x.ts` becomes `./dist/x.js`, data files keep their extension,
 * and a target outside `src/` — the manifest itself — is left alone.
 *
 * Derived rather than loosely compared, because the two maps are otherwise
 * hand-maintained mirrors of each other, and a subpath quietly wired to the
 * wrong sibling looks exactly like a correct one until a consumer imports it.
 */
export function publishedExportsFor(
  exports: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(exports).map(([subpath, target]) => [
      subpath,
      target.startsWith('./src/')
        ? target.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js')
        : target,
    ]),
  );
}

/**
 * The published surface: the exports map is the one derived above, every target
 * it names is on disk, and `files` ships the directories those targets and the
 * source maps depend on.
 */
function checkPublishedSurface(pkg: PackageJson): void {
  const published = pkg.publishConfig?.exports;
  if (!published) {
    throw new Error(
      'package.json has no publishConfig.exports — the published package ' +
        'would serve raw .ts sources, which Node cannot load from node_modules',
    );
  }

  const expected = publishedExportsFor(pkg.exports);
  const wrong = Object.keys({ ...expected, ...published })
    .filter((subpath) => published[subpath] !== expected[subpath])
    .map(
      (subpath) =>
        `${subpath}: ${published[subpath] ?? '(unpublished)'} — expected ` +
        `${expected[subpath] ?? '(no such subpath in exports)'}`,
    );
  if (wrong.length > 0) {
    throw new Error(
      `publishConfig.exports does not mirror exports:\n  ${wrong.join('\n  ')}`,
    );
  }

  for (const [subpath, target] of Object.entries(published)) {
    // Patterns can't be resolved to a single file; the specifier check below
    // covers what they expand to.
    if (subpath.includes('*') || target.includes('*')) {
      continue;
    }
    if (!existsSync(join(PACKAGE_ROOT, target))) {
      throw new Error(
        `publishConfig.exports["${subpath}"] → ${target} missing`,
      );
    }
  }

  // `dist` is what the exports map serves. `src` is what the source maps and
  // declaration maps resolve against, and what NOTICE.md's attributions name —
  // without it a consumer's debugger and those references both dangle.
  for (const directory of ['dist', 'src']) {
    if (!pkg.files.includes(directory)) {
      throw new Error(`package.json "files" does not include ${directory}`);
    }
  }
}

/**
 * Nothing in the emitted tree may name a `.ts` file: `dist/` holds JavaScript
 * and declarations, so an import or a leftover reference path pointing at a
 * TypeScript source names a file that isn't there.
 *
 * Imports are read from the syntax tree, so prose that mentions a `.ts` path —
 * a doc comment explaining where something is parsed, say — is not mistaken for
 * one. `.map` files are skipped entirely: their `sources` legitimately name the
 * `src/` TypeScript, which ships alongside.
 */
function checkNoTypeScriptReferences(): void {
  const offenders: string[] = [];
  for (const file of walk(DIST_DIR)) {
    if (file.endsWith('.map')) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    const where = relative(PACKAGE_ROOT, file);
    for (const node of moduleSpecifiers(parseFile(file, text))) {
      if (/^\.\.?\//.test(node.text) && /\.[mc]?ts$/.test(node.text)) {
        offenders.push(`${where}: imports ${node.text}`);
      }
    }
    // Reference directives are comments, which the syntax tree doesn't carry.
    for (const [match] of text.matchAll(
      /\/\/\/[ \t]*<reference[ \t]+path=.*/g,
    )) {
      offenders.push(`${where}: ${match.trim()}`);
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `emitted files still reference TypeScript sources:\n  ${offenders.join('\n  ')}`,
    );
  }
}

// --- driver ---

function byteSize(files: string[]): number {
  return files.reduce((total, file) => total + statSync(file).size, 0);
}

function main(): void {
  const pkg = readPackageJson();

  rmSync(DIST_DIR, { force: true, recursive: true });
  const moduleCount = compile();

  let specifiers = 0;
  let references = 0;
  for (const file of walk(DIST_DIR)) {
    if (file.endsWith('.d.ts')) {
      specifiers += rewriteDeclarationSpecifiers(file);
    } else if (file.endsWith('.js')) {
      references += blankReferenceComments(file);
    }
  }

  const assets = copyAssets();

  checkPublishedSurface(pkg);
  checkNoTypeScriptReferences();

  const emitted = walk(DIST_DIR);
  console.log(
    [
      `built @cardstack/bxl ${pkg.version}`,
      `${moduleCount} modules`,
      `${emitted.length} files`,
      `${(byteSize(emitted) / 1024 / 1024).toFixed(1)}MB`,
      `${specifiers} declaration specifiers rewritten`,
      `${references} reference comments blanked`,
      `${assets.length} assets copied`,
    ].join('; '),
  );
}

if (import.meta.main) {
  main();
}
