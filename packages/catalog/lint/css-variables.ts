// Lints the CSS custom properties catalog cards read.
//
// A `var(--x)` whose `--x` nothing declares resolves to nothing, and the
// property silently falls back to its initial value. This reads every
// `var()` in the catalog clone (contents/) and reports the ones that read a
// variable no stylesheet defines, plus the mechanical tells from step 0 of the
// boxel-ui-guidelines UI review procedure that can be matched without reading
// the surrounding rule.
//
// This lives in lint/, not scripts/: the catalog's own CI removes scripts/
// before it runs `pnpm run lint`, and this is one of that package's lint
// scripts. tsconfig.json leaves lint/ out of the type check for the same
// reason scripts/ is left out (it is Node tooling, not card content).
//
// Run from packages/catalog:
//
//   node lint/css-variables.ts [--root=<dir>] [--format=json --output-file=<file>]
//
// It prints one line per error and exits 1 when there are any. With
// `--format=json` it writes the errors to `--output-file` instead, as the
// array scripts/lint-sweep.ts reads.
//
// What counts as defined, all derived from the checkout, none hand-typed:
//
//   - every custom property declared in packages/boxel-ui/src/styles/*.css:
//     the `--boxel-*` primitives (variables.css), the theme contract and the
//     typography roles (theme.css), fonts.css and global.css;
//   - every `--pretui-*` property declared in, or documented beside,
//     packages/pretui/components: the kit's per-instance knobs;
//   - a property declared in the same file as the read, in a `<style>` block,
//     an inline `style`, or a `setProperty` call. A card sets a variable for
//     its own descendants, so a declaration in the file is the card's own.
//
// The theme contract is the set theme.css declares; the fallback rules read
// those bare, so a fallback on one is an error.
//
// Existing violations are recorded in css-variables-baseline.json beside this
// script. An error in the baseline is not reported; the entry is
// `file`, `rule`, `variable` (or the rule's own subject) and a count, so a
// file that gets worse than its recorded count fails while a file that gets
// better only has a stale entry. Regenerate it with `--write-baseline`.

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const catalogDir = resolve(scriptDir, '..');
const repoRoot = resolve(catalogDir, '..', '..');
const baselinePath = join(scriptDir, 'css-variables-baseline.json');

export interface CssVariableError {
  file: string;
  line: number;
  column: number;
  rule: string;
  // The variable or declaration the error is about, for the baseline.
  subject: string;
  message: string;
}

export interface Definitions {
  // Declared by boxel-ui's stylesheets or the Pret UI kit.
  global: Set<string>;
  // The subset of `global` that a theme provides: the theme contract in
  // theme.css, which a card reads bare.
  theme: Set<string>;
}

// Variables that were removed from the platform and keep coming back. Each
// message says what to read instead.
const REMOVED: Record<string, string> = {
  '--font-heading':
    'Headings take the theme font through CardContainer. Where a heading font is needed, read var(--boxel-heading-font-family) (or --boxel-section-heading-font-family / --boxel-subheading-font-family); for body text read var(--font-sans), for a mono register var(--font-mono).',
};

const DECLARATION = /(?<![\w-])(--[a-zA-Z][\w-]*)\s*:/g;
const QUOTED_NAME = /['"](--[a-zA-Z][\w-]*)['"]/g;

function declaredNames(text: string): Set<string> {
  let names = new Set<string>();
  for (let match of text.matchAll(DECLARATION)) {
    names.add(match[1]);
  }
  for (let match of text.matchAll(QUOTED_NAME)) {
    names.add(match[1]);
  }
  return names;
}

function walk(dir: string, accept: (path: string) => boolean): string[] {
  let found: string[] = [];
  for (let name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') {
      continue;
    }
    let path = join(dir, name);
    let info = statSync(path);
    if (info.isDirectory()) {
      found.push(...walk(path, accept));
    } else if (accept(path)) {
      found.push(path);
    }
  }
  return found.sort();
}

export function readDefinitions(boxelRoot = repoRoot): Definitions {
  let stylesDir = join(boxelRoot, 'packages/boxel-ui/src/styles');
  let global = new Set<string>();
  let theme = new Set<string>();
  for (let name of declaredNames(
    readFileSync(join(stylesDir, 'theme.css'), 'utf8'),
  )) {
    theme.add(name);
  }
  for (let file of walk(stylesDir, (path) => path.endsWith('.css'))) {
    for (let name of declaredNames(readFileSync(file, 'utf8'))) {
      global.add(name);
    }
  }
  let kitDir = join(boxelRoot, 'packages/pretui/components');
  for (let file of walk(kitDir, (path) => /\.(gts|md|css)$/.test(path))) {
    let text = readFileSync(file, 'utf8');
    for (let match of text.matchAll(/(?<![\w-])(--pretui-[a-z0-9-]+)/g)) {
      global.add(match[1]);
    }
  }
  return { global, theme };
}

// Blanks out comments without moving anything else, so line and column
// numbers still point at the source.
function blankComments(text: string): string {
  let blank = (s: string) => s.replace(/[^\n]/g, ' ');
  return (
    text
      .replace(/\/\*[\s\S]*?\*\//g, blank)
      .replace(/\{\{!--[\s\S]*?--\}\}/g, blank)
      .replace(/\{\{![\s\S]*?\}\}/g, blank)
      .replace(/<!--[\s\S]*?-->/g, blank)
      // A `//` comment, but not the `//` of a URL, which follows a `:` or `(`.
      .replace(
        /(^|\s)\/\/.*$/gm,
        (m, lead) => lead + blank(m.slice(lead.length)),
      )
  );
}

function position(text: string, offset: number) {
  let before = text.slice(0, offset);
  let line = before.split('\n').length;
  let column = offset - before.lastIndexOf('\n');
  return { line, column };
}

interface VarRead {
  name: string;
  fallback: string | undefined;
  offset: number;
}

// Every `var(--name[, fallback])`, with the fallback taken whole: the text
// after the first top-level comma, up to the matching parenthesis.
function varReads(text: string): VarRead[] {
  let reads: VarRead[] = [];
  // A name followed by `$` or `{` is built at runtime, `var(--tier-${name})`.
  let start = /var\(\s*(--[a-zA-Z][\w-]*)(?![\w$`{-])\s*/g;
  for (let match of text.matchAll(start)) {
    let depth = 1;
    let i = match.index + match[0].length;
    let fallbackStart = -1;
    if (text[i] === ',') {
      fallbackStart = i + 1;
    }
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '(') {
        depth++;
      } else if (text[i] === ')') {
        depth--;
      }
    }
    let fallback =
      fallbackStart === -1
        ? undefined
        : text.slice(fallbackStart, i - 1).trim();
    reads.push({ name: match[1], fallback, offset: match.index });
  }
  return reads;
}

// The CSS the file carries: `<style>` blocks in a template file, or the whole
// file for a stylesheet. Offsets stay relative to the file.
function styleRegions(file: string, text: string): [number, number][] {
  if (file.endsWith('.css')) {
    return [[0, text.length]];
  }
  let regions: [number, number][] = [];
  for (let match of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
    let begin = match.index + match[0].indexOf('>') + 1;
    regions.push([begin, begin + match[1].length]);
  }
  return regions;
}

export function lintFile(
  file: string,
  source: string,
  definitions: Definitions,
): CssVariableError[] {
  let text = blankComments(source);
  let local = declaredNames(text);
  let errors: CssVariableError[] = [];
  let add = (
    offset: number,
    rule: string,
    subject: string,
    message: string,
  ) => {
    errors.push({ file, ...position(text, offset), rule, subject, message });
  };

  for (let read of varReads(text)) {
    let { name, fallback, offset } = read;
    let isTheme = definitions.theme.has(name);
    let isGlobal = definitions.global.has(name);

    if (!isGlobal && !local.has(name)) {
      let removed = REMOVED[name];
      add(
        offset,
        'css-variables/undefined',
        name,
        removed
          ? `${name} is not defined anywhere. ${removed}`
          : `${name} is not defined by boxel-ui, the theme contract or Pret UI, and this file does not declare it, so the read silently falls back. ` +
              `Read the theme token for the role (see packages/boxel-ui/src/styles/theme.css), or declare ${name} in this component's own styles.`,
      );
      continue;
    }

    if (fallback === undefined) {
      continue;
    }
    if (isTheme) {
      add(
        offset,
        'css-variables/theme-fallback',
        name,
        `var(${name}, ${fallback}) gives a theme variable a fallback. Every card renders under a theme that defines it, and CardContainer is the only place that carries a fallback. ` +
          `Read var(${name}) bare.`,
      );
      continue;
    }
    let inner = /^var\(\s*(--[a-zA-Z][\w-]*)\s*[,)]/.exec(fallback);
    if (inner && definitions.theme.has(inner[1]) && !isGlobal) {
      add(
        offset,
        'css-variables/private-name-fallback',
        name,
        `var(${name}, ${fallback}) reads a private name with a theme variable as its fallback, which is an alias layer written at the use site. ` +
          `Read var(${inner[1]}) directly and drop ${name}. A per-instance knob a component documents in its contract is the one exception, and those are declared by the component, not here.`,
      );
    }
  }

  for (let [begin, end] of styleRegions(file, text)) {
    let css = text.slice(begin, end);
    for (let match of css.matchAll(/(?<![\w-])font\s*:\s*([^;}\n]*)/g)) {
      // `font: inherit` resets, it does not set a typographic shorthand.
      if (/^(inherit|initial|unset|revert)\b/.test(match[1].trim())) {
        continue;
      }
      add(
        begin + match.index,
        'css-variables/font-shorthand',
        'font',
        'The font: shorthand resets line-height and every longhand it omits, and carries a literal size. ' +
          'Split it into font-size and font-weight, reading var(--boxel-font-size-sm) or a heading role token for the size, and set line-height only where it differs from the body role.',
      );
    }
  }
  return errors;
}

export function lintCatalog(
  root: string,
  definitions: Definitions,
): CssVariableError[] {
  let files = walk(root, (path) => /\.(gts|gjs|css)$/.test(path));
  let errors: CssVariableError[] = [];
  for (let path of files) {
    errors.push(
      ...lintFile(
        relative(repoRoot, path).split('\\').join('/'),
        readFileSync(path, 'utf8'),
        definitions,
      ),
    );
  }
  return errors;
}

interface BaselineEntry {
  file: string;
  rule: string;
  subject: string;
  count: number;
}

function baselineKey(e: { file: string; rule: string; subject: string }) {
  return JSON.stringify([e.file, e.rule, e.subject]);
}

function toBaseline(errors: CssVariableError[]): BaselineEntry[] {
  let counts = new Map<string, BaselineEntry>();
  for (let e of errors) {
    let entry = counts.get(baselineKey(e));
    if (entry) {
      entry.count++;
    } else {
      counts.set(baselineKey(e), {
        file: e.file,
        rule: e.rule,
        subject: e.subject,
        count: 1,
      });
    }
  }
  return [...counts.values()].sort((a, b) =>
    baselineKey(a).localeCompare(baselineKey(b)),
  );
}

// Drops the errors a baseline records, per file, rule and subject, up to the
// recorded count. A later occurrence in the same file is the one reported.
export function applyBaseline(
  errors: CssVariableError[],
  baseline: BaselineEntry[],
): CssVariableError[] {
  let allowance = new Map(baseline.map((e) => [baselineKey(e), e.count]));
  return errors.filter((e) => {
    let left = allowance.get(baselineKey(e)) ?? 0;
    if (left > 0) {
      allowance.set(baselineKey(e), left - 1);
      return false;
    }
    return true;
  });
}

function main() {
  let args = process.argv.slice(2);
  let option = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  let root = resolve(catalogDir, option('root') ?? 'contents');
  if (!existsSync(root)) {
    console.error(`css variables lint: there is no catalog clone at ${root}`);
    process.exit(2);
  }
  let all = lintCatalog(root, readDefinitions());

  if (args.includes('--write-baseline')) {
    writeFileSync(
      baselinePath,
      JSON.stringify(toBaseline(all), null, 2) + '\n',
    );
    console.log(`recorded ${all.length} existing error(s) to ${baselinePath}`);
    return;
  }
  if (args.includes('--no-baseline')) {
    report(all, args, option);
    return;
  }
  let baseline: BaselineEntry[] = existsSync(baselinePath)
    ? JSON.parse(readFileSync(baselinePath, 'utf8'))
    : [];
  report(applyBaseline(all, baseline), args, option);
}

function report(
  errors: CssVariableError[],
  args: string[],
  option: (name: string) => string | undefined,
) {
  if (args.includes('--format=json')) {
    let out = option('output-file');
    let json = JSON.stringify(errors, null, 2);
    if (out) {
      writeFileSync(out, json);
    } else {
      console.log(json);
    }
    process.exit(errors.length > 0 ? 1 : 0);
  }
  for (let e of errors) {
    console.log(`${e.file}:${e.line}:${e.column}  ${e.rule}  ${e.message}`);
  }
  if (errors.length > 0) {
    console.error(`\n${errors.length} CSS variable error(s)`);
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
