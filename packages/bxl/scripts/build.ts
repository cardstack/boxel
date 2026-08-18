#!/usr/bin/env node
/**
 * Build the artifact published to npm as `@cardstack/bxl`.
 *
 * In-repo consumers read `src/` directly: the host's bundler compiles the
 * TypeScript, and the realm-server reaches the sources through the pnpm
 * workspace link, whose realpath sits outside `node_modules` where Node is
 * willing to strip types. Neither of those holds for an installed package —
 * it lands *inside* `node_modules`, where Node refuses to strip types
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). So the tarball has to
 * carry JavaScript.
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
 *   5. Check the published surface: the two exports maps describe the same
 *      subpaths, every published target exists on disk, and nothing in
 *      `dist/` still points at a `.ts` file.
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
 * Rewrite every relative `.ts` module specifier in one declaration file to
 * name the emitted `.js` instead. Specifiers are located through the parsed
 * syntax tree — not by text search — so a `.ts` path appearing in a doc
 * comment or a string constant is left alone.
 */
function rewriteDeclarationSpecifiers(file: string): number {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const edits: { end: number; start: number; text: string }[] = [];
  const considerSpecifier = (node: ts.Node | undefined): void => {
    if (!node || !ts.isStringLiteral(node)) {
      return;
    }
    const rewritten = rewriteSpecifier(node.text);
    if (rewritten === null) {
      return;
    }
    const start = node.getStart(source);
    const quote = text[start];
    edits.push({
      start,
      end: node.getEnd(),
      text: `${quote}${rewritten}${quote}`,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      considerSpecifier(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      // `import('./x.ts').Type` — declaration emit's way of naming a type it
      // did not need a top-level import for.
      considerSpecifier(
        ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined,
      );
    } else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      considerSpecifier(node.name);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);

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
 * The published exports map is a hand-maintained mirror of the development
 * one: same subpaths, `dist/*.js` targets in place of `src/*.ts`. Drift is
 * invisible until an installed package fails to resolve a subpath, so compare
 * the two key sets here and resolve every published target on disk.
 */
function checkPublishedSurface(pkg: PackageJson): void {
  const published = pkg.publishConfig?.exports;
  if (!published) {
    throw new Error(
      'package.json has no publishConfig.exports — the published package ' +
        'would serve raw .ts sources, which Node cannot load from node_modules',
    );
  }

  const development = Object.keys(pkg.exports).sort();
  const publishedKeys = Object.keys(published).sort();
  const missing = development.filter((k) => !publishedKeys.includes(k));
  const extra = publishedKeys.filter((k) => !development.includes(k));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      'exports and publishConfig.exports describe different subpaths' +
        (missing.length > 0 ? `; unpublished: ${missing.join(', ')}` : '') +
        (extra.length > 0 ? `; published only: ${extra.join(', ')}` : ''),
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

  if (!pkg.files.includes('dist')) {
    throw new Error('package.json "files" does not include dist');
  }
}

/**
 * Nothing in the emitted tree may name a `.ts` file: `dist/` holds JavaScript
 * and declarations, so a relative specifier or a leftover reference path
 * pointing at a TypeScript source names a file that isn't there. `.map` files
 * are exempt — their `sources` legitimately name the `src/` TypeScript, which
 * ships alongside.
 */
function checkNoTypeScriptReferences(): void {
  const offenders: string[] = [];
  for (const file of walk(DIST_DIR)) {
    if (file.endsWith('.map')) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const [, , specifier] of text.matchAll(
      /(['"])(\.\.?\/[^'"]*\.[mc]?ts)\1/g,
    )) {
      offenders.push(`${relative(PACKAGE_ROOT, file)}: ${specifier}`);
    }
    for (const [match] of text.matchAll(
      /\/\/\/[ \t]*<reference[ \t]+path=.*/g,
    )) {
      offenders.push(`${relative(PACKAGE_ROOT, file)}: ${match.trim()}`);
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

main();
