// The secure origin's policy refuses `style` attributes and inline style, and
// that holds for every Pret UI template a page renders (ADR 019 §1.5). This
// lints each Pret UI module the package imports, and each Pret UI module
// those import in turn, as the package lints its own templates: the template
// lint's `no-inline-styles` with `allowDynamicStyles: false`. It also refuses
// what that rule can't see, which the policy refuses as well: a `<style>`
// element left unscoped, which `glimmer-scoped-css` doesn't compile into the
// build's stylesheets and so is inline style, and one created at run time,
// and a `style` attribute set at run time.
//
// boxel-ui templates that a Pret UI module renders aren't linted here: the
// realm server's policy test loads each built page under the policy, and
// fails on a `style` attribute anywhere a page renders one.
//
// `node build/pret-ui-lint.ts` exits 1, naming each refusal, when any module
// it reaches has one.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import TemplateLinter from 'ember-template-lint';

import { PACKAGE_ROOT } from './module-package.ts';
import { stylesAtRunTime, withoutCommentLines } from './run-time-style.ts';

export const PRETUI_ROOT = join(PACKAGE_ROOT, '..', 'pretui');
const PRETUI = '@cardstack/pretui/';
const SOURCE_EXTENSIONS = ['.gts', '.ts', '.js'];

const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+)\1/g;

const REMEDY: Record<string, string> = {
  'creates a <style> element':
    'creates a <style> element at run time, which the policy refuses as inline style',
  'sets a style attribute':
    'sets a style attribute at run time, which the policy refuses; set properties through the CSSOM (`element.style.setProperty`)',
};

// What a module's source refuses that the template lint can't see.
export function runTimeStyleRefusals(source: string): string[] {
  let unscoped = /<style\b(?![^>]*\bscoped\b)[^>]*>/.test(
    withoutCommentLines(source),
  )
    ? [
        'has a <style> element that is not scoped, which the policy refuses as inline style',
      ]
    : [];
  return [...unscoped, ...stylesAtRunTime(source).map((does) => REMEDY[does])];
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function resolveSource(base: string): string | undefined {
  return [base, ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`)]
    .filter((candidate) => !candidate.endsWith('.d.ts'))
    .find(isFile);
}

// The Pret UI module a specifier names, as Pret UI's `exports` maps it
// (`./*` → `./*.gts`), or a relative import's file inside Pret UI.
function pretuiModule(specifier: string, importer: string): string | undefined {
  if (specifier.startsWith(PRETUI)) {
    return resolveSource(join(PRETUI_ROOT, specifier.slice(PRETUI.length)));
  }
  if (specifier.startsWith('.') && importer.startsWith(`${PRETUI_ROOT}/`)) {
    let found = resolveSource(resolve(dirname(importer), specifier));
    return found?.startsWith(`${PRETUI_ROOT}/`) ? found : undefined;
  }
  return undefined;
}

export function importsOf(source: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER)].map(
    ([, , specifier]) => specifier.split('?')[0],
  );
}

function ownSources(dir: string): string[] {
  let found: string[] = [];
  for (let entry of readdirSync(dir, { withFileTypes: true })) {
    let path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...ownSources(path));
    } else if (
      SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension)) &&
      !entry.name.endsWith('.d.ts')
    ) {
      found.push(path);
    }
  }
  return found;
}

// Every Pret UI module the package's source imports, and every Pret UI module
// those reach through their own imports, sorted.
export function pretuiModulesImported(
  roots: string[] = [join(PACKAGE_ROOT, 'src')],
): string[] {
  let found = new Set<string>();
  let pending: [string, string][] = [];
  for (let root of roots) {
    for (let file of existsSync(root) ? ownSources(root) : []) {
      for (let specifier of importsOf(readFileSync(file, 'utf8'))) {
        pending.push([specifier, file]);
      }
    }
  }
  while (pending.length > 0) {
    let [specifier, importer] = pending.pop()!;
    let file = pretuiModule(specifier, importer);
    if (!file || found.has(file)) {
      continue;
    }
    found.add(file);
    for (let next of importsOf(readFileSync(file, 'utf8'))) {
      pending.push([next, file]);
    }
  }
  return [...found].sort();
}

export async function lintPretui(files: string[]): Promise<string[]> {
  let linter = new TemplateLinter({
    workingDir: PRETUI_ROOT,
    config: {
      rules: { 'no-inline-styles': ['error', { allowDynamicStyles: false }] },
    },
  });
  let refusals: string[] = [];
  for (let file of files) {
    let source = readFileSync(file, 'utf8');
    let name = `@cardstack/pretui/${relative(PRETUI_ROOT, file)}`;
    if (file.endsWith('.gts')) {
      // Only this rule's findings: a module's own lint directives name
      // rules of Pret UI's that this linter doesn't load.
      for (let result of await linter.verify({ source, filePath: file })) {
        if (result.rule !== 'no-inline-styles') {
          continue;
        }
        refusals.push(
          `${name}:${result.line}:${result.column} ${result.message} (${result.rule})`,
        );
      }
    }
    for (let reason of runTimeStyleRefusals(source)) {
      refusals.push(`${name} ${reason}`);
    }
  }
  return refusals;
}

if (import.meta.main) {
  let files = pretuiModulesImported();
  let refusals = await lintPretui(files);
  if (refusals.length > 0) {
    console.error(
      `Pret UI modules the secure origin imports may not ship under its policy (ADR 019 §1.5):\n${refusals
        .map((line) => `  ${line}`)
        .join('\n')}`,
    );
    process.exit(1);
  }
  console.log(
    `${files.length} Pret UI module${files.length === 1 ? '' : 's'} the secure origin imports pass the policy's template lint`,
  );
}
